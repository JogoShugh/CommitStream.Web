(function() {
    var protocol = "//";
    require.config({
        paths: {
          moment: protocol + 'cdnjs.cloudflare.com/ajax/libs/moment.js/2.8.2/moment.min',
          //handlebars: protocol + 'cdnjs.cloudflare.com/ajax/libs/handlebars.js/2.0.0-alpha.4/handlebars.amd.min'
        },
        config: {
            moment: {
                noGlobal: true
            }
        }
    });
})();
