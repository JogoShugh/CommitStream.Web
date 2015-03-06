(function(instancesController) {
  var uuid = require('uuid-v4'),
    config = require('../config'),
    csError = require('../csError'),
    validator = require('validator'),
    instanceAdded = require('./events/instanceAdded'),
    eventStore = require('./helpers/eventStoreClient'),
    bodyParser = require('body-parser'),
    sanitize = require('sanitize-html'),
    _ = require('underscore');

  function createHypermediaResponse(href, instanceId, apiKey) {
    var response = {
      "_links": {
        "self": {
          "href": href("/api/instances/" + instanceId)
        },
        "digests": {
          "href": href("/api/" + instanceId + "/digests")
        },
        "digest-create": {
          "href": href("/api/" + instanceId + "/digests"),
          "method": "POST",
          "title": "Endpoint for creating a digest on instance " + instanceId + "."
        }
      },
      "instanceId": instanceId,
      "apiKey": apiKey
    };

    return response;
  }

  function authorize(req, res, next) {
    if (!config.apiKey || !req.query.apiKey || req.query.apiKey !== config.apiKey) {
      csError.errorHandler(csError('apiKey parameter missing or invalid', 401), req, res);
    } else {
      next();
    }
  };  

  instancesController.init = function(app) {
    app.post('/api/instances', bodyParser.json(), authorize, function(req, res) {
      var contentType = req.get('Content-Type');

      if (!contentType || contentType.toLowerCase() !== 'application/json') {
        throw csError('When creating an instance, you must send a Content-Type: application/json header.', 415);
      }

      // TODO: need to check if an instance ALREADY exists for this id and if so, reject!

      function hasErrors(errors) {
        return errors.length > 0;
      }

      // TODO: should we validate the format of the instanceId?

      var errors = instanceAdded.validate(req.body);
      if (hasErrors(errors)) {
        throw csError(errors);
      }

      var instanceAddedEvent = instanceAdded.create(req.body.instanceId);

      var args = {
        name: 'instances',
        events: JSON.stringify([instanceAddedEvent])
      };

      eventStore.streams.post(args, function(error, resp) {
        if (error) {
          csError.errorHandler(error, req, res); // TODO replace hacky csError stuff with http://nodejs.org/api/domain.html https://www.npmjs.com/package/express-domain-middleware
        } else {
          var hypermedia = createHypermediaResponse(req.href, instanceAddedEvent.data.instanceId, instanceAddedEvent.data.apiKey);

          res.location(hypermedia._links.self.href);
          res.set('Content-Type', 'application/hal+json');
          res.status(201);

          setTimeout(function() {
            res.send(hypermedia);
          }, config.controllerResponseDelay);
        }
      });
    });

    app.get('/api/instances/:instanceId', function(req, res) {
      // TODO replace hacky csError stuff with http://nodejs.org/api/domain.html https://www.npmjs.com/package/express-domain-middleware
      if (!validator.isUUID(req.params.instanceId)) { // <-- TODO this may not actually be a UUID
        throw csError('The value "' + req.params.instanceId + '" is not recognized as a valid instance identifier.');
      } else {
        eventStore.projection.getState({
          name: 'instance',
          partition: 'instance-' + req.params.instanceId
        }, function(err, resp) {
          if (err) {
            csError.errorHandler(err, req, res);
          } else if (!resp.body || resp.body.length < 1 || resp.statusCode === 404) { // TODO: we should handle 404 from EventStore consistently
            csError.errorHandler(csError('Could not find an instance with id ' + req.params.instanceId, 404), req, res);
            //throw csError('Could not find an instance with id ' + req.params.instanceId, 404);
          } else { // all good
            var data = JSON.parse(resp.body);
            var hypermedia = createHypermediaResponse(req.href, data.instanceId, data.apiKey);
            res.set('Content-Type', 'application/hal+json; charset=utf-8');
            res.send(hypermedia);
          }
        });
      }
    });
  };  
})(module.exports);