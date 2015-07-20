"use strict";

var messageParse = require("./messageParse.js");
var debug = require("./debug.js");
var DEFAULT = require("./default.js");
var Event = require("events");
var net = require("net");

function Peer(ip, port, fileLength, info_hash){
	var self = this;
	this.pieceTimeout;
	this.socket = new net.Socket();
	this.ip = ip;
	this.port = port;
	this.messageBuffer = new Buffer(0);
	this.requests = [];
	this.choked = true;
	this.interested = false;
	this.peerChoke = true;
	this.peerInterest = false;
	this.acceptingBitfield = true;
	this.info_hash = info_hash;
	this.availPieces = (new Buffer(Math.ceil(fileLength / 8))).fill(0);

	this.socket.on("data", function(data){
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

	this.init = function(){
		debug("Peer: " + this.ip + ":" + this.port + " :: Connecting...");
		this.socket.connect(this.port, this.ip, function(){
			self.emit("init");
			self.pieceTimeout = setTimeout(function(){
				self.emit("pieceTimeout");
			}, DEFAULT.PIECE_TIMEOUT);
		});
		this.socket.on("timeout", function(){
			self.emit("timeout");
		});
		this.socket.on("close", function(){
			self.emit("close");
		});
		this.socket.on("error", function(err){
			self.emit("error", err);
		});
		this.socket.setTimeout(DEFAULT.PEER_TIMEOUT);
	};
};

Peer.prototype = Object.create(Event.EventEmitter.prototype);

module.exports = Peer;
