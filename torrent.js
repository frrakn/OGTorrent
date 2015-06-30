"use strict";

var http = require("http");
var bencoder = require("./bencoder.js");
var SHA1 = require("./SHA1.js");
var messageParse = require("./messageParse.js");
var shuffle = require("./fyShuffle.js");
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

var seekPath = function seekPath(filepath, existingPath){
	var output;
	existingPath = existingPath || default_path;
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

var createDirectories = function createDirectories(paths){
	var output;
	var filepath = paths[0];
	var existingPath = paths[1];
	existingPath = existingPath || default_path;
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

var openDirectories = function openDirectories(filepath){
	var output;
	if(filepath && filepath.length > 1){
		output = seekPath(filepath.slice(0, filepath.length-1), default_path).then(createDirectories);
	}
	else{
		output = Promise.resolve();
	}
	return output;
};

var prepFile = function prepFile(filepath, filesize){
	var openFile;
	var writeFile;
	var fileError;
	var path = Path.join.apply(this, filepath);
	openFile = new Promise(function(resolve, reject){
		fs.open(default_path + path, "w+", function(err, fd){
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

var main = function main(arg){
	var torrentFile;
	var downloads = [];
	var trackers = [];

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

	var initEnvironment = toReadTorrent.then(function(data){
		torrentFile = bencoder.bdecode(parseHex(data))[0];

		if(torrentFile["announce-list"]){
			for(var i = 0; i < torrentFile["announce-list"].length; i++){
				trackers = trackers.concat(shuffle(torrentFile["announce-list"][i]));
			}
		}
		else{
			trackers.push(torrentFile["announce"]);
		}

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
	})
	.catch(function(err){
		console.log("Main function error: " + err.stack);
	});

	
};

main(args[2]);
