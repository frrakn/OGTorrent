"use strict";

var http = require("http");
var bencoder = require("./bencoder.js");
var SHA1 = require("./SHA1.js");
var messageParse = require("./messageParse.js");
var messageParseUDP = require("./messageParseUDP.js");
var shuffle = require("./fyShuffle.js");
var DEFAULT = require("./default.js");
var Event = require("events");
var fs = require("fs");
var net = require("net");
var _ = require("underscore");
var Promise = require("bluebird");
var Path = require("path");
var url = require("url");
var dgram = require("dgram");
var DEBUG = true;
var args = process.argv;

function debug(msg){
	if(DEBUG){
		console.log(msg);
	}
};

function querify(obj){
	var output = "";
	var keys;
	keys = Object.keys(obj);
	for(var i = 0; i < keys.length; i++){
		output += keys[i] + "=" + obj[keys[i]] + "&";
	}
	return output.slice(0, output.length - 1);
}

function parseHex(hexString){
	var str = "";
	for(var i = 0; i < hexString.length; i+=2){
		str += String.fromCharCode(parseInt("0x" + hexString.substring(i, i+2)));
	}
	return str;	
};

function randomString(strLen){
	return Math.random().toString(36).substring(2, strLen + 2);
};

function seekPath(filepath, existingPath){
	var output;
	existingPath = existingPath || DEFAULT.PATH;
	if(filepath && filepath.length > 0){
		output = new Promise(function(resolve, reject){
			fs.exists(Path.join(existingPath, filepath[0]), resolve);
		})
		.then(function(exists){
			return exists ? seekPath(filepath.slice(1), Path.join(existingPath, filepath[0])) : Promise.resolve([filepath, existingPath]);
		})
		.catch(function(err){
			debug("SEEKPATH ERROR: " + err.stack);
		});
	}
	else{
		output = Promise.resolve([filepath, existingPath]);
	}
	return output;
};

function createDirectories(paths){
	var output;
	var filepath = paths[0];
	var existingPath = paths[1];
	existingPath = existingPath || DEFAULT.PATH;
	if(filepath && filepath.length > 0){
		output = new Promise(function(resolve, reject){
			fs.mkdir(Path.join(existingPath, filepath[0]), resolve);
		})
		.then(function(){
			return createDirectories([filepath.slice(1), Path.join(existingPath, filepath[0])]);
		})
		.catch(function(err){
			debug("CREATEDIRECTORIES ERROR: " + err.stack);
		});
	}
	else{
		output = Promise.resolve();
	}
	return output;
}

function openDirectories(filepath){
	var output;
	if(filepath && filepath.length > 1){
		output = seekPath(filepath.slice(0, filepath.length-1), DEFAULT.PATH).then(createDirectories);
	}
	else{
		output = Promise.resolve();
	}
	return output;
};

function prepFile(filepath, filesize){
	var openFile;
	var path = Path.join.apply(this, filepath);
	openFile = new Promise(function(resolve, reject){
		fs.open(DEFAULT.PATH + path, "w+", function(err, fd){
			if(err){
				reject(err);
			}
			else{
				resolve(fd);
			}
		});
	})
	.then(function(fd){
		fs.ftruncate(fd, filesize, function(err){
			if(err){
				throw err;
			}
		});
	})
	.catch(function(err){
		debug("PREPFILE ERROR: " + err.stack);
	});

	return openFile;
};

