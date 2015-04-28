var express = require('express'),
  app = express(),
  cors = require('cors'),
  config = require('./config'),
  exphbs = require('express-handlebars'),
  validation = require('./configValidation'),
  csError = require('./middleware/csError'),
  instanceAuthenticator = require('./middleware/instanceAuthenticator'),
  apiRoutesRequireContentTypeAppJson = require('./middleware/apiRoutesRequireContentTypeAppJson'),
  appConfigure = require('./middleware/appConfigure'),
  Promise = require('bluebird'),
  domainMiddleware = require('express-domain-middleware');

// DO NOT MOVE THIS. It is here to wrap routes in a domain to catch unhandled errors
app.use(domainMiddleware);

// DO NOT MOVE THIS. It is here to handle unhandled rejected Promises cleanly
Promise.onPossiblyUnhandledRejection(function(err) {
  throw err;
});

validation.validateConfig();
validation.validateEventStore(function(error) {
  if (error) {
    throw new Error(error);
  }
});

app.get('/version', function(req, res) {
  res.json({
    version: "0.0.0"
  });
});

var api = require("./api");
require('./bootstrapper').boot(config);

// Wire up express-handlebars as the view engine for express.
app.engine('handlebars', exphbs());
app.set('view engine', 'handlebars');

// NOTE: Do not rearrange the order of these app.* statements becaused they
// are crucial for the order of operations in the pipeline of middleware
// functions!
app.use(cors());

app.use(express.static(__dirname + '/client'));

app.get('/instances', function(req, res) {
  res.render('instances');
});

// Ensure that all routes with :instanceId parameters are properly authenticated
app.param('instanceId', instanceAuthenticator);

// NOTE: See above warning. Why are you even considering moving these?
// Think thrice.
appConfigure(app);

// SPIKE: Provide a public entry point for the API
app.get('/api/public', function(req, res) {
  res.set('Content-Type', 'application/hal+json');
  res.status(200).send({
    "_links":{
      "self":{
        "href":req.href("/api/public")
      },
      "instances":{
        "href":req.href("/api/instances"),
        "templated":false
      }
    }
  });
});

// Return a URL as a special header for each request
app.use(function(req, res, next) {
  res.setHeader("X-CommitStream-API-Docs", "https://github.com/openAgile/CommitStream.Web");
  return next();
});

// This must happen here, before we cover additional routes with Content-Type validation
require('./api/instances/instancesController').init(app);

// Ensure all API routes have consistent Content-Type validation
app.all('/api/*', apiRoutesRequireContentTypeAppJson);

// Map API the routes
api.init(app);

// DO NOT MOVE THIS. It must be here to catch unhandled errors.
app.use(csError.errorHandler);

app.get('/app', function(req, res) {
  res.setHeader('content-type', 'application/javascript');
  var protocol = config.protocol || req.protocol;
  var host = req.get('host');
  var key = req.query.key;

  res.render('app', {
    apiUrl: protocol + '://' + host + '/api/',
    protocol: protocol,
    resourcePath: protocol + '://' + host + '/'
  });
});

app.listen(config.port, function() {
  console.log('CommitStream Web Server listening on port ' + config.port);
});