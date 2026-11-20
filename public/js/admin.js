(function () {
  'use strict';
  var sidebar = document.getElementById('sidebar');
  var toggle = document.querySelector('.admin-topbar .nav-toggle');
  var backdrop = document.querySelector('.sidebar-backdrop');
  function setOpen(open) {
    if (!sidebar) return;
    sidebar.classList.toggle('open', open);
    if (backdrop) backdrop.classList.toggle('show', open);
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
  }
  if (toggle) toggle.addEventListener('click', function () { setOpen(!sidebar.classList.contains('open')); });
  if (backdrop) backdrop.addEventListener('click', function () { setOpen(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') setOpen(false); });

  // Confirmation prompts: <form data-confirm="Are you sure?">
  document.querySelectorAll('form[data-confirm]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      if (!window.confirm(f.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Confirmation on individual buttons: <button data-confirm="Remove this?">
  document.querySelectorAll('button[data-confirm]').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      if (!window.confirm(btn.getAttribute('data-confirm'))) e.preventDefault();
    });
  });

  // Prevent double-submits on email-sending forms.
  document.querySelectorAll('form[data-once]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (e.defaultPrevented) return;
      var btn = form.querySelector('[type=submit]');
      if (btn) setTimeout(function () { btn.disabled = true; }, 0);
    });
  });

  // New booking: show the document list for the chosen service (standard documents are pre-ticked).
  var svcSelect = document.getElementById('f-service_type');
  if (svcSelect && document.querySelector('[data-docs-for]')) {
    var syncDocs = function () {
      var svc = svcSelect.value;
      document.querySelectorAll('[data-docs-for]').forEach(function (el) { el.hidden = el.getAttribute('data-docs-for') !== svc; });
      var hint = document.querySelector('[data-docs-hint]');
      if (hint) hint.style.display = svc ? 'none' : '';
    };
    svcSelect.addEventListener('change', syncDocs);
    syncDocs();
  }

  // "No documents needed": disable and dim the document lists in the same form.
  document.querySelectorAll('[data-docs-none]').forEach(function (box) {
    var form = box.form;
    var sync = function () {
      form.querySelectorAll('[data-docs-area]').forEach(function (area) {
        area.classList.toggle('is-off', box.checked);
        area.querySelectorAll('input, textarea, select').forEach(function (el) { el.disabled = box.checked; });
      });
    };
    box.addEventListener('change', sync);
    sync();
  });

  // Auto-submit filter selects.
  document.querySelectorAll('select[data-autosubmit]').forEach(function (s) {
    s.addEventListener('change', function () { s.form.submit(); });
  });
})();
