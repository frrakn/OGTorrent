"use strict";

/*
 * Message Parser
 *
 * Parses BitTorrent protocol TCP messages by attempting
 * to parse top of buffer into a single message
 *
 * Input: current data buffer (may include multiple / partial messages)
 * Output: single message, or null if incomplete message
 *
 */




var parse = function parse(buffer){	
	var len;
	var id;
	var output;

	if(buffer.length < 4){
		return [buffer, null];
	}
	len = buffer.slice(0, 4).readUInt32BE();

	//  Check for keep-alive message
	if(len === 0){
		output = {type: types["keep-alive"]};
	}
	else if(buffer.length >= 68 && len === 323119476 && buffer.slice(1, 20).toString() === "BitTorrent protocol"){
		output = {type: -1, info_hash: buffer.slice(28, 48)};
		len = 64;
	}
	else if(buffer.length >= 5){
		id = buffer.readUInt8(4);
		switch(id){
			case 0:
				output = (len === 1 && (buffer.length >= (4 + len))) ? {type: types["choke"]} : null;
				break;
			case 1:
				output = (len === 1 && (buffer.length >= (4 + len))) ? {type: types["unchoke"]} : null;
				break;
			case 2:
				output = (len === 1 && (buffer.length >= (4 + len))) ? {type: types["interested"]} : null;
				break;
			case 3:
				output = (len === 1 && (buffer.length >= (4 + len))) ? {type: types["not interested"]} : null;
				break;
			case 4:
				output = (len === 5 && (buffer.length >= (4 + len))) ? {type: types["have"], index: buffer.readUInt32BE(5)} : null;
				break;
			case 5:
				output = buffer.length >= (4 + len) ? {type: types["bitfield"], bitfield: buffer.slice(5, 4 + len)} : null;
				break;
			case 6:
				output = (len === 13 && (buffer.length >= (4 + len))) ? {type: types["request"], index: buffer.readUInt32BE(5), begin: buffer.readUInt32BE(9), length: buffer.readUInt32BE(13)} : null;
				break;
			case 7:
				output = buffer.length >= (4 + len) ? {type: types["piece"], index: buffer.readUInt32BE(5), begin: buffer.readUInt32BE(9), block: buffer.slice(13, 4 + len)} : null;
				break;
			case 8:
				output = (len === 13 && (buffer.length >= (4 + len))) ? {type: types["cancel"], index: buffer.readUInt32BE(5), begin: buffer.readUInt32BE(9), length: buffer.readUInt32BE(13)} : null;
				break;
			case 9:
				output = (len === 3 && (buffer.length >= (4 + len))) ? {type: types["port"], listenPort: buffer.readUInt16BE(5)} : null;
				break;	
		}
	}
	else{
		output = null;
	}
	if(output){
		buffer = buffer.slice(4 + len, buffer.length);
	}
	return [buffer, output];
}

var pkg = function pkg(obj){
	var buffer;
	switch(types[obj.type]){
		case "choke":
			buffer = new Buffer(5);
			buffer.writeUInt32BE(1);
			buffer.writeUInt8(0, 4);
			break;
		case "unchoke":
			buffer = new Buffer(5);
			buffer.writeUInt32BE(1);
			buffer.writeUInt8(1, 4);
			break;
		case "interested":
			buffer = new Buffer(5);
			buffer.writeUInt32BE(1);
			buffer.writeUInt8(2, 4);
			break;
		case "not interested":
			buffer = new Buffer(5);
			buffer.writeUInt32BE(1);
			buffer.writeUInt8(3, 4);
			break;
		case "have":
			buffer = new Buffer(9);
			buffer.writeUInt32BE(5);
			buffer.writeUInt8(4, 4);	
			buffer.writeUInt32BE(obj.index, 5);
			break;
		case "bitfield":
			buffer = new Buffer(5);
			buffer.writeUInt32BE(1 + obj.bitfield.length);
			buffer.writeUInt8(5, 4);
			buffer = Buffer.concat([buffer, obj.bitfield]);
			break;
		case "request":
			buffer = new Buffer(17);
			buffer.writeUInt32BE(13);
			buffer.writeUInt8(6, 4);
			buffer.writeUInt32BE(obj.index, 5);
			buffer.writeUInt32BE(obj.begin, 9);
			buffer.writeUInt32BE(obj.length, 13);
			break;
		case "piece":
			buffer = new Buffer(13);
			buffer.writeUInt32BE(9 + obj.block.length);
			buffer.writeUInt8(7, 4);
			buffer.writeUInt32BE(obj.index, 5);
			buffer.writeUInt32BE(obj.begin, 9);
			buffer = Buffer.concat([buffer, obj.block]);
			break;
		case "cancel":
			buffer = new Buffer(17);
			buffer.writeUInt32BE(13);
			buffer.writeUInt8(8, 4);
			buffer.writeUInt32BE(obj.index, 5);
			buffer.writeUInt32BE(obj.begin, 9);
			buffer.writeUInt32BE(obj.length, 13);
			break;
		case "port":
			buffer = new Buffer(7);
			buffer.writeUInt32BE(3);
			buffer.writeUInt8(9, 4);
			buffer.writeUInt16BE(obj.listenPort, 5);
			break;
		case "keep-alive":
			buffer = new Buffer(4);
			buffer.writeUInt32BE(0);
			break;
	}
	return buffer;
}

var types = ["choke", "unchoke", "interested", "not interested", "have", "bitfield", "request", "piece", "cancel", "port", "keep-alive"];
types["choke"] = 0;
types["unchoke"] = 1;
types["interested"] = 2;
types["not interested"] = 3;
types["have"] = 4;
types["bitfield"] = 5;
types["request"] = 6;
types["piece"] = 7;
types["cancel"] = 8;
types["port"] = 9;
types["keep-alive"] = 10;

module.exports.parse = parse;
module.exports.pkg = pkg;
module.exports.types = types;
