// Landing — reveal + CTAs. Download buttons point at the live notarized build.
const $ = (s)=>document.querySelector(s);
const toast=(m)=>{const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(t._);t._=setTimeout(()=>t.classList.remove('show'),2600);};
['dlBtn','dlBtn2','dlBtn3'].forEach(id=>{const b=$('#'+id); if(b) b.onclick=()=>{location.href='https://dl.meetamask.com/app';};});

const io=new IntersectionObserver((es)=>es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target);}}),{threshold:.12,rootMargin:'0px 0px -8% 0px'});
document.querySelectorAll('.rv').forEach(el=>{
  const sibs=[...el.parentElement.children].filter(c=>c.classList.contains('rv'));
  el.style.transitionDelay=Math.min(sibs.indexOf(el)*70,350)+'ms';
  io.observe(el);
});
