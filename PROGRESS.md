# PROGRESS — MEETAMASK

> Читать в начале каждой итерации, обновлять в конце. Это память между проходами (Ralph-loop) — контекст не держим «в голове».

## Текущий модуль
**M3 — Рантайм масок на CEF (офскрин-Chromium) → камера, без фриза.**

## Текущая итерация
CEF Phase 3 — живая маска идёт в виртуалкамеру и НЕ виснет, когда приложение спрятано. **Статус: 🟡 пайплайн собран и доказан headless; ждёт финальной проверки пикселей в камере глазами.**

### 🔴 КОРНЕВАЯ ПРИЧИНА (найдена 2026-05-31) — почему «у других работает, у нас виснет»
- **Симптом фриза:** WKWebView троттлит rendering/requestAnimationFrame, как только окно «невидимо» (⌘H, перекрытие, офскрин) → в Meet кадр застывает. Это следствие.
- **Корень №1 (фриз):** неправильный рантайм. WebKit нельзя рендерить вне видимого окна. Производственный паттерн (OBS browser source) — **headless CEF (Chromium) с offscreen-рендерингом**: окна нет вообще → понятия «видимость» нет → не виснет.
- **Корень №2 (движок зависал на старте + 20 запросов пароля):** Chromium лез в **macOS Keychain «Safe Storage»** при старте и ЖДАЛ ответа на запрос пароля. Запуск из скрипта → отвечать некому → движок висел; меняющаяся подпись → новый запрос каждый раз. **Фикс (подтверждён доками CEF):** флаги `--use-mock-keychain` + `--password-store=basic` → Chromium не трогает Keychain. После фикса движок стартует чисто, без пароля.
- **Корень №3 (движок не мог писать в камеру):** движок не в app-group → CMIO sink (app-group-scoped) его не пускал. **Фикс:** движок пишет кадры в общую память (mmap), а в камеру их пушит приложение (оно в app-group, путь доставки уже проверен).

