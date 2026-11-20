// Public site mobile menu: slide-in drawer with an expandable "Services" group.
(function () {
  'use strict';
  var drawer = document.getElementById('lpm-drawer');
  var openBtn = document.querySelector('.lpm-menu-btn');
  var backdrop = document.querySelector('.lpm-drawer-backdrop');
  if (!drawer || !openBtn) return;

  function setOpen(open) {
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    openBtn.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('lpm-menu-open', open);
    if (backdrop) {
      if (open) { backdrop.hidden = false; requestAnimationFrame(function () { backdrop.classList.add('is-open'); }); }
      else { backdrop.classList.remove('is-open'); setTimeout(function () { if (!drawer.classList.contains('is-open')) backdrop.hidden = true; }, 250); }
    }
    if (open) drawer.focus(); else openBtn.focus();
  }

  openBtn.addEventListener('click', function () { setOpen(true); });
  document.querySelectorAll('[data-menu-close]').forEach(function (el) { el.addEventListener('click', function () { setOpen(false); }); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && drawer.classList.contains('is-open')) setOpen(false); });
  window.addEventListener('resize', function () { if (window.innerWidth >= 992 && drawer.classList.contains('is-open')) setOpen(false); });
  drawer.querySelectorAll('a').forEach(function (a) { a.addEventListener('click', function () { setOpen(false); }); });

  // Services accordion
  var group = drawer.querySelector('.lpm-drawer-group');
  var sub = document.getElementById('lpm-drawer-services');
  if (group && sub) {
    group.addEventListener('click', function () {
      var open = group.getAttribute('aria-expanded') !== 'true';
      group.setAttribute('aria-expanded', String(open));
      sub.hidden = !open;
    });
  }
})();
