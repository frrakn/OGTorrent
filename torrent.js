"use strict";

/*
 * TODO
 *
 * 1) params.left in the tracker request should be bytes left
 *		currently assumes no previous download such that
 *		params.left = bytes left = file length
 *
 * 2) tracker response only parses binary model, not dictionary model
 *
 * 3) handle multiple peers with multiple sockets
 *
 * 4) handle inability to get port 6881
 *
 * 5) handle multiple files
 *
 */

var http = require("http");
var bencoder = require("./bencoder.js");
var SHA1 = require("./SHA1.js");
var fs = require("fs");
var net = require("net");
var messageParse = require("./messageParse.js");
var args = process.argv;
var torrentPrefix = "OG";
var version = "0001";
var default_port = 6881; 
var default_path = "./downloads/";

var parseHex = function parseHex(hexString){
	var str = "";
	for(var i = 0; i < hexString.length; i+=2){
		str += String.fromCharCode(parseInt("0x" + hexString.substring(i, i+2)));
	}
	return str;	
}

var randomString = function randomString(strLen){
	return Math.random().toString(36).substring(2, strLen + 2);
}

fs.readFile(args[2], "hex", function(err, data){
	var torrentFile;
	var uri;
	var keys;
	var trackerRes;
	var params = {};
	var peers = [];
	var temp;
	var tempPeer;
	var download;

	if(err){
		console.log(err);
	}

	torrentFile = bencoder.bdecode(parseHex(data))[0];
	
	//console.log(torrentFile); //DELETE
	fs.writeFile("output", JSON.stringify(torrentFile));

	params.info_hash = escape(parseHex(SHA1(bencoder.bencode(torrentFile.info))));
	params.peerid = "-" + torrentPrefix + version + "-" + randomString(12);
	params.port = default_port;

	fs.open(default_path + torrentFile.info.name, "w+", function(err, download){
		if(err){
			console.log("Error opening file " + default_path + torrentFile.info.name + ": " + err);
		}
		else{
			fs.stat(default_path + torrentFile.info.name, function(err, stats){
				if(err){
					console.log("Error checking file size " + default_path + torrentFile.info.name + ": " + err);
				}
				else{
					if(stats.size !== torrentFile.info.length){
						fs.ftruncate(download, torrentFile.info.length);
					}
					//  Should change for re-started downloads?
					params.left = torrentFile.info.length;
					params.downloaded = torrentFile.info.length - params.left;
					params.event = "started";

					uri = torrentFile.announce + "?";
					keys = Object.keys(params);
					for(var i = 0; i < keys.length; i++){
						uri += keys[i] + "=" + params[keys[i]] + "&";
					}
					uri = uri.substring(0, uri.length - 1);

					http.get(uri, function(res){
						res.on("data", function(chunk){
							var peerIP;
							var port;
							var peer;
							var handshake = "\u0013" + "BitTorrent protocol" + "\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000" + unescape(params.info_hash) + params.peerid;
							var handshakeBuf = new Buffer(handshake.length);
							var requested = false; // DELETE

							trackerRes = bencoder.bdecode(parseHex(chunk.toString('hex')))[0];
							temp = trackerRes.peers;
					
							if(((temp.length % 6) !== 0) || ((temp.length / 6) !== (trackerRes.complete + trackerRes.incomplete))){
								throw "Invalid peer string, only binary convention accepted";
							}

							for(var i = 0; i < temp.length; i+=6){
								peerIP = "";
								port = 0;
								peerIP += temp.charCodeAt(i) + "." + temp.charCodeAt(i + 1) + "." + temp.charCodeAt(i + 2) + "." + temp.charCodeAt(i + 3);
								port = (temp.charCodeAt(i + 4) * 256) + temp.charCodeAt(i + 5);
								
								//	After peerIP and port are handshake (boolean), acceptBitfield (buffer), messageBuffer (buffer), available pieces (buffer(?)), unchoked (boolean)
								peers.push({peerIP: peerIP, port: port, handshake: false, acceptBitfield: false, messageBuffer: null, availPieces: null, unchoked: false});
							}

							for(var i = 0; i < handshake.length; i++){
								handshakeBuf.writeUInt8(handshake.charCodeAt(i), i);
							}

							//  Do this with multiple peers?
							tempPeer = peers[peers.length - 1];

							//  DELETE AND FIX
							tempPeer.peerIP = "96.126.104.219";
							tempPeer.port = 63529;

							console.log(peers); //  DELETE
							peer = new net.Socket();
							try{
								peer.connect(tempPeer.port, tempPeer.peerIP, function(){
									console.log("Connected to " + tempPeer.peerIP + ":" + tempPeer.port);
									peer.info = tempPeer;
								});
								peer.on("data", function(data){
									var message;
									var parse;

									if(!peer.info.handshake){
										if(!data.slice(28,48).equals(handshakeBuf.slice(28, 48))){
												console.log("info_hash (received): " + data.slice(28, 48));
											console.log("info_hash (calculated): " + handshakeBuf.slice(28,48));
											peer.destroy();
											throw "info_hash mismatch, socket has been closed.";
										}
										else{
											peer.info.handshake = true;
											peer.info.acceptBitfield = true;
											peer.info.messageBuffer = data.slice(68, data.length);
											do{
												parse = messageParse.parse(peer.info.messageBuffer);
												message = parse[1];
												peer.info.messageBuffer = parse[0];
												if(message){
													peer.info.acceptBitfield = false;
												}
												console.log(message);	
											}
											while(message != null);
											peer.write(messageParse.pkg({type: messageParse.types["interested"]}));  // DELETE
										}	
									}
									else if(!peer.info.unchoked && !requested){
											requested = true;
											peer.info.messageBuffer = Buffer.concat([peer.info.messageBuffer, data]);
											do{
												parse = messageParse.parse(peer.info.messageBuffer);
												message = parse[1];
												peer.info.messageBuffer = parse[0];
												if(message){
													peer.info.acceptBitfield = false;
												}
												console.log(message);	
											}
											while(message != null);
											console.log(torrentFile.info.length);
											console.log(torrentFile.info["piece length"]);
											for(var i = 0; i < Math.ceil(torrentFile.info.length / torrentFile.info["piece length"]); i++){        //DELETE
												console.log("Requesting pieces");
												peer.write(messageParse.pkg({type: messageParse.types["request"], index: i, begin: 0, length: torrentFile.info["piece length"]}));
											}
									}
									else{
										peer.info.messageBuffer = Buffer.concat([peer.info.messageBuffer, data]);
										do{
											parse = messageParse.parse(peer.info.messageBuffer);
											message = parse[1];
											peer.info.messageBuffer = parse[0];
											if(message){
												peer.info.acceptBitfield = false;
												if(message.type = messageParse.types["piece"]){
													fs.write(download, message.block, 0, message.block.length, message.index * torrentFile.info["piece length"] + message.begin);
												}
											}
											console.log(message);	
										}
										while(message != null);
									}
								});
								peer.write(handshakeBuf);
							}
							catch(e){
								console.log("Socket connection to " + tempPeer[0] + ":" + tempPeer[1] + " failed: " + e);
							}
						});
					}).on("error", function(e){
						console.log("HTTP request error: " + e.message);
					});
				}
			});
		}
	});
});
