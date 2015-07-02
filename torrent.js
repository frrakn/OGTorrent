"use strict";

var http = require("http");
var bencoder = require("./bencoder.js");
var SHA1 = require("./SHA1.js");
var messageParse = require("./messageParse.js");
var shuffle = require("./fyShuffle.js");
var DEFAULT = require("./default.js");
var fs = require("fs");
var net = require("net");
var _ = require("underscore");
var Promise = require("bluebird");
var Path = require("path");
var url = require("url");
var DEBUG = false;
var args = process.argv;

function debug(msg){
	if(DEBUG){
		console.log(msg);
	}
};

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
			console.log("seekPath error: " + err.stack);
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
			return createDirectories(filepath.slice(1), Path.join(existingPath, filepath[0]));
		})
		.catch(function(err){
			console.log("createDirectories error: " + err.stack);
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
	var writeFile;
	var fileError;
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
	});
	openFile.then(function(fd){
		fs.ftruncate(fd, filesize, function(err){
			if(err){
				throw err;
			}
		});
	})
	.catch(function(err){
		console.log("PrepFile Error: " + err.stack);
	});

	return openFile;
};

function main(arg){
	var torrentFile;
	var downloads = [];
	var trackers = [];
	var peers = [];
	var connpeers = [];

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
			debug("Peers: " + peers.length + ", Trackers: " + trackers.length + " :: Adding additional peers...");
			output.then(populatePeers);
		}
		else if(connpeers.length < DEFAULT.MAX_CONNPEERS && peers.length > 0){
			debug("Connected Peers: " + connpeers.length + ", Peers: " + peers.length + " :: Connecting to new peers...");
			output.then(connectPeer);
		}
		else{
		}
		return output;
	};

	function populatePeers(){
		var params = {};
		var output;
		var tracker;

		params.info_hash = SHA1(bencoder.bencode(torrentFile.info));
		params.peerid = "-" + DEFAULT.torrentPrefix + DEFAULT.version + "-" + randomString(12);
		params.port =	DEFAULT.PORT;
		params.numwant = DEFAULT.MAX_PEERS;

		//  TODO - Will have to edit this when the filecheck is implemented
		params.left = torrentFile.info.length;
		params.downloaded = torrentFile.info.length - params.left;
		params.uploaded = torrentFile.info.length - params.left;
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
	};

	function httpTracker(args){
		var params = args[0];
		var tracker = args[1];
		debug("Getting peers from HTTP Tracker: " + tracker.href);
		params.info_hash = escape(parseHex(params.info_hash));
		params.event = "started";
	};

	function udpTracker(args){
		//  TODO
		console.log("Getting peers from UDP tracker");
	};

	function connectPeer(){
		//  TODO
		console.log("Connecting to peers");
	};
};

main(args[2]);
