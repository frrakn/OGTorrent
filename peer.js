"use strict";

var Event = require("events");
var net = require("net");

function Peer(peerIP, port, fileLength){
	this.socket = new net.Socket();
	this.peerIP = peerIP;
	this.port = port;
	this.messageBuffer = new Buffer(0);
	this.availPieces = new Buffer(fileLength);
	this.choked = true;
	this.interested = false;
	this.peerChoked = true;
	this.peerInterested = false;
	this.requests = [];
	this.requested = [];

	this.socket.on("data", function(data){
		this.messageBuffer = Buffer.concat([this.messageBuffer, data]);
		var temp;
		var message;
		do{
			temp = messageParse.parse(this.messageBuffer);
			message = parse[1];
			this.messageBuffer = parse[0];
			if(message != null){
				this.emit("message", message);
			}
		}
		while(message != null);
	});
};

Peer.prototype = Event.EventEmitter.prototype;

module.exports = Peer;
