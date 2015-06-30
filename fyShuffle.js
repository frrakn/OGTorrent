"use strict";

var shuffle = function shuffle(arr){
	var n = arr.length;
	var random;
	var t;

	for(var i = 0; i < arr.length; i++){
		random = Math.floor(Math.random() * n);
		t = arr[n - 1];
		arr[n - 1] = arr[random];
		arr[random] = t;
		n -= 1;
	}
	
	return arr;
}

module.exports = {};
module.exports = shuffle;
