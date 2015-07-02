"use strict";

var shuffle = function shuffle(arr, num){
	var n = arr.length;
	var random;
	var t;
	num = num || arr.length;
	for(var j = 0; j < arr.length; j+= num){
		var interval = Math.min(num, arr.length - j);
		n = interval;
		for(var i = 0; i < interval; i++){
			random = Math.floor(Math.random() * n);
			t = arr[j + n - 1];
			arr[j + n - 1] = arr[j + random];
			arr[j + random] = t;
			n -= 1;
		}
	}
	return arr;
}
	
module.exports = {};
module.exports = shuffle;
