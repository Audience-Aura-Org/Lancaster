(function () {
    'use strict';

    var loader = document.querySelector('.preloader');
    if (!loader || document.readyState === 'complete') return;

    // Avoid flashing an overlay on fast or cached page loads.
    var showTimer = window.setTimeout(function () {
        loader.hidden = false;
    }, 150);

    // A stalled asset must not prevent access to the page indefinitely.
    var fallbackTimer = window.setTimeout(dismiss, 10000);

    function dismiss() {
        window.clearTimeout(showTimer);
        window.clearTimeout(fallbackTimer);
        loader.hidden = true;
        window.removeEventListener('load', dismiss);
        window.removeEventListener('pageshow', dismiss);
    }

    window.addEventListener('load', dismiss);
    window.addEventListener('pageshow', dismiss);
}());
