(function() {
  var validateUUID = require('../validateUUID'),
    eventStore = require('../helpers/eventStoreClient'),
    translatorFactory = require('../translators/translatorFactory'),
    commitsAddedFormatAsHal = require('./commitsAddedFormatAsHal');

  module.exports = function(req, res) {
    var instanceId = req.instance.instanceId,
      digestId = req.inbox.digestId,
      inboxId = req.params.inboxId;

    validateUUID('inbox', inboxId);

    var translator = translatorFactory.create(req);

    if (translator) {
      var events = translator.translatePush(req.body, instanceId, digestId, inboxId);

      var postArgs = {
        name: 'inboxCommits-' + inboxId,
        events: events
      };

      eventStore.postToStream(postArgs)
        .then(function() {
          var inboxData = {
            inboxId: inboxId,
            digestId: digestId
          };

          var hypermedia = commitsAddedFormatAsHal(req.href, instanceId, inboxData);
          //TODO: ask about this
          //res.location(responseData._links['query-digest'].href);
          res.hal(hypermedia, 201);
        });
      // } else if (eventType === 'ping') {
      //   // THIS CAN BE DELETED, WHEN CREATING A GITHUB WEBHOOK THEY DON'T NEED US TO REPLY
      //   res.json({
      //     message: 'Pong.'
      //   });
    } else {
      // log to error somewhere and respond approriately
    }

  };
}());