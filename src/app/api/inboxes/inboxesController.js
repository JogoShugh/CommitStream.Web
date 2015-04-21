(function(inboxesController) {
  var uuid = require('uuid-v4'),
    config = require('../../config'),
    validator = require('validator'),
    eventStore = require('../helpers/eventStoreClient'),
    bodyParser = require('body-parser'),
    request = require('request'),
    hypermediaResponse = require('../hypermediaResponse'),
    translator = require('../translators/githubTranslator'),
    csError = require('../../middleware/csError');

  inboxesController.init = function(app) {
    app.post('/api/:instanceId/digests/:digestId/inboxes', bodyParser.json(), require('./inboxCreate'));

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

    app.get('/api/:instanceId/inboxes/:inboxId', require('./inboxGet'));
  };

})(module.exports);