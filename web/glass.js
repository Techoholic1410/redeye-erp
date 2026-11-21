// Liquid Glass motion layer: pointer-driven specular highlight, sliding pills, staggered entrances, graceful exits.
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const HOT = '.panel,.side,.top,.modal,.drawer,.tw,.calwrap,.col,.card2,.need,.btn,.iconbtn,.cal .d,.seg,.login .card';

// light that follows the pointer across whichever glass surface it is over
let hot = null;
const light = (el, e) => { const r = el.getBoundingClientRect(); el.style.setProperty('--mx', e.clientX - r.left + 'px'); el.style.setProperty('--my', e.clientY - r.top + 'px'); };
const track = (e) => {
  const el = e.target.closest?.(HOT);
  if (el !== hot) { hot?.style.setProperty('--hlo', 0); hot = el; el?.style.setProperty('--hlo', 1); }
  if (el) light(el, e);
};
document.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') track(e); }, { passive: true });
document.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') track(e); }, { passive: true });
document.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') { hot?.style.setProperty('--hlo', 0); hot = null; } }, { passive: true });
document.documentElement.addEventListener('pointerleave', () => { hot?.style.setProperty('--hlo', 0); hot = null; });

// the backdrop drifts slightly against the pointer, giving the glass depth
if (!reduce) {
  const bg = () => document.querySelector('.bg');
  let raf = 0;
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || raf) return;
    raf = requestAnimationFrame(() => { raf = 0; const b = bg(); if (!b) return; b.style.transform = `scale(1.08) translate3d(${(e.clientX / innerWidth - .5) * -26}px, ${(e.clientY / innerHeight - .5) * -26}px, 0)`; });
  }, { passive: true });
}

// sliding indicator behind the active menu item
function syncNav() {
  const nav = document.getElementById('nav'); if (!nav) return;
  let pill = nav.querySelector(':scope > .navpill');
  if (!pill) { pill = document.createElement('i'); pill.className = 'navpill'; nav.prepend(pill); }
  const on = nav.querySelector('a.on');
  if (!on) { pill.style.setProperty('--po', 0); return; }
  pill.style.setProperty('--py', on.offsetTop + 'px'); pill.style.setProperty('--ph', on.offsetHeight + 'px'); pill.style.setProperty('--po', 1);
}
// sliding indicator inside segmented controls (Table / Board / Calendar, tabs)
function syncSegs() {
  document.querySelectorAll('.seg').forEach((seg) => {
    let pill = seg.querySelector(':scope > .segpill');
    if (!pill) { pill = document.createElement('i'); pill.className = 'segpill'; seg.prepend(pill); }
    const on = seg.querySelector('button.on'); if (!on) return;
    pill.style.setProperty('--sx', on.offsetLeft + 'px'); pill.style.setProperty('--sw', on.offsetWidth + 'px');
  });
}
// stagger: each child of a list-like container enters a beat after the one before it
const LISTS = '#view,#nav,.grid,.stack,.board,.pipe,tbody,.panel,.cmlist';
function stagger() {
  document.querySelectorAll(LISTS).forEach((p) => { let i = 0; for (const c of p.children) { if (!c.style.getPropertyValue('--i')) c.style.setProperty('--i', Math.min(i, 14)); i++; } });
}

let queued = false;
const sync = () => { queued = false; syncNav(); syncSegs(); stagger(); };
new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(sync); } }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
addEventListener('resize', () => requestAnimationFrame(sync));
requestAnimationFrame(sync);

// popups and drawers fade/slide out instead of vanishing
if (!reduce) {
  const rm = Element.prototype.remove;
  Element.prototype.remove = function () {
    const c = this.classList;
    if (c && (c.contains('ov') || c.contains('drawer')) && !this._leaving) {
      this._leaving = true; c.add('leave');
      setTimeout(() => rm.call(this), c.contains('drawer') ? 300 : 280);
      return;
    }
    rm.call(this);
  };
}

// Chromium can bend what is behind the glass (liquid refraction); Safari/Firefox keep the frosted look
if (/Chrome\//.test(navigator.userAgent) && !reduce) document.documentElement.classList.add('lens');
