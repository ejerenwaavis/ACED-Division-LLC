$(document).ready(function () {
    // Smooth scroll to next section on button click
    $('#scroll-btn').on('click', function () {
        $('html, body').animate({
            scrollTop: $('#next-section').offset().top
        }, 800);
    });
});
