
//  TODO: UPLOADING

var bencoder = require("./bencoder.js");
var SHA1 = require("./SHA1.js");
var messageParse = require("./messageParse.js");
var messageParseUDP = require("./messageParseUDP.js");
var shuffle = require("./fyShuffle.js");
var DEFAULT = require("./default.js");
var Peer = require("./peer.js");
var debug = require("./debug.js");
var Event = require("events");
var http = require("http");
var fs = require("fs");
var net = require("net");
var _ = require("underscore");
var Promise = require("bluebird");
var Path = require("path");
var url = require("url");
var dgram = require("dgram");
var args = process.argv;


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
	});

	openFile.then(function(fd){
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
	var torrentState = "opening"; // opening - random piece selection until DEFAULT.RARESTFIRST_THRESH pieces completed
	var downloads = [];           // rf - random rarest first selection
	var server;                   // endgame - request out all outstanding blocks to all peers
	var trackers = [];
	var info_hash;
	var peerid;
	var totalBytes;
	var peers = [];
	var connpeers = [];
	var rarity = [];
	var events = new Event.EventEmitter();
	var blockPossession;
	var piecePossession;
	var blocksDownloaded = [];
	var requestTracker = [];
	var lostRequests = [];
	var totalPieces;
	var totalBlocks;
	var blocksInPiece;
	var requestedBlocks;
	var completedPieces;
	var endgameRequests;
	var pieceLength;

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
		totalPieces = torrentFile.info.pieces.length / 20;
		pieceLength = torrentFile.info["piece length"];
		blocksInPiece = Math.ceil(pieceLength / DEFAULT.CHUNK_BYTES);
		for(var i = 0; i < totalPieces; i++){
			rarity.push(0);
			requestTracker.push(0);
			blocksDownloaded.push(0);
		}
		debug("*****     Populating available trackers...     *****");
		info_hash = SHA1(bencoder.bencode(torrentFile.info));
		peerid = "-" + DEFAULT.torrentPrefix + DEFAULT.version + "-" + randomString(12);
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
				})(i)), torrentFile.info.files[i].length]);
			}
		}
		totalBytes = 0;
		for(var i = 0; i < downloads.length; i++){
			totalBytes += downloads[i][1];
		}
		totalBlocks = Math.ceil(totalBytes / DEFAULT.CHUNK_BYTES);
		requestedBlocks = 0;
		piecePossession = new Buffer(Math.ceil(totalPieces / 8));
		blockPossession = new Buffer(Math.ceil(totalBlocks / 8));
		events.once("rf", function(){
			debug("*****     Entering Rarest First requesting stage...     *****");
			torrentState = "rf";
		});
		events.once("endgame", function(){
			debug("*****     Entering Endgame requesting stage...     *****");
			endgameRequests = lostRequests;
			endgameRequests = endgameRequests.concat.apply(endgameRequests, connpeers.map(function(peer){return peer.availPieces}));
			torrentState = "endgame";
		});
		server = net.createServer();
		server.listen(6881);
		debug("*****     Exiting init stage, beginning main stage...     *****");
	});

	var stageMain = stageInit
	.then(checkPeers)
	.catch(function(err){
		debug("Main function error: " + err.stack);
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
		var tracker;

		params.info_hash = info_hash;
		params.peerid = peerid;
		params.port =	DEFAULT.PORT;
		params.numwant = DEFAULT.MAX_PEERS;
		params.event = "started";

		//  TODO - Will have to edit this when the filecheck is implemented
		params.left = totalBytes;
		params.downloaded = totalBytes - params.left;
		params.uploaded = totalBytes - params.left;
	
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
				res.on("data", function(chunk){
					clearTimeout(cont);
					var ip;
					var port;
					var trackerRes = bencoder.bdecode(parseHex(chunk.toString("hex")))[0];
					var newPeers = trackerRes.peers;
					for(var i = 0; i < newPeers.length; i+=6){
						ip = newPeers.charCodeAt(i) + "." + newPeers.charCodeAt(i + 1) + "." + newPeers.charCodeAt(i + 2) + "." + newPeers.charCodeAt(i + 3);
						port = (newPeers.charCodeAt(i + 4) * 256) + newPeers.charCodeAt(i + 5);
						peers.push(new Peer(ip, port, totalPieces, unescape(params.info_hash)));
					}
					resolve();
				});
			}).on("error", function(err){
				reject(err);
			});
		})
		.then(checkPeers, function(err){
			debug("Error populating peers from HTTP Tracker: " + tracker.href + "\n\n" + err);
			checkPeers();
		});
	};

	function udpTracker(args){
		var params = args[0];
		var tracker = args[1];
		debug("Getting peers from UDP Tracker: " + tracker.href);
		return Promise.resolve([DEFAULT.PORT, params, tracker])
		.then(UDPGetSocket);
	};

	function UDPGetSocket(args){
		var port = args[0];
		var params = args[1];
		var tracker = args[2];
		var socket = dgram.createSocket("udp4");	
		debug("Tracker " + tracker.href + " :: Binding socket to port " + port);
		return new Promise(function(resolve, reject){
			socket.bind(port, function(){
				resolve([socket, params, tracker]);
			});
			socket.on("error", function(err){
				reject(err);
			});
		})
		.then(UDPConnect, function(){
			debug("Tracker " + tracker.href + " :: Failed to bind socket to port " + port);
			return UDPGetSocket([port + 1, params, tracker]);
		});
	}

	function UDPConnect(args){
		var socket = args[0];
		var params = args[1];
		var tracker = args[2];
		var msg = {};
		var timeout = []; //  Using array to keep a pointer to a pointer... kinda hacked? yes
		var listen;
		var send;

		msg.transaction_id = Math.random() * DEFAULT.POW2_32;
		params.transaction_id = msg.transaction_id;
		msg.type = "connect";
		
		timeout[0] = setTimeout(function(){}, 0);
		listen = UDPListenConnect(socket, tracker, params)
		.cancellable()
		.catch(function(err){
		});
		send = UDPSendConnect(socket, msg, tracker, 0, timeout)
		.cancellable()
		.catch(function(err){
		});
		return Promise.any([listen, send])
		.then(function(result){
			var output;
			if(result){
				debug("Tracker " + tracker.href + " :: Received \"connect\" response :: connection_id " + result);
				clearTimeout(timeout[0]);
				send.cancel();
				params.connection_id = result;
				return UDPAnnounce([socket, params, tracker]);
			}
			else{
				debug("Tracker " + tracker.href + " :: Timed out");
				socket.close();
				listen.cancel();
				return checkPeers();
			}
		});
	};

	function UDPSendConnect(socket, msg, tracker, num, timeout){
		var output;
		if(num > DEFAULT.TRIES){
			output = Promise.resolve();
		}
		else{
			output = new Promise(function(resolve, reject){
				debug("Tracker " + tracker.href + " :: Sending \"connect\" message on port " + socket.address().port + " :: transaction_id: " + msg.transaction_id);	
				socket.send(messageParseUDP.pkg(msg), 0, 16, tracker.port, tracker.hostname, function(err){
					if(err){
						debug("Tracker " + tracker.href + " :: Error sending \"connect\" message" + err);
					}
					else{
						debug("Tracker " + tracker.href + " :: Sent \"connect\" message :: Attempt #" + (num + 1));
					}
					num++;
					timeout[0] = setTimeout(resolve, 15 * Math.pow(2, num) * DEFAULT.SPEED);
				});
			})
			.then(function(){
				return UDPSendConnect(socket, msg, tracker, num, timeout);
			});
		}
		return output;
	};

	function UDPListenConnect(socket, tracker, params){
		return new Promise(function(resolve, reject){
			socket.on("message", function(message){
				var msg = messageParseUDP.parse(message);
				if(params.transaction_id === msg.transaction_id){
					resolve(msg.connection_id);
				}
			});
		});
	};

	function UDPAnnounce(args){
		var socket = args[0];
		var params = args[1];
		var tracker = args[2];
		var msg = {};
		var timeout = []; //  Using array to keep a pointer to a pointer... kinda hacked? yes
		var listen;
		var send;

		msg.connection_id = params.connection_id;
		msg.transaction_id = Math.random() * DEFAULT.POW2_32;
		params.transaction_id = msg.transaction_id;
		msg.type = "announce";
		msg.info_hash = params.info_hash;
		msg.peerid = params.peerid;
		msg.downloaded = params.downloaded;
		msg.left = params.left;
		msg.uploaded = params.uploaded;
		msg.event = "started";
		msg.ip = 0;
		msg.key = Math.random() * DEFAULT.POW2_32;
		msg.num_want = params.numwant;
		msg.port = DEFAULT.PORT;

		timeout[0] = setTimeout(function(){}, 0);
		listen = UDPListenAnnounce(socket, tracker, params)
		.cancellable()
		.catch(function(err){
		});
		send = UDPSendAnnounce(socket, msg, tracker, 0, timeout)
		.cancellable()
		.catch(function(err){
		});
		return Promise.any([listen, send])
		.then(function(result){
			var output;
			if(result){
				debug("Tracker " + tracker.href + " :: Received \"announce\" response");
				clearTimeout(timeout[0]);
				socket.close();
				send.cancel();
				for(var i = 0; i < result.peers.length; i++){
					peers.push(new Peer(result.peers[i].ip, result.peers[i].port, totalPieces, parseHex(params.info_hash)));
				}	
				return checkPeers();
			}
			else{
				debug("Tracker " + tracker.href + " :: Timed out");
				socket.close();
				listen.cancel();
				return checkPeers();
			}
		});
	};


	function UDPSendAnnounce(socket, msg, tracker, num, timeout){
		var output;
		if(num > DEFAULT.TRIES){
			output = Promise.resolve();
		}
		else{
			output = new Promise(function(resolve, reject){
				debug("Tracker " + tracker.href + " :: Sending \"announce\" message on port " + socket.address().port + " :: transaction_id: " + msg.transaction_id);	
				socket.send(messageParseUDP.pkg(msg), 0, 98, tracker.port, tracker.hostname, function(err){
					if(err){
						debug("Tracker " + tracker.href + " :: Error sending \"announce\" message" + err);
					}
					else{
						debug("Tracker " + tracker.href + " :: Sent \"announce\" message :: Attempt #" + (num + 1));
						events.on("completed", function(){
							msg.event = "completed";
							socket.send(messageParseUDP.pkg(msg), 0, 98, tracker.port, tracker.hostname);
						});
						events.on("stopped", function(){
							msg.event = "stopped";
							socket.send(messageParseUDP.pkg(msg), 0, 98, tracker.port, tracker.hostname);
						});
					}
					num++;
					timeout[0] = setTimeout(resolve, 15 * Math.pow(2, num) * DEFAULT.SPEED);
				});
			})
			.then(function(){
				return UDPSendAnnounce(socket, msg, tracker, num, timeout);
			});
		}
		return output;
	};

	function UDPListenAnnounce(socket, tracker, params){
		return new Promise(function(resolve, reject){
			socket.on("message", function(message){
				var msg = messageParseUDP.parse(message);
				if(msg.error){
					debug(msg.error);
				}
				else if(params.transaction_id === msg.transaction_id){
					resolve(msg);
				}
			});
		});
	};

	function connectPeer(){
		var output;
		var peer = peers.pop();
		connpeers.push(peer);
		output = new Promise(function(resolve, reject){
			peer.init();
			peer.on("init", function(){
				resolve(peer);
			});
			peer.on("timeout", reject);
			peer.on("close", reject);
			peer.on("error", reject);
			peer.on("timeout", function(){
				closePeer(peer, "Timed out");
			});
			peer.on("error", function(err){
				closePeer(peer, err);
			});
			peer.on("close", function(){
				closePeer(peer, "Connection was closed");
			});
			peer.on("pieceTimeout", function(){
				closePeer(peer, "No pieces received - Timed out");
			});
		})
		.then(function(currentPeer){
			checkPeers();
			sendHandshake(currentPeer);
		}, checkPeers);   //  NOTE: might want to delete? replicated checkPeers on failure, since listeners will reject
											//  and rejection will checkPeers and actual close socket function will also checkPeers 
											//  TODO: tidy up checkPeers calls
		return output;
	};

	function closePeer(peer, reason){
		debug("Peer: " + peer.ip + ":" + peer.port + " :: DISCONNECTED :: " + reason);
		connpeers.splice(connpeers.indexOf(peer), 1);
		peer.socket.end();
		checkPeers();
	};

	function sendHandshake(peer){
		var output;
		var toSend = DEFAULT.HANDSHAKE + peer.info_hash + peerid;
		var handshakeBuf = new Buffer(toSend.length);
		for(var i = 0; i < toSend.length; i++){
			handshakeBuf.writeUInt8(toSend.charCodeAt(i), i);
		}
		output = new Promise(function(resolve, reject){
			peer.on("timeout", reject);
			peer.on("close", reject);
			peer.on("error", reject);
			peer.socket.write(handshakeBuf, function(){
				resolve(peer);
			});
		})
		.then(listenHandshake, checkPeers);
		return output;
	}

	function listenHandshake(peer){
		peer.once("message", function(msg){
			if(msg.type === -1 && msg.info_hash.toString("binary") === peer.info_hash){
				debug("Peer: " + peer.ip + ":" + peer.port + " :: Handshake received");
				attachListeners(peer);
			}
			else{
				debug("Peer: " + peer.ip + ":" + peer.port + " :: Handshake failed :: info_hash " + msg.info_hash.toString("binary") + " :: " + peer.info_hash.toString());
				peer.emit("error");
			}
		});
	};

	function attachListeners(peer){
		var output = Promise.resolve(peer);
		debug("Peer: " + peer.ip + ":" + peer.port + " :: Attaching message handlers...");
		peer.on("message", function(msg){
			switch(msg.type){
				case messageParse.types["choke"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - CHOKE");
					peer.choked = true;
					updateRequests(peer);
					break;
				case messageParse.types["unchoke"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - UNCHOKE");
					peer.choked = false;
					updateRequests(peer);
					break;
				case messageParse.types["interested"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - INTERESTED");
					//  UPLOADING
					break;
				case messageParse.types["not interested"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - NOT INTERESTED");
					//  UPLOADING
					break;
				case messageParse.types["have"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - HAVE");
					var prev = peer.availPieces.readUInt8(Math.floor(msg.index / 8));
					peer.availPieces.writeUInt8((1 << (7 - (msg.index % 8))) | prev, Math.floor(msg.index / 8));
					rarity[msg.index]++;
					updateRequests(peer);
					break;
				case messageParse.types["bitfield"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - BITFIELD");
					//  NOTE: Actual code is in the bitfield listener, debug statement stays here to show
					//	if any bitfield message come in, even if later
					break;
				case messageParse.types["request"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - REQUEST");
					break;
				case messageParse.types["piece"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - PIECE");
					var byteIndex;
					var bytesToWrite;
					var leftoverBuf = msg.block;
					var fileIndex = 0;
					if(peer.hasRequested(msg.index, msg.begin / DEFAULT.CHUNK_BYTES)){
						byteIndex = msg.index * pieceLength + msg.begin;
						while(byteIndex > downloads[fileIndex][1]){
							byteIndex -= downloads[fileIndex][1];
							fileIndex ++;
						}
						writeBlock(msg.block, fileIndex, byteIndex).then(function(){
							writeComplete(peer, msg.index, msg.begin / DEFAULT.CHUNK_BYTES);
						});
 					}
					break;
				case messageParse.types["cancel"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - CANCEL");
					break;
				case messageParse.types["port"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - PORT");
					break;
				case messageParse.types["keep-alive"]:
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - KEEP-ALIVE");
					break;
				default:	
					debug("Peer: " + peer.ip + ":" + peer.port + " :: Message received - UNKNOWN");
			}
		});
		peer.once("message", function(msg){
			var temp;
			var mask;
			if(msg.type === messageParse.types["bitfield"]){
				peer.availPieces = msg.bitfield;
				for(var i = 0; i < peer.availPieces.length; i++){
					temp = peer.availPieces.readUInt8(i);
					mask = 0x80;
					for(var j = 0; j < 8; j++){
						if(temp & mask){
							rarity[(i * 8) + j]++;
						}
						mask = mask >> 1;
					}
				}
			}
		});
	};

	function writeComplete(peer, piece, block){
		peer.removeRequest(piece, block);
		updateRequests(peer);
	};

	function writeBlock(buffer, fileIndex, byteIndex){
		var output;
		if(buffer.length > 0){
			if(buffer.length > (downloads[fileIndex][1] - byteIndex)){
				output = ((function(buf, bytes, index){
					return new Promise(function(resolve, reject){
						downloads[fileIndex][0].then(function(fd){
							fs.write(fd, buf, 0, bytes, index, resolve);
						});
					});
				})(buffer, downloads[fileIndex][1] - byteIndex, byteIndex))
				.then(writeBlock(buffer.slice(downloads[fileIndex][1] - byteIndex), fileIndex + 1, 0));
			}
			else{
				output = (function(buf, bytes, index){
					return new Promise(function(resolve, reject){
						downloads[fileIndex][0].then(function(fd){
							fs.write(fd, buf, 0, bytes, index, resolve);
						});
					});
				})(buffer, buffer.length, byteIndex);
			}
		}
		else{
			output = Promise.resolve();
		}
		return output;
	};

	function updateRequests(peer){
		var numNewRequests;
		var newRequests = [];
		var temp;
		debug("Peer: " + peer.ip + ":" + peer.port + " :: Status - Choked: " + peer.choked + " Sent Interest: " + peer.interested + " :: Updating Requests...");
		if(!peer.choked){
			if(torrentState === "endgame"){
				for(var i = 0; i < endgameRequests.length; i++){
					peer.sendRequest(endgameRequests[i]);
				}
			}
			else{
				numNewRequests = Math.min(DEFAULT.MAX_PEER_REQUESTS - peer.requests.length, totalBlocks - requestedBlocks);
				if(lostRequests.length > 0){
					for(var i = 0; i < lostRequests.length && newRequests.length < numNewRequests; i++){
						//  TODO - any removed peers
					}
				}
				//while(newRequests.length < numNewRequests && peer.requests.length > 0){
					//  TODO - completing pieces
				//}
				while(newRequests.length < numNewRequests){
					if(torrentState === "rf"){
						//  TODO - rarity based requesting
					}
					else{
						temp = Math.floor(Math.random() * totalPieces);
						while(!(peer.availPieces.readUInt8(Math.floor(temp / 8)) & (1 << (7 - temp % 8))) && !(requestTracker[temp] < blocksInPiece)){
							temp++;
							if(temp === totalPieces){
								temp = 0;
							}
						}
						for(var i = requestTracker[temp]; (i < blocksInPiece) && ((i - requestTracker[temp]) < (numNewRequests - newRequests.length)); i++){
							newRequests.push({piece: temp, block: i});
							requestTracker[temp]++;
						}
					}
				}
				for(var i = 0; i < newRequests.length; i++){
					peer.sendRequest(newRequests[i]);
					requestedBlocks++;
				}
			}
		}
		else if(!peer.interested){
			var temp;
			var temp2;
			var mask;
			for(var i = 0; i < peer.availPieces.length && !peer.interested; i++){
				temp = peer.availPieces.readUInt8(i);
				temp2 = piecePossession.readUInt8(i);
				mask = 0x80;
				for(var j = 0; j < 8 && !peer.interested; j++){
					peer.interested = (temp2 & mask) === 0 && (temp & mask) === 1;
					mask = mask >> 1;
				}
			}
			if(peer.interested){
				peer.send({type: messageParse.types["interested"]});
			}
		}
	}

	function checkPiece(piece){
		debug("Checking SHA1 hash of piece " + piece);
		var byteIndex = piece * pieceLength;
		var fileIndex = 0;
		while(byteIndex > downloads[fileIndex][1]){
			byteIndex -= downloads[fileIndex][1];
			fileIndex ++;
		}
		return readPiece(0, byteIndex, DEFAULT.CHUNK_BYTES, fileIndex).then(function(buffer){
			checkHash(piece, buffer);
		});
	};
	
	function readPiece(bufStart, fileStart, leftoverBytes, fileNum, buffer){
		var output = Promise.resolve();
		buffer = buffer || new Buffer(leftoverBytes);
		if(leftoverBytes > 0){
			if((downloads[fileNum][1] - fileStart) >= leftoverBytes){
				output = new Promise(function(resolve, reject){
					downloads[fileNum][0].then(function(fd){
						fs.read(fd, buffer, bufStart, leftoverBytes, fileStart, function(err, bytesRead, buf){
							if(err){
								reject("fs read error");
							}
							else{
								resolve(buffer);
							}
						});
					});
				});
			}
			else{
				output = new Promise(function(resolve, reject){
					downloads[fileNum][0].then(function(fd){
						fs.read(fd, buffer, bufStart, downloads[fileNum][1] - fileStart, fileStart, function(err, bytesRead, buf){
							if(err){
								reject();
							}
							else{
								resolve(buffer);
							}
						});
					})
					.then(function(){
						readPiece(bufStart + downloads[fileNum][1] - fileStart, 0, leftoverBytes - downloads[fileNum][1] + fileStart, fileNum + 1, buffer);
					});
				});	
			}
		}
		else{
			output = Promise.resolve();
		}
		return output;
	};

	function checkHash(piece, buffer){
		var hash = SHA1(buffer.toString("binary"));
		console.log(hash);
		console.log(torrentFile.info.pieces.substring(piece*20, (piece + 1) * 20));
	};
};

/*

 *** FILE I/O TESTING MATERIAL ***

fs.open("./test1", "r+", cb);
fs.open("./test2", "r+", cb);

var downloads = [];
var numFiles = 0;

function cb(err, fd){
	downloads.push([Promise.resolve(fd), 10]);
	numFiles++;
	if(numFiles === 2){
		var buf = new Buffer("abcdefghijklmnopqrst");
		writeBlock(buf, 0, 0);
	}
};

*/

main(args[2]);