## Предыдущая итерация
M1 / Итерация 1 — камера с тест-паттерном видна в Meet. **Статус: ✅ ЗАКРЫТА (риск #1 убит, 2026-05-30).**

## Сделано
- Зафиксирована архитектура (виртуальная камера / CMIOExtension), отвергнут Chrome-extension.
- Оформлена спека M1 (`SPEC.md`).
- Написан код Итерации 1:
  - `CameraExtension/` — рабочий CMIOExtension с тест-паттерном (SMPTE-полосы + бегущая линия + брендлейбл + живые счётчики), 1280×720@30, BGRA. Файлы: `CameraProvider.swift`, `Config.swift`, `main.swift`, `Info.plist`, entitlements.
  - `MEETAMASK/` — SwiftUI host-app + `ExtensionManager` (активация/деактивация через `OSSystemExtensionRequest`).
  - Сборка через `xcodegen` (`project.yml`).
- **Подпись и активация доведены до рабочего состояния** (2026-05-30):
  - Bundle id: `com.meetamask.app` + extension `com.meetamask.app.CameraExtension`, Team **6D6948Z4MW** (индивидуальный, не org).
  - Подпись: **Automatic / Development** (серт `Apple Development`, auto-provisioning profile с entitlement `com.apple.developer.system-extension.install`). Developer ID + нотаризация — отложено до M4 (раздача).
  - App скопирован в `/Applications`, запущен оттуда → активация прошла, одобрено в System Settings.
- **✅ US-1 (риск #1) ПОДТВЕРЖДЁН:** в Google Meet (Chrome, macOS 26) камера **«MEETAMASK Camera»** видна и стримит тест-паттерн (не чёрный экран). Проверено визуально в живой встрече.
- Системная проверка (Confirmed):
  - `systemextensionsctl list` → `com.meetamask.app.CameraExtension (0.1/1) … [activated enabled]`.
  - `system_profiler SPCameraDataType` → `MEETAMASK Camera` (Model ID «MEETAMASK Virtual Camera»).

## Блокеры, найденные и снятые в Итерации 1
1. **dev-mode недоступен при SIP on.** `systemextensionsctl developer on` падает с ошибкой SIP. Решение: НЕ трогаем SIP, идём через настоящую подпись (Development). Доказано: расширение активировалось при включённом SIP.
2. **Сборка была ad-hoc + старый bundle id** (`ai.overchat.meetamask.*`). Решение: чистая пересборка под `com.meetamask.app` с реальной подписью (Mac зарегистрирован, профиль выпущен).
3. **Системное расширение активируется только из `/Applications`** (ошибка при запуске из DerivedData). Решение: копировать app в `/Applications` и запускать оттуда.

## Рецепт одобрения на macOS 26 (память для будущих пересборок)
Всплывающего окна НЕТ. Путь к тумблеру:
System Settings → **General → Login Items & Extensions** → секция **Extensions** (внизу) → переключатель **By Category** → **Camera Extensions** → **ⓘ** → включить тумблер **MEETAMASK**.
После пересборки с новой версией расширения может потребоваться повторное одобрение там же.

## Сделано — CEF-движок (2026-05-31)
- **`engine/`** — отдельное headless-CEF-приложение (CMake/Ninja, CEF 148). Рендерит страницу маски офскрин (`SetAsWindowless`, `windowless_frame_rate=30`), `OnPaint` BGRA → пишет в общую память.
  - `engine_app.cc` — командная строка: `--use-mock-keychain`, `--password-store=basic` (фикс зависания/паролей), `--enable-media-stream`, `--use-fake-ui-for-media-stream` (авто-allow вебки), anti-throttle флаги.
  - `engine_handler.{h,mm}` — `OnLoadEnd` инъектит: (1) выбор РЕАЛЬНОЙ вебки (не «MEETAMASK Camera», иначе петля) + (2) авто-клик `#startBtn`. `OnPaint` → `FrameSHM.Write`.
  - `frame_shm.{h,mm}` — mmap-файл: header `{seq:u64, w:u32, h:u32}` (16б) + 1280×720×4 BGRA. Write копирует и бампает seq.
- **Приложение (`MEETAMASK/`):**
  - `EngineFrameReceiver.swift` (новый) — запускает движок (`Process`) с маской и `--shm`; mmap; таймер 30fps читает кадр → `CameraFeeder.makeSampleBuffer(fromBGRA:)` → `enqueue`. `ProcessInfo.beginActivity` (idleSystemSleepDisabled) — нет App Nap. Превью в приложении из тех же кадров.
  - `CameraFeeder.swift` — добавлен `makeSampleBuffer(fromBGRA:width:height:)` (копия с учётом stride из общей памяти в pool-pixelbuffer).
  - `MaskGalleryView.swift` — вкладка «Маски» переведена на движок: превью = кадры движка; поток выживает при смене вкладок и спрятанном приложении (нет `.onDisappear stop`).
  - **`MEETAMASK.entitlements` — снят `app-sandbox`** (sandbox блокирует `Process`-запуск движка и общий файл). app-group СОХРАНЁН. Производственный паттерн (OBS/Discord). Раздача — Developer ID + нотаризация (sandbox не нужен).
- **Доказано фактами (headless):**
  - расширение осталось `[activated enabled]` после снятия sandbox → **app-group живёт без песочницы** (Confirmed).
  - приложение само поднимает движок с бандл-маской `ar-dr-strange` (Confirmed: видны все CEF-процессы).
  - движок рендерит **живую маску: вебка + MediaPipe-трекинг рук + AR** (Confirmed: кадр выгружен в PNG, видно лицо/руки/HUD/эффект).
  - поток кадров в общую память живой ~30fps (Confirmed: seq растёт 123→…→5478).
  - вебка прошла в движок **без отдельного промпта** — TCC-камера атрибутировалась родительскому приложению (responsible process), у которого доступ уже есть (Confirmed эмпирически).

## Открыто / следующий шаг
- **Финальная проверка глазами (нужен пользователь, headless нельзя — терминалу не выдан camera-TCC):** Photo Booth / Meet с «MEETAMASK Camera» →
  1. видно маску (я + неон + руки)?
  2. **главный тест:** ⌘H спрятать приложение / Meet на весь экран → маска ПРОДОЛЖАЕТ двигаться (не виснет)?
- Если в камере не маска: добавить `NSLog` в `CameraFeeder.connect/enqueue` + релей расширения → увидеть push в `log show` (headless-диагностика без камеры).
- Затем: бандлить движок внутрь app (`Contents/Resources/MEETAMASKEngine.app`) вместо dev-пути; убрать неиспользуемый `MaskStudio.swift` (мёртвый после перехода на движок); Phase 4 — проброс кликов по темам в движок; Phase 5 — GPU OSR (IOSurface) для стабильных 30fps.
- TDD-юниты (frame gen, queue, fps) — остаётся долгом.

### Предыдущий «Открыто» (M1→M2, выполнено в рамках перехода на движок)
- Итерация 2 (sink-стрим + релей + app кормит камеру) — реализовано: `CameraFeeder` пушит в sink через `CMSimpleQueue`, релей sink→source в расширении. Путь доставки проверен (в прошлой сессии маска дошла до Photo Booth).

## Известные наблюдения (не баги, проверить позже при работе над качеством)
- Meet зеркалит self-view → порядок полос на экране обратный (это норм).
- Meet накладывает свой portrait/background-blur поверх кадра → лёгкое размытие тест-паттерна. На фиделити реального видео смотрим в Итерации 3.

## Backlog — НЕ блокеры MVP (чинить после первого релиза)
> Все три срабатывают ТОЛЬКО когда «MEETAMASK Camera» одновременно открывают 2+ приложения (Meet + Photo Booth/Zoom). Обычный сценарий «один звонок» их не задевает. Подтверждено двумя независимыми ревью (codex native + 21-агентный проход, 2026-06-10). Все в одном файле `CameraExtension/CameraProvider.swift` — один заход когда дойдём.
- **Заморозка при 2+ потребителях (F9):** `sinkShouldBeFed` (CameraProvider.swift:114) → `_streamingSourceCounter <= 1`; при 2+ зрителях приложение перестаёт кормить sink, все мрут. Фикс: `> 0`.
- **Утечка/дубль таймера (codex P2):** `startStreamingSource`/`startStreamingSink` перезаписывают `_sourceTimer`/`_sinkTimer` без отмены старого; `stop` гасит только последний. Фикс: создавать таймер только на переходе 0→1, старый cancel.
- **Несинхронные счётчики (F8):** `_streamingSourceCounter`/`_streamingSinkCounter` читаются/пишутся из разных очередей без lock.

## Баг «при запуске вылезает пустой Google Chrome» — НАЙДЕН и ПОФИКШЕН (2026-07-05)
- Симптом месяцами был неуловим и прерывист. По скрину юзера это НЕ его Chrome, а **Chromium нашего движка** (кнопка «Customize Chromium», не «Customize Chrome»; иконка вкладки — синий Chromium). Единственный Chromium в системе = MEETAMASKEngine.
- **Корень:** движок использовал ОДНУ общую папку профиля Chromium (`~/Library/Caches/ai.overchat.meetamask.engine`, зашито в `engine/main.mm`). Когда одновременно живут два процесса движка (хост открыт дважды — в `log stream` видно два инстанса: host pid 44954+45030, engine 44978+45032), у Chromium срабатывает **process-singleton**: второй инстанс с той же папкой профиля просит первый открыть новое окно → пустой New Tab. Одиночный движок окна не даёт — поэтому в single-launch тестах (и у меня, и в прошлых сессиях) не воспроизводилось.
- **Диагностика:** `log stream` (launchservicesd + runningboardd + Google Chrome + com.meetamask.app subsystem) на живом репро + скрин юзера + `lsappinfo` (движок = UIElement, LSUIElement=1 → не док-приложение, значит окно — не «нормальный» foreground-режим, а singleton-форвард).
- **Фикс (`engine/main.mm`, коммит 564b125):** папка профиля выводится из per-instance shm-ключа — уникальна на инстанс хоста, но СТАБИЛЬНА между переключениями масок (HTTP-кэш MediaPipe переиспользуется, не перекачивается на каждый свитч). Два хоста → две папки → singleton не сталкивается → окна нет никогда. + best-effort чистка папок мёртвых сессий (>24ч).
- **Проверено:** два движка одновременно (distinct shm) → разные `user-data-dir`, 0 окон на экране (CGWindowList по owner-name), оба `windowless=1` + кадры идут.
- **Прод:** пересобран (ninja) → `package-engine.sh` (Developer ID + hardened runtime) → `notarize.sh` (Accepted, id 4cdb3fc4) → staple → залит в релиз v0.2 (clobber). Контроль скачиванием с `dl.meetamask.com/engine`: `spctl accepted, Notarized Developer ID` + staple OK + бинарь 2026-07-05 23:06. Локально в App Support тоже стоит фикс.

## Прод-релиз хоста ОБНОВЛЁН (2026-07-02, поздний вечер)
- Прод (`dl.meetamask.com/app` → Release v0.2 `MEETAMASK.zip`) отставал от main на 15 коммитов (лежал билд от 11 июня без новых масок). Пересобран и залит свежий хост: 56 папок масок, все 7 новых пресетов (chomp, callwrapped, sandbox, faceoff, facesimon, goblin, leanin).
- Путь — строго по правилу от 2026-06-11: `xcodebuild archive` → `-exportArchive` (method=developer-id, `build/exportOptions-devid.plist`) → `dist/notarize.sh` (профиль `meetamask`) → staple → zip → `gh release upload v0.2 --clobber`. Артефакты: `build/rel-20260702/`.
- Заминка: нотаризация сперва дала `HTTP 403 — agreement expired`; founder принял обновлённое соглашение на developer.apple.com → повтор прошёл (Accepted, id c6a3bd9e).
- **Проверено сквозняком как юзер:** скачан с `dl.meetamask.com/app` (1.46 МБ) → `spctl: accepted, Notarized Developer ID` + `stapler validate OK` + hardened runtime, без get-task-allow + 56 масок, 7/7 новых на месте. main запушен в origin (045b69a..58f839b).
- Движок в релизе не трогали — его исходники не менялись с 2026-06-03, прод-зип актуален.
- Примечание: в `/Applications` на маке founder'а стоит dev-сборка (Apple Development, от локальной пересборки 28 июня) — для локальной работы это норм; прод-юзеры получают нотаризованный билд.

## Хост теперь РЕАЛЬНО ЗАПУСКАЕТСЯ (2026-06-11) — найден и закрыт скрытый блокер
- **Баг (мой промах):** билд от `dist/sign-host.sh` проходил Gatekeeper (`spctl accepted`), но macOS/AMFI убивал его на старте (SIGKILL, RBS 163). Причина — у app есть системное расширение, чьи restricted-entitlements требуют **Developer ID provisioning profile**, которого ручная подпись не вшивала. «Подпись принята» ≠ «запускается». Раньше я этого не проверял (тестировал только spctl), отсюда ложное «раздача живая».
- **Фикс:** founder вошёл в Apple ID в Xcode → `xcodebuild -exportArchive` (method=developer-id, `-allowProvisioningUpdates`) сам выпустил профиль `Mac Team Direct Provisioning Profile` и вшил его → нотаризация (id 445fb64d) → staple → залит в релиз v0.2 (clobber).
- **Проверено сквозняком:** скачал с `dl.meetamask.com/app` как юзер → распаковал → **бинарь запускается и живёт** (AMFI не убивает). Раздача наконец настоящая.
- **Правило на будущее:** хост для раздачи собирать ТОЛЬКО через exportArchive (нужен Xcode-логин), НЕ через `sign-host.sh` (он стрипнет профиль). Детали — в памяти `project_meetomask_repo`.
- Не проверено (нет чистой машины): активация Developer-ID-расширения на маке, который его раньше не видел.

## Раздача ПОЛНОСТЬЮ — СДЕЛАНО (2026-06-10, вечер)
- **Домен:** Cloudflare Worker `meetamask-dl` на `dl.meetamask.com` (зона meetamask.com; токены в Keychain: `cloudflare_meetamask_workers`, `cloudflare_meetamask_dns`; DNS AAAA `dl`→100:: proxied + route `dl.meetamask.com/*`). Редиректит на GitHub Release latest:
  - `https://dl.meetamask.com/app` → MEETAMASK.zip (хост, 844K)
  - `https://dl.meetamask.com/engine` → MEETAMASKEngine.zip (132 МБ)
- **Хост-приложение:** пересобран с новым URL движка (`dl.meetamask.com/engine`, коммит `c88e680`), подписан Developer ID через `dist/sign-host.sh` (БЕЗ Xcode-логина — ручной путь работает), нотаризован (Accepted, id 419a4b5d) + застейплен; `spctl` = Notarized Developer ID. Залит в релиз v0.2.
- Обе цепочки скачивания проверены curl'ом (302 → файл, 206 на range).
- **Осталось до MVP:** (1) живой тест глазами — скачать с dl.meetamask.com/app как юзер, поставить, маска видна в Meet; (2) дёшево: проверка подписи движка при скачивании (F2).

## Раздача движка — СДЕЛАНО (2026-06-10)
- Код на GitHub: **github.com/metawhisp/meetmask** (public). Репо называется `meetmask` (без одной «a»).
- Движок собран → подписан Developer ID (Andrey Dyuzhov, 6D6948Z4MW, inside-out через `dist/package-engine.sh`) → нотаризован + застейплен (`dist/notarize.sh`, профиль `meetamask`, статус Accepted) → `spctl` = «Notarized Developer ID».
- Опубликован как **Release `v0.2`** (asset `MEETAMASKEngine.zip`, 132 МБ). Скачивается без авторизации.
- `EngineInstaller.sourceURL` теперь → `https://github.com/metawhisp/meetmask/releases/latest/download/MEETAMASKEngine.zip` (env `MEETAMASK_ENGINE_URL` всё ещё оверрайдит для дева). Коммит `7542615`.
- Старый мёртвый `dl.meetamask.app` (NXDOMAIN) больше не используется → блокер №1 закрыт.
- **Осталось для «скачал → поставил → работает»:** (1) собрать+подписать+нотаризовать ХОСТ-приложение (`dist/sign-host.sh` + `notarize.sh`) и где-то выложить его на скачивание; (2) проверка подписи движка при скачивании (F2, дёшево); (3) живой тест глазами — маска доходит до Meet.

## FACE OFF — оторви часть лица (Confirmed, 2026-06-28)
Новый пресет (вместо отклонённого WIPE OFF). `Prototype/effects/registry/faceoff.js`, `id: FaceOff`, FACE. Идея founder: пальцем хватаешь глаз/нос/рот, тащишь от лица — на месте остаётся пустая кожа.
- **Как:** полноэкранный фрагмент-шейдер красит камеру; для каждой смещённой части (1) заливает её исходное место кожей с ближнего landmark, (2) пересэмплит пиксели части в точке, куда утащили. Рука = курсор: щипок (большой+указательный) рядом с частью → захват; увёл — отпустил; притащил обратно к лицу → прилипла.
- **Стек:** две модели разом (FaceLandmarker 478 для частей + HandLandmarker для щипка — прецедент catattack). `wantsRawVideo=false`, сами красим видео; ориентация по portalPull (coverUv+mirror).
- **§12-фикс:** плоскость Tracker'а Y-DOWN → vUv.y растёт вниз; `toVuv` отдаёт `(px.x/W, px.y/H)` (без 1−y), иначе позиции частей по Y инвертированы. Базовый кадр upright/не-зеркало (проверено `?fake=1`: TOP/L/«F» верно).
- **Верификация (`?fake=1` + инъекция uniform'ов):** базовая ориентация ок; инъекция смещённой части → дырка кожей на месте + вырезанная часть в точке утаскивания (контент сэмплится верно). tests зелёные. ⚠ Живой захват (лицо+руки, размеры частей, ощущение щипка, качество заливки) — проверить на вебке.
- Регистрация `index.js`, шим `Masks/faceoff/`, тег, `preview.webp`. План-статус: #1 = FACE OFF (готов), #2 FACE SIMON / #3 GOBLIN / #4 LEAN IN — одобрены, в очереди; #5 MARIONETTE — отложен.

## Текущий статус пресетов (2026-06-15, вечер)
FLOW **удалён** из аппки (founder зарубил как невиральную абстракцию). Шипаем 3 виральных, interaction-as-core пресета: **SANDBOX**, **CALL WRAPPED**, **CHOMP**.

## CHOMP — игра лицом (Confirmed, 2026-06-15)
Третий пресет, чистая «interaction = весь фильтр» аркада. `Prototype/effects/registry/chomp.js`, `id: Chomp`, FACE.
- Еда падает сверху (🍎🍌🍒…); двигаешь головой → подставляешь рот, **открываешь рот (jawOpen blendshape) → ешь** (+1). 💣 — рот закрыт, иначе −1 жизнь. 3 жизни → GAME OVER с рекордом (localStorage `chomp_best`). Разгон по очкам.
- Рендер — 2D HUD-canvas в кадр (как callwrapped): падающие эмодзи, кольцо-хитбокс на рту (зелёное при открытом), счёт/жизни, попапы +1/−1, тряска/вспышка на бомбе. Камера сзади (`wantsRawVideo`). Рот через mirror-aware `toPx` → хитбокс на твоём рту; §12 не трогаем.
- Одна face-модель с blendshapes (через флаг базового `Tracker`). Регистрация `index.js`, шим, тег, `preview.webp`.
- **Верификация (`?fake=1` + синтетический рот через `tick`/`play`):** съел еду → +1; съел бомбу → −1 жизнь; спавн/падение/куллинг ок; HUD рисуется в кадре вертикально. tests зелёные. ⚠ Вживую: порог `jawOpen`, размер хитбокса по лицу, fps.

## CALL WRAPPED — счётчик действий на созвоне (Confirmed, 2026-06-15)
Второй пресет под вирал (founder: «фильтр, который считает действия на созвоне и реагирует»). `Prototype/effects/registry/callwrapped.js`, `id: CallWrapped`, FACE.
- **Детект** на одной face-модели с **blendshapes** (включил вариант лоадера с кэшем по ключу: `loadFaceLandmarker({blendshapes:true})`, чтобы не грузить blendshapes другим face-эффектам): улыбка (`mouthSmile`), разговор (`jawOpen` дисперсия), моргания (`eyeBlink`), брови (`browUp`), кивки/мотания (осцилляция носа), отвлёкся (нос ушёл от центра лица). Счётчики с дебаунсом/гистерезисом.
- **Реакция (всё в КАНВАС → видно в Meet + в записи):** live-полоска счётчиков; эскалирующие ачивки-тосты (тон растёт мило→анимешно-ULT, уровни 1-4 с цветом/тряской/вспышкой); финальная карточка **CALL WRAPPED** (архетип THE CHARMER/YES-MAN/SKEPTIC/DAYDREAMER/MAIN CHARACTER/NPC + грид статы + CHAOS SCORE). Весь копирайт — английский (по запросу).
- Триггер карточки — «шок-лицо» (рот+брови) удержать ~1с; пока открыта — счёт на паузе, полоска/тосты скрыты.
- Регистрация в `index.js`, шим `Masks/callwrapped/`, тег, `preview.webp`.
- **Верификация (preview-tools, `?fake=1` + синтетические blendshapes/landmarks через `tick()`):** счётчики растут (smile/blink/nod/talk/lookAway), тосты по тирам, карточка рендерится и помещается (CHAOS SCORE виден), HUD вертикально-корректен (flip не нужен). tests зелёные. ⚠ Вживую проверить: пороги мимики/кивков на реальном лице и fps.

## ⚡ Разворот: interaction-as-core + вирал (2026-06-15)
Founder зарубил FLOW (и весь «алгоритмический арт») как невиральную заставку: «всё ярче сделал, но хуета осталась… не инстаграмная, в тиктоке не завиралится… взаимодействие должно быть ОСНОВНОЙ фишкой фильтра, а не тупой заглушкой». Урок записан в память [[feedback-viral-not-art]]. Новый критерий каждого пресета: про лицо, мгновенно понятно, есть «момент», взаимодействие = вся суть, просится на запись. FLOW 1.0/2.0 остаются в коде, но депрайоритезированы.

### SANDBOX — реактивная физическая песочница (Confirmed, 2026-06-15)
Первый пресет под новый критерий. «Ты — это физика»: `Prototype/effects/registry/sandbox.js`.
- ~170 шариков, кастомная 2D-физика (гравитация + стены + шар-шар через uniform-grid broadphase, 2 итерации релаксации). Рендер — `InstancedMesh` candy-шаров (шейдинг-спрайт + instanceColor) поверх живой камеры.
- **Управление = весь фильтр:** наклон головы → направление гравитации (вся куча едет); голова и обе ладони — кинематические коллайдеры (двигаешь → расталкиваешь/подбрасываешь/ловишь); жесты: ✊ магнит (стягивает шарики), ✋ сдувает. Деградирует: нет лица → гравитация вниз; нет рук → только голова.
- Два детектора: база `Tracker{kind:'face'}` + доп. `loadHandLandmarker` в setup; `update()` гоняет оба на кадр.
- **Доп. механики (2026-06-15):** закрыл лицо рукой → гравитация переворачивается ВВЕРХ (`covered = !faceLms && hands>0`); ✊ кулак ХВАТАЕТ шарики (`heldBy`, пружина к руке, без гравитации, носишь с собой), ✋ ладонь — отпускает+швыряет (доб. скорость руки). Проверено инъекцией: covered→gy<0; захват 17→держатся точно на руке при движении; раскрытие→released+летят.
- Регистрация `index.js` (`id: Sandbox`, FACE), шим `Masks/sandbox/index.html`, тег, `preview.webp`.
- **Верификация (preview-tools, `?fake=1`):** §12 — гравитация вниз пилит шарики у НИЗА (верно); тилт-гравитация (gx,gy) → куча уезжает в нужный угол; ✊-магнит → шарики залипают на руке против гравитации; коллизии/стены/пайл — ок; рендер чистый. Кадры прокачаны синхронно (hidden-tab rAF на паузе). ⚠ Не проверено вживую: связка реальное лицо/руки→коллайдеры (нужна вебка) и fps двух MP-моделей — проверить в живом тесте.

## Алгоритмические интерактивные пресеты (2026-06-15)
Цель: добавить «алгоритмические» интерактивные маски (вдохновение — generative-art инструменты: flow fields, reaction-diffusion, клеточные автоматы). Сгенерировано 3 идеи, каждая — отдельное семейство алгоритмов, управляемое телом юзера:
1. **FLOW** — curl-noise flow field, рулится руками (✊ воронка / ✋ фонтан). ✅ **СДЕЛАНО** → 🔵 **идёт FLOW 2.0** (founder: «должно быть в 10 раз прикольнее»). Вайб: чернила/аврора (холодная палитра, à la parallel.ai). План 4 фазы; **Фаза 1 (рендер) — СДЕЛАНА.**
2. **MORPHOGEN** — reaction-diffusion (Gray-Scott), узоры Тьюринга прорастают из движения. ⏳ план (ping-pong FBO; `ctx.renderer` уже проброшен).
3. **LIFEFORM** — клеточный автомат (Game of Life), засев из силуэта/движения. ⏳ план (та же ping-pong-инфра, что у #2).

### FLOW 2.0 — Фаза 1 «рендер» (Confirmed, 2026-06-15)
- Переписан рендер-стек в `flow.js`: ушли от 1px-линий к **накопительному FBO** (длинные шёлковые шлейфы; затухание `TRAIL_FADE` = память трейла, без per-particle истории) + **сепарабельный bloom** (half-res) + **мягкие толстые спрайты** (`THREE.Points`, аддитив). Финальный композит сам красит камеру (`wantsRawVideo=false`, `sampleVideo` + Y-flip как portalPull) → затемнение/десатурация/виньетка; холодная палитра-аврора (HSL band cyan→violet).
- 5000 частиц; «свечение» даёт bloom (а не пересвет трейла → нет clipping в белое). Поле и руки — как в 1.0.
- **Верификация (preview-tools, `?fake=1`):** §12 ориентация ок (TOP/L/F вертикально, не зеркало); FBO+bloom+композит рендерятся; цвет холодный, структура curl читается. Кадры прокачаны синхронно (hidden-tab rAF на паузе). Превью обновлено под новую палитру.
- ⏳ Дальше (по решению founder): Фаза 2 (эмиссия из силуэта + покраска от видео + огибание лица), Фаза 3 (струи из пальцев + жест-режимы), Фаза 4 (motion-energy/грейд).

### FLOW 1.0 — реализация (Confirmed)
- `Prototype/effects/registry/flow.js` — `Tracker{kind:'hand'}`; 2400 частиц с трейлами (один `LineSegments`, additive), поле = curl аналитической stream-функции (divergence-free → нет слипания). Руки = вихрь + радиальная сила (знак по «открытости» ладони из landmarks). Без рук — амбиент-поток. Камера видна позади (`wantsRawVideo`), затемнение plate'ом; ничего не красит через `uVideo` → §12 соблюдён by-construction.
- Регистрация: `Prototype/effects/index.js` (`id: 'Flow'`, category `HAND`). Шим: `Masks/flow/index.html` → `autostart=Flow`. Тег: `Masks/tags.json`. Превью: `Masks/flow/preview.webp` (из registry-`preview()`).
- **Верификация (браузер, preview-tools):** грузится без ошибок; `setup` ок; §12 ориентация верна (`?fake=1` → TOP/BOTTOM/L/R, «F» читается); трейлы рендерятся (33600 верт., цвет ок), поле закручивается. Прогон `tests/run-all.sh` — зелёный. Примечание: headless-вкладка `document.hidden=true` → rAF на паузе; для проверки кадры прокачивались синхронно из eval.

## Решения (кратко; детали — в SPEC.md и памяти проекта)
- Архитектура: виртуальная камера (CMIOExtension). Chrome-расширение отвергнуто.
- Оптимизируем под качество + удобство конечного пользователя.
- Team ID: **6D6948Z4MW** (индивидуальный). Bundle: `com.meetamask.app`.
- Подпись сейчас: Development (auto). Developer ID + нотаризация — на M4.
- SIP не трогаем; dev-mode не используем.
