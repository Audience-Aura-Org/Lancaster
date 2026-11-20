(function () {
  'use strict';
  // Quote form: show pet or cargo fields depending on the chosen service.
  var sel = document.querySelector('[data-service-select]');
  function sync() {
    if (!sel) return;
    var opt = sel.options[sel.selectedIndex];
    var cat = opt && opt.getAttribute('data-category');
    document.querySelectorAll('[data-show-for]').forEach(function (el) {
      el.hidden = cat ? el.getAttribute('data-show-for') !== cat : el.getAttribute('data-show-for') !== 'pet';
    });
  }
  if (sel) { sel.addEventListener('change', sync); sync(); }

  // Dates can't be in the past.
  var d = new Date();
  var iso = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  document.querySelectorAll('input[type=date][data-future]').forEach(function (el) { el.min = iso; });

  // Prevent double submits.
  document.querySelectorAll('form.lpm-form').forEach(function (f) {
    f.addEventListener('submit', function () { var b = f.querySelector('[type=submit]'); if (b) b.disabled = true; });
  });
})();
