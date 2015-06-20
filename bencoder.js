"use strict";
var _ = require("underscore");

var bencode = function bencode(obj){
	var output;
	var keys;
	var buf;

	try{
		switch(typeof obj){
			case "number":
				output = "i" + obj + "e";
				break;
			case "string":	
				output = "" + obj.length + ":";
				for(var i = 0; i < obj.length; i++){
					output += String.fromCharCode(obj.charCodeAt(i));
				}
				break;
			case "object":
				if(obj instanceof Array){
					output = "l";
					_.each(obj, function(e, index, list){
						output += bencode(e);
					});
					output += "e";
				}
				else{
					output = "d";
					keys = Object.keys(obj);
					keys.sort();
					_.each(keys, function(e, index, list){
						output += bencode(e);
						output += bencode(obj[e]);
					});
					output += "e";
				}
				break;
			default:
				throw "Unsupported data type (object, number, string)";
		}
	}
	catch(err){
		console.log("Bencode failed: " + err + " :: " + obj);
	}

	return output;
};

var bdecode = function bdecode(str, suppressLen){
	var len = 0;
	var templen;
	var tempkey;
	var tempobj;
	var output;

	try{
		switch(str.charAt(0)){
			case "d":
				len++;
				output = {};
				templen = 0;
				try{
					while(str[templen + 1] !== "e"){
						tempkey = bdecode(str.substring(templen + 1, str.length - 1), true);
						templen += tempkey[1];
						if((typeof tempkey[0]) != "string"){
							throw "Invalid key - not a string";
						}
						tempobj = bdecode(str.substring(templen + 1, str.length - 1), true);
						templen += tempobj[1];
						output[tempkey[0]] = tempobj[0];
					}
				}
				catch(err){
					throw "Couldn't find end of dictionary";
				}
				len += templen + 1;
				break;
			case "i":
				len++;
				output = parseInt(str.substring(1, str.indexOf("e")));
				if(isNaN(output)){
					throw "Attempting to parse a non-integer as an integer";
				}
				if((str.charAt(1) == "-" && str.charAt(2) == "0") || str.charAt(1) == "0" && str.charAt(2) != "e"){
					throw "Extra zero padding";
				}
				len += ("" + output).length;
				len++;
				break;
			case "l":
				len++;
				output = [];
				templen = 0;
				try{
					while(str[templen + 1] !== "e"){
						tempobj = bdecode(str.substring(templen + 1, str.length - 1), true);
						output.push(tempobj[0]);
						templen += tempobj[1];
					}
				}
				catch(err){
					throw "Couldn't find end of list";
				}
				len += templen + 1;
				break;
			case "0":
			case "1":
			case "2":
			case "3":
			case "4":
			case "5":
			case "6":
			case "7":
			case "8":
			case "9":
				len++;
				templen = parseInt(str.substring(0, str.indexOf(":")));
				len += ("" + templen).length;
				output = str.substring(len, len + templen);
				len += templen;
				break;
			default:
				throw "Invalid prefix";
		}
	}
	catch(err){
		console.log( "Bdecode failed: " + err + " :: " + str);
	}
	if(!suppressLen && str.length !== len){
		console.log("Bdecode failed: interpreted length (" + len + ") does not match string length (" + str.length + ") :: " + str);
	}
	return [output, len];
};



//  Exporting the encoding and decoding functions

module.exports = {};
module.exports.bencode = bencode;
module.exports.bdecode = bdecode;




//  Example tests
/*
var strtest = ["a", "0:", "12:asdgasdgasdg", "13:asdgasdgasdg", "1e:a"]
var inttest =  ["i-0e", "i023e", "i-4323e", "i--5", "i1e", "iasdksdlkje", "i1023928", "i1023928e", "i1234"];
var listtest = ["li5ei6ee", "l12:ASDFASDFASDF0:i-2ei0e1:ae"];
var test = listtest;
var res;

for(var i = 0; i < test.length; i++){
	console.log("*****   TESTING   *****  || String: " + test[i]);
	res = bdecode(test[i])[0];
	console.log(res);
	console.log("\n\n\n\n");
	console.log(_.isEqual(bencode(res), test[i]) ? "ENCODE TEST PASSED" : "ENCODE TEST FAILED");
}*/