function main(arg){
	var torrentFile;
	var totalLength;
	var downloads = [];
	var trackers = [];
	var peers = [];
	var connpeers = [];
	var events = new Event.EventEmitter();
	var tracker;

	var stageReadTorrent = new Promise(function(resolve, reject){
		debug("*****     Reading torrent file...     *****");
		fs.readFile(arg, "hex", function(err, data){
			if(err){
				return reject(err);
			}
			else{
				return resolve(data);
			}
		});
	});

	var stageInit = stageReadTorrent.then(function(data){
		debug("*****     Parsing torrent file...     *****");
		torrentFile = bencoder.bdecode(parseHex(data))[0];
		debug("*****     Populating available trackers...     *****");
		if(torrentFile["announce-list"]){
			for(var i = 0; i < torrentFile["announce-list"].length; i++){
				trackers = trackers.concat(shuffle(torrentFile["announce-list"][i]));
			}
		}
		else{
			trackers.push(torrentFile["announce"]);
		}
		debug("*****     Allocating disk space for downloads...     *****");
		if(!torrentFile.info.files){
			downloads.push([prepFile([torrentFile.info.name], torrentFile.info.length), torrentFile.info.length]);
		}
		else{
			for(var i = 0; i < torrentFile.info.files.length; i++){
				downloads.push([openDirectories(torrentFile.info.files[i].path).then((function(j){
					return function(){
						return prepFile(torrentFile.info.files[j].path, torrentFile.info.files[j].length);
					}
				})(i)),torrentFile.info.files[i].length]);
			}
		}
		debug("*****     Exiting init stage, beginning main stage...     *****");
	});

	var stageMain = stageInit.then(checkPeers)
	.catch(function(err){
		console.log("Main function error: " + err.stack);
	});

	function checkPeers(){
		var output = Promise.resolve();
		if(peers.length < DEFAULT.MAX_PEERS && trackers.length > 0){
			debug("Connected Peers: " + connpeers.length + ", Peers: " + peers.length + ", Trackers: " + trackers.length + " :: Adding additional peers...");
			output.then(populatePeers);
		}
		else if(connpeers.length < DEFAULT.MAX_CONNPEERS && peers.length > 0){
			debug("Connected Peers: " + connpeers.length + ", Peers: " + peers.length + ", Trackers: " + trackers.length + " :: Connecting to new peers...");
			output.then(connectPeer);
		}
		else{
			//  TODO If no more trackers and peers are not good enough, set a timeout to allow any outstanding tracker requests to come in, and then give up and exit program	
			debug("Connected Peers: " + connpeers.length + ", Peers: " + peers.length + ", Trackers: " + trackers.length +  " :: No additional peers available / needed, no new peers available / needed");
		}
		return output;
	};

	function populatePeers(){
		var params = {};
		var output;

		params.info_hash = SHA1(bencoder.bencode(torrentFile.info));
		params.peerid = "-" + DEFAULT.torrentPrefix + DEFAULT.version + "-" + randomString(12);
		params.port =	DEFAULT.PORT;
		params.numwant = DEFAULT.MAX_PEERS;
		params.event = "started";

		//  TODO - Will have to edit this when the filecheck is implemented
		totalLength = 0;
		for(var i = 0; i < downloads.length; i++){
			totalLength += downloads[i][1];
		}
		params.left = totalLength;
		params.downloaded = totalLength - params.left;
		params.uploaded = totalLength - params.left;
	
		tracker = url.parse(trackers.shift());
		output = Promise.resolve([params, tracker]);
		if(tracker.protocol === "http:" || tracker.protocol === "https:"){
			output.then(httpTracker);
		}
		else if(tracker.protocol === "udp:"){
			output.then(udpTracker);
		}
		else{
			debug("Tracker protocol \"" + tracker.protocol + "\" not recognized. Skipping to next tracker.");
			output.then(populatePeers);
		}
		return output;
	};

	function httpTracker(args){
		var params = args[0];
		var tracker = args[1];
		var uri;
		var cont;
		debug("Getting peers from HTTP Tracker: " + tracker.href);
		params.info_hash = escape(parseHex(params.info_hash));
		params.compact = 1;
		uri = tracker.href + "?" + querify(params);
		cont = setTimeout(checkPeers, 10000);
		return new Promise(function(resolve, reject){
			http.get(uri, function(res){
				res.on("data", function(chunk){
					clearTimeout(cont);
					var peerIP;
					var port;
					var trackerRes = bencoder.bdecode(parseHex(chunk.toString("hex")))[0];
					var newPeers = trackerRes.peers;
					for(var i = 0; i < newPeers.length; i+=6){
						peerIP = newPeers.charCodeAt(i) + "." + newPeers.charCodeAt(i + 1) + "." + newPeers.charCodeAt(i + 2) + "." + newPeers.charCodeAt(i + 3);
						port = (newPeers.charCodeAt(i + 4) * 256) + newPeers.charCodeAt(i + 5);
						peers.push({peerIP: peerIP, port: port, messageBuffer: null, availPieces: null, interested: false, choked: false});
					}
					events.on("completed", function(){
						params.event = "completed";
						uri = tracker.href + "?" + querify(params);
						http.get(uri);
					});
					events.on("stopped", function(){
						params.event = "stopped";
						uri = tracker.href + "?" + querify(params);
						http.get(uri);
					});
					resolve();
				});
			});
		}).then(checkPeers, function(err){
			debug("Error populating peers from HTTP Tracker: " + tracker.href + "\n\n" + err);
			checkPeers;
		});
	};

	function udpTracker(args){
		var params = args[0];
		var tracker = args[1];
		debug("Getting peers from UDP Tracker: " + tracker.href);
		var sock = dgram.createSocket("udp4");
		sock.bind(6881, function(){
			sock.on("message", function(message){
				console.log(message);
				console.log(messageParseUDP.parse(message));
			});
			var msg = {}; 
			msg.transaction_id = Math.floor(Math.random() * 0xffffffff);
			msg.type = "connect";
			sock.send(messageParseUDP.pkg(msg), 0, 16, tracker.port, tracker.hostname, function(){
				console.log("Sent message to " + tracker.href);
				console.log(messageParseUDP.pkg(msg));
			});
		});
	};

	function connectPeer(){
		//  TODO
		console.log("Connecting to peers");
		events.emit("stopped");
	};
};

main(args[2]);
