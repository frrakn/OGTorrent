"use strict";

var http = require("http");
var bencoder = require("./bencoder.js");
var SHA1 = require("./SHA1.js");
var messageParse = require("./messageParse.js");
var fs = require("fs");
var net = require("net");
var _ = require("underscore");
var Promise = require("bluebird");
var Path = require("path");
var torrentPrefix = "OG";
var version = "0003";
var default_port = 6881;
var default_path = "./downloads/";
var args = process.argv;

var parseHex = function parseHex(hexString){
	var str = "";
	for(var i = 0; i < hexString.length; i+=2){
		str += String.fromCharCode(parseInt("0x" + hexString.substring(i, i+2)));
	}
	return str;	
};

var randomString = function randomString(strLen){
	return Math.random().toString(36).substring(2, strLen + 2);
};

var openDirectories = function openDirectories(filepath, existingPath){
	existingPath = existingPath || default_path;
	if(typeof filepath === "string"){
		return openDirectories(filepath.split(Path.sep), existingPath);
	}
	else{
		if(filepath.length > 1){
			var curDirectory = filepath[0];
			existingPath = Path.join(existingPath,curDirectory);
			return new Promise(function(resolve, reject){
				fs.exists(existingPath, function(exists){
					resolve(exists);
				});
			})
			.then(function(exists){
				if(!exists){
					return new Promise(function(resolve, reject){
						fs.mkdir(existingPath, function(err){
							if(err){
								reject(err);
							}
							else{
								resolve();
							}
						});
					});
				}
				else{
					return new Promise(function(resolve){resolve();});
				}
			})
			.then(function(){
				return openDirectories(filepath.slice(1), existingPath);
			})
			.catch(function(err){
				console.log("OpenDirectories error:" + err);
			});
		}
		else{
			return new Promise(function(resolve, reject){
				resolve(filepath);
			});
		}
	}
};

var prepFile = function prepFile(filepath, filesize){
	var openFile;
	var writeFile;
	var fileError;
	openFile = new Promise(function(resolve, reject){
		fs.open(default_path + filepath, "w+", function(err, fd){
			if(err){
				reject(err);
			}
			else{
				console.log(filepath + " :: " + fd);
				resolve(fd);
			}
		});
	});
	openFile.then(function(fd){
		fs.stat(default_path + filepath, function(err, stats){
			if(err){
				throw err;
			}
			else{
				if(stats.size !== filesize){
					fs.ftruncate(fd, filesize, function(err){
						if(err){
							throw err;
						}
					});
				}
			}
		});
	})
	.catch(function(err){
		console.log("PrepFile Error: " + err.stack);
	});

	return openFile;
};

var main = function main(arg){
	var torrentFile;
	var uri;
	var keys;
	var trackerRes;
	var params = {};
	var peers = [];
	var temp;
	var tempPeer;
	var downloads = [];
	var path;

	

	var toReadTorrent = new Promise(function(resolve, reject){
		fs.readFile(arg, "hex", function(err, data){
			if(err){
				return reject(err);
			}
			else{
				return resolve(data);
			}
		});
	});

	var toWriteFiles = toReadTorrent.then(function(data){
		torrentFile = bencoder.bdecode(parseHex(data))[0];
		if(!torrentFile.info.files){
			downloads.push([prepFile(torrentFile.info.name, torrentFile.info.length), torrentFile.info.length]);
		}
		else{
			for(var i = 0; i < torrentFile.info.files.length; i++){
				var path = torrentFile.info.files[i].path.join("/");
				downloads.push([openDirectories(path).then((function(j){
					return function(){
						return prepFile(torrentFile.info.files[j].path.join("/"), torrentFile.info.files[j].length);
					}
				})(i)),torrentFile.info.files[i].length]);
			}
		}
	});
	toWriteFiles.catch(function(err){
		console.log(err);
	});
};

main(args[2]);
