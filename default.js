var DEFAULT = {
	torrentPrefix: "OG",
	version: "0009",
	PORT: 6881,
	PATH: "./downloads/",
	MAX_PEERS: 50,
	MAX_CONNPEERS: 50,
	UDP_DEFAULT1: 0x417,
	UDP_DEFAULT2: 0x27101980,
	POW2_32: 0xffffffff + 1,
	TRIES: 2,					   //  8
	SPEED: 100,				 	 //  1000
	PEER_TIMEOUT: 3000,  //  30000
	HANDSHAKE: "\u0013BitTorrent protocol\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000"
};

module.exports = DEFAULT;
