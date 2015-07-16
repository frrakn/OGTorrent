"use strict";

var Event = require("events");
var net = require("net");
var messageParse = require("./messageParse.js");

function Peer(peerIP, port, fileLength, info_hash){
	var self = this;
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
	this.info_hash = info_hash;

	this.socket.on("data", function(data){
		console.log(data);
		self.messageBuffer = Buffer.concat([self.messageBuffer, data]);
		var temp;
		var message;
		do{
			temp = messageParse.parse(self.messageBuffer);
			message = temp[1];
			self.messageBuffer = temp[0];
			if(message != null){
				self.emit("message", message);
			}
		}
		while(message != null);
	});
};

Peer.prototype = Event.EventEmitter.prototype;

module.exports = Peer;
