(function ($) {
    'use strict';

    $(function () {
        if ($.fn.slicknav && $('#menu').length) $('#menu').slicknav({ label: '', prependTo: '.responsive-menu' });

        function setHeaderHeight() {
            var height = $('header .header-sticky').outerHeight();
            if (height) $('header.main-header').css('height', height);
        }

        setHeaderHeight();
        $(window).on('resize', setHeaderHeight);
        $(window).on('scroll', function () {
            var fromTop = $(window).scrollTop();
            var headerHeight = $('header .header-sticky').outerHeight() || 0;
            setHeaderHeight();
            $('header .header-sticky').toggleClass('hide', fromTop > headerHeight + 100);
            $('header .header-sticky').toggleClass('active', fromTop > 600);
        });
    });
})(jQuery);
