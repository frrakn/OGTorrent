/* 
 * UDP Message Parser
 *
 * Parses incoming UDP messages based on expected BitTorrent UDP spec
 * message formats
 *
 * Packages numerical arrays into Buffer for transmission via UDP
 * packet.
 *
 */

var DEFAULT = require("./default.js");
var fs = require("fs");

var parse = function parse(buffer){
	var action;
	var index;
	var output;
	var lengthError;

	index = 0;
	output = {};
	lengthError = "Packet length too short, likely missing data";
	if(buffer.length >= 4){
		action = buffer.readUInt32BE(index);
		if(action > 3){
			action = buffer.readUInt32LE(index);
		}
		index += 4;
		output.action = action;

		switch(action){
			case 0:
				if(buffer.length >= 16){
					output.transaction_id = buffer.readUInt32BE(index);
					index += 4;
					output.connection_id = buffer.readDoubleBE(index);
				}
				else{
					output.error = lengthError;
				}
				break;
			case 1:
				if(buffer.length >= 20){
					var peerIP;
					var port;
					output.transaction_id = buffer.readUInt32BE(index);
					index += 4;
					output.interval = buffer.readUInt32BE(index);
					index += 4;
					output.leechers = buffer.readUInt32BE(index);
					index += 4;
					output.seeders = buffer.readUInt32BE(index);
					index += 4;
					output.peers = [];
					while(buffer.length - index >= 6){
						peerIP = buffer.readUInt8(index) + "." + buffer.readUInt8(index + 1) + "." + buffer.readUInt8(index + 2) + "." + buffer.readUInt8(index + 3);
						port = buffer.readUInt16BE(index + 4);
						output.peers.push({peerIP: peerIP, port:port});
						index += 6;
					}
				}
				else{
					output.error = lengthError;
				}
				break;
			case 2:
				output.error = "Scrape requests not supported";
				//  TODO - low priority
				break;
			case 3:
				if(buffer.length >= 8){
					output.transaction_id = buffer.readUInt32BE(index);
					index += 4;
					output.error = buffer.toString("utf8", 8, buffer.length);
				}
				else{
					output.error = lengthError;
				}
				break;
			default:
				output.error = "Action value " + action + " not supported or recognized";
		}
	}
	else{
		output.error = lengthError;
	}
	return output;
};

var pkg = function pkg(msg){
	var output;
	var index = 0;
	switch(msg.type){
		case "connect":
			output = new Buffer(16);
			output.writeUInt32BE(DEFAULT.UDP_DEFAULT1, index);
			index += 4;
			output.writeUInt32BE(DEFAULT.UDP_DEFAULT2, index);
			index += 4;
			output.writeUInt32BE(0, index);
			index += 4;
			output.writeUInt32BE(msg.transaction_id, index);
			break;
		case "announce":
			output = new Buffer(98);
			output.writeDoubleBE(msg.connection_id, index);
			index += 8;
			output.writeUInt32BE(1, index);
			index += 4;
			output.writeUInt32BE(msg.transaction_id, index);
			index += 4;
			output.write(msg.info_hash, index, 20, "hex");
			index += 20;
			output.write(msg.peerid, index, 20, "utf-8");
			index += 20;
			output.writeUInt32BE(msg.downloaded / 0xffffffff, index);
			index += 4;
			output.writeUInt32BE(msg.downloaded % 0xffffffff, index);
			index += 4;
			output.writeUInt32BE(msg.left / 0xffffffff, index);
			index += 4;
			output.writeUInt32BE(msg.left % 0xffffffff, index);
			index += 4;
			output.writeUInt32BE(msg.uploaded / 0xffffffff, index);
			index += 4;
			output.writeUInt32BE(msg.uploaded % 0xffffffff, index);
			index += 4;
			output.writeUInt32BE(types[msg.event], index);
			index += 4;
			output.writeUInt32BE(msg.ip || 0, index);
			index += 4;
			output.writeUInt32BE(msg.key, index);
			index += 4;
			output.writeUInt32BE(msg.num_want || -1, index);
			index += 4;
			output.writeUInt16BE(msg.port || DEFAULT.DEFAULT_PORT, index);
			break;
		case "default":
			output.error = "Message type unsupported";
	}
	return output;
};

var types = ["none", "completed", "started", "stopped"];
types["none"] = 0;
types["completed"] = 1;
types["started"] = 2;
types["stopped"] = 3;

module.exports.parse = parse;
module.exports.pkg = pkg;
module.exports.types = types;
