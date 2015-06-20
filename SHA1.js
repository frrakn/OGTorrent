"use strict";

var SHA1 = function SHA1(str){

	//  Constants
	var len;
	var msgArr;
	var temp;
	var pos;
	var h_a;
	var h_b;
	var h_c;
	var h_d;
	var h_e;
	var phase;
	var wordMask = 0xffffffff;
	var H = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
	var K = [0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xca62c1d6];
	var F = [
		function(b, c, d){return ((b & c) | ((~b) & d));},
		function(b, c, d){return (b ^ c ^ d);},
		function(b, c, d){return ((b & c) | (b & d) | (c & d));},
		function(b, c, d){return (b ^ c ^ d);}
	];
	var W = new Array(80);
	var rotateLeft = function rotateLeft(x, n){
		return (x << n) | (x >>> (32 - n));
	}
	var hexString = function hexString(num){
		var output = "";
		var ch;
		for(var i = 0; i < 8; i++){
			ch = (num >>> ((8 - i - 1) * 4)) & 0xf;
			output += ch.toString(16);
		}
		return output;
	}

	//  Preparing message
	//  str = unescape(encodeURIComponent(str));
	str += String.fromCharCode(0x80);
	len = Math.ceil((str.length / 64) + (1 / 8));
	msgArr = new Array(len);

	//  Populating msgArr
	for(var i = 0; i < len; i++){
		msgArr[i] = new Array(16);
		for(var j = 0; j < 16; j++){
			temp = 0;
			pos = i * 64 + j * 4;
			for(var k = 0; k < 4; k++){
				temp = temp | (str.charCodeAt(pos + k) << (8 * (3 - k)));
			}
			msgArr[i][j] = temp;
		}
	}
	
	//  Appending length
	msgArr[len - 1][14] = Math.floor((str.length - 1) / Math.pow(2, 29));
	msgArr[len - 1][15] = ((str.length - 1) * 8) & wordMask;

	//  Hashing
	for(var i = 0; i < len; i++){
		//  Populate W
		for(var j = 0; j < 80; j++){
			W[j] = (j < 16) ? msgArr[i][j] : rotateLeft((W[j - 3] ^ W[j - 8] ^ W[j - 14] ^ W[j - 16]), 1);
		}

		//  Initiate hash values
		h_a = H[0];
		h_b = H[1];
		h_c = H[2];
		h_d = H[3];
		h_e = H[4];

		//  Looping through main compression function
		for(var j = 0; j < 80; j++){
			phase = Math.floor(j / 20);
			temp = (F[phase](h_b, h_c, h_d) + h_e + rotateLeft(h_a, 5) + W[j] + K[phase]) & wordMask;
			h_e = h_d;
			h_d = h_c;
			h_c = rotateLeft(h_b, 30);
			h_b = h_a;
			h_a = temp;
		}

		//  Saving in H
		H[0] = (H[0] + h_a) & wordMask;
		H[1] = (H[1] + h_b) & wordMask;
		H[2] = (H[2] + h_c) & wordMask;
		H[3] = (H[3] + h_d) & wordMask;
		H[4] = (H[4] + h_e) & wordMask;
	}

	return hexString(H[0]) + hexString(H[1]) + hexString(H[2]) + hexString(H[3]) + hexString(H[4]);
} 

module.exports = SHA1;

//  Test code
/*console.log(SHA1("Hello world!"));*/
