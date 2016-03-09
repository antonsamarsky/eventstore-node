var util = require('util');
var uuid = require('uuid');

var TcpCommand = require('../systemData/tcpCommand');
var InspectionDecision = require('../systemData/inspectionDecision');
var InspectionResult = require('./../systemData/inspectionResult');
var ClientMessage = require('../messages/clientMessage');
var WriteResult = require('../results').WriteResult;
var Position = require('../results').Position;

var OperationBase = require('../clientOperations/operationBase');

function AppendToStreamOperation(log, cb, requireMaster, stream, expectedVersion, events, userCredentials) {
  OperationBase.call(this, log, cb, TcpCommand.WriteEvents, TcpCommand.WriteEventsCompleted, userCredentials);
  this._responseType = ClientMessage.WriteEventsCompleted;

  this._requireMaster = requireMaster;
  this._stream = stream;
  this._expectedVersion = expectedVersion;
  this._events = events;
}
util.inherits(AppendToStreamOperation, OperationBase);

AppendToStreamOperation.prototype._createRequestDto = function() {
  var dtos = this._events.map(function(ev) {
    var eventId = new Buffer(uuid.parse(ev.eventId));
    return new ClientMessage.NewEvent({
      event_id: eventId, event_type: ev.type,
      data_content_type: ev.isJson ? 1 : 0, metadata_content_type: 0,
      data: ev.data, metadata: ev.metadata});
  });
  return new ClientMessage.WriteEvents({
    event_stream_id: this._stream,
    expected_version: this._expectedVersion,
    events: dtos,
    require_master: this._requireMaster});
};

AppendToStreamOperation.prototype._inspectResponse = function(response) {
  switch (response.result)
  {
    case ClientMessage.OperationResult.Success:
      if (this._wasCommitTimeout)
        this.log.debug("IDEMPOTENT WRITE SUCCEEDED FOR %s.", this);
      this._succeed();
      return new InspectionResult(InspectionDecision.EndOperation, "Success");
    case ClientMessage.OperationResult.PrepareTimeout:
      return new InspectionResult(InspectionDecision.Retry, "PrepareTimeout");
    case ClientMessage.OperationResult.ForwardTimeout:
      return new InspectionResult(InspectionDecision.Retry, "ForwardTimeout");
    case ClientMessage.OperationResult.CommitTimeout:
      this._wasCommitTimeout = true;
      return new InspectionResult(InspectionDecision.Retry, "CommitTimeout");
    case ClientMessage.OperationResult.WrongExpectedVersion:
      var err = ["Append failed due to WrongExpectedVersion. Stream: ", this._stream,", Expected version: ", this._expectedVersion].join('');
      this.fail(new Error(err));
      return new InspectionResult(InspectionDecision.EndOperation, "WrongExpectedVersion");
    case ClientMessage.OperationResult.StreamDeleted:
      this.fail(new Error("Stream deleted. Stream: " + this._stream));
      return new InspectionResult(InspectionDecision.EndOperation, "StreamDeleted");
    case ClientMessage.OperationResult.InvalidTransaction:
      this.fail(new Error("Invalid transaction."));
      return new InspectionResult(InspectionDecision.EndOperation, "InvalidTransaction");
    case ClientMessage.OperationResult.AccessDenied:
      this.fail(new Error(["Write access denied for stream '", this._stream, "'."].join('')));
      return new InspectionResult(InspectionDecision.EndOperation, "AccessDenied");
    default:
      throw new Error("Unexpected OperationResult: " + response.result);
  }
};

AppendToStreamOperation.prototype._transformResponse = function(response) {
  return new WriteResult(response.last_event_number, new Position(response.prepare_position || -1, response.commit_position || -1));
};

AppendToStreamOperation.prototype.toString = function() {
  return util.format("Stream: %s, ExpectedVersion: %d", this._stream, this._expectedVersion);
};

module.exports = AppendToStreamOperation;