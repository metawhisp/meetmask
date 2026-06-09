#!/bin/bash
# Run THIS yourself (it needs YOUR Apple ID password, which only you may enter):
#   bash dist/setup-notary.sh
#
# It registers your app-specific password as a notarytool keychain profile named
# "meetamask". You type the password into notarytool's OWN secure prompt — it is not
# passed through this script or shown anywhere.
set -e
echo "Apple ID email (the one you log in to appleid.apple.com with):"
read -r APPLEID
echo ""
echo "notarytool will now ask for your APP-SPECIFIC password (format xxxx-xxxx-xxxx-xxxx)."
echo "Paste it at the prompt and press Enter."
echo ""
xcrun notarytool store-credentials "meetamask" \
  --apple-id "$APPLEID" \
  --team-id  "6D6948Z4MW"
echo ""
echo "✅ If you saw 'Credentials validated.' above — say «готово» in the chat and I'll notarize."
