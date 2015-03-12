(function(inboxesController) {
  var uuid = require('uuid-v4'),
    config = require('../config'),
    validator = require('validator'),
    inboxAdded = require('./events/inboxAdded'),
    eventStore = require('./helpers/eventStoreClient'),
    bodyParser = require('body-parser'),
    sanitize = require('./sanitizer').sanitize,
    request = require('request'),
    hypermediaResponse = require('./hypermediaResponse'),
    translator = require('./translators/githubTranslator'),
    csError = require('../csError');

  inboxesController.init = function(app) {

    app.post('/api/:instanceId/digests/:digestId/inboxes', bodyParser.json(), function(req, res) {
      var contentType = req.get('Content-Type');

      if (!contentType || contentType.toLowerCase() !== 'application/json') {
        res.status(415).send('When creating an inbox, you must send a Content-Type: application/json header.');
        return;
      }

      function hasErrors(errors) {
        return errors.length > 0;
      }

      function throwErrors(errors) {
        throw csError(errors);
      }

      var errors = sanitize('inbox', req.body, ['name']);
      if (hasErrors(errors)) {
        throwErrors(errors);
      }

      req.body.digestId = req.params.digestId;
      errors = inboxAdded.validate(req.body);
      if (hasErrors(errors)) {
        throwErrors(errors);
      }

      getPartitionState('digest', req.body.digestId, function(err, resp) {
        if (err) {
          res.status(500).json({
            'error': 'There was an internal error when trying to process your request.'
          });
        } else if (!resp.body || !resp.body.length) {
          res.status(404).json({
            'error': 'Could not find a digest with id ' + req.body.digestId + '.'
          });
          return;
        } else {          
          var inboxAddedEvent = inboxAdded.create(req.body.digestId, req.body.family, req.body.name, req.body.url);          

          var args = {
            name: 'inboxes-' + req.instance.instanceId,
            events: JSON.stringify([inboxAddedEvent])
          };

          eventStore.streams.post(args, function(error, resp) {
            if (error) {
              console.log(error);
              res.status(500).json({
                errors: 'We had an internal problem. Please retry your request. Error: ' + error
              });
            } else {
              var hypermedia = hypermediaResponse.inboxes.POST(req.href, req.instance.instanceId, inboxAddedEvent.data.inboxId);

              res.location(hypermedia._links.self.href);
              res.set('Content-Type', 'application/hal+json');
              res.status(201);

              // Delay to allow EventStore to project the state properly
              setTimeout(function() {
                res.send(hypermedia);
              }, config.controllerResponseDelay);
             
            }
          });
        }
      });

    });

    app.post('/api/:instanceId/inboxes/:inboxId/commits', bodyParser.json(), function(req, res, next) {
      var contentType = req.get('Content-Type');

      if (!contentType || contentType.toLowerCase() !== 'application/json') {
        res.status(415).send('When posting to an inbox, you must send a Content-Type: application/json header.');
        return;
      }

      var responseData = {};
      res.set('Content-Type', 'application/json');

      if (!validator.isUUID(req.params.inboxId)) {

        responseData = {
          message: 'The value ' + req.params.inboxId + ' is not recognized as a valid inbox identifier.'
        };

        res.status(400);
        res.send(responseData);

      } else {
        getPartitionState('inbox', req.params.inboxId, function(error, response) {

          if (!error && response.statusCode == 200) {

            var inbox, digestId;

            try {
              inbox = JSON.parse(response.body);
              digestId = inbox.digestId;
            } catch (ex) {
              console.log("THE EXCEPTION:");
              console.log(ex);
              console.log("THE RESPONSE BODY:");
              console.log(response.body);
              throw ex;
            }

            //TODO: all this logic, yikes!
            if (!req.headers.hasOwnProperty('x-github-event')) {

              responseData = {
                errors: 'Unknown event type. Please include an x-github-event header.'
              };

              res.status(400).send(responseData);
            } else if (req.headers['x-github-event'] == 'push') {

              var inboxId = req.params.inboxId;

              var events = translator.translatePush(req.body, req.instance.instanceId, digestId, inboxId);

              var e = JSON.stringify(events);

              eventStore.streams.post({
                name: 'inboxCommits-' + inboxId,
                events: e
              }, function(error, response) {
                if (error) {
                  responseData = {
                    errors: 'We had an internal problem. Please retry your request. Error: ' + error
                  };

                  res.status(500);
                } else {

                  var hypermediaData = {
                    inboxId: inboxId,
                    digestId: digestId
                  };

                  responseData = hypermediaResponse.inboxes.inboxId.commits.POST(req.href, req.instance.instanceId, hypermediaData);

                  res.set('Content-Type', 'application/hal+json');
                  res.location(responseData._links['query-digest'].href);
                  res.status(201);
                }

                res.send(responseData);
              });

            } else if (req.headers['x-github-event'] == 'ping') {
              responseData = {
                message: 'Pong.'
              };
              res.status(200).send(responseData);
            } else {
              responseData = {
                message: 'Unknown event type for x-github-event header : ' + req.headers['x-github-event']
              };
              res.status(400).send(responseData);
            }
          } else {
            responseData = {
              message: error
            };
            res.status(500).send(responseData);
          }
        });
      }
    });

    app.get('/api/:instanceId/inboxes/:inboxId', function(req, res, next) {
      if (!validator.isUUID(req.params.inboxId)) {
        res.status(400).send('The value "' + req.params.inboxId + '" is not recognized as a valid inbox identifier.');
      } else {
        getPartitionState('inbox', req.params.inboxId, function(err, resp) {
          if (err) {
            res.status(500).json({
              'error': 'There was an internal error when trying to process your request'
            });
          } else if (!resp.body || resp.body.length < 1) {
            res.status(404).json({
              'error': 'Could not find an inbox with id ' + req.params.inboxId
            });
          } else { // all good
            var data = JSON.parse(resp.body);

            var hypermedia = hypermediaResponse.inboxes.inboxId.GET(req.href, req.instance.instanceId, data);

            res.set('Content-Type', 'application/hal+json; charset=utf-8');
            res.status(200).send(hypermedia);
          }
        });
      }
    });

    var getPartitionState = function(name, uuid, callback) {
      eventStore.projection.getState({
        name: name,
        partition: name + '-' + uuid
      }, function(err, resp) {
        callback(err, resp);
      });
    }
  }

})(module.exports);