// Loads the Tawk.to live chat widget for the property set in TAWK_PROPERTY (e.g. "abc123/default").
(function () {
  var me = document.currentScript || document.querySelector('script[data-tawk]');
  var id = me && me.getAttribute('data-tawk');
  if (!id || !/^[A-Za-z0-9]+\/[A-Za-z0-9]+$/.test(id)) return;
  window.Tawk_API = window.Tawk_API || {};
  window.Tawk_LoadStart = new Date();
  var s = document.createElement('script');
  s.async = true;
  s.src = 'https://embed.tawk.to/' + id;
  s.charset = 'UTF-8';
  s.setAttribute('crossorigin', '*');
  document.head.appendChild(s);
})();
