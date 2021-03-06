# OGTorrent
  
#### Synopsis
------
Work-in-progress-but-functional BitTorrent client written entirely in asynchronous Node.js

| **Currently Supported**													  | **Soon-to-be Supported**   | **Does Not Support**    |
|---------------------------------------------------|----------------------------|-------------------------|
| Reading single .torrent files											|	Uploading files to peers	 | Distributed Hash Table	 |
| Multiple trackers																  | Graceful shutdown					 |												 |
| Multiple file torrents														| Resuming partial torrents	 |												 |
| Random -> Rarest First -> Endgame peer requesting | Mutliple .torrent files		 |												 |
| SHA1 hash checks on completed pieces							|														 |												 |

#### Dependencies
------
Node - 0.12.x
  
Bluebird - 2.9.x  
Underscore - 1.8.x

#### Install
------
Install via npm:
```
npm install ogtorrent
```
  
Install via github (requires working versions of underscore and bluebird, see package.json):
```
git clone https://github.com/frrakn/OGTorrent.git
```

#### Usage
------
To run specifying a single file: 
```
node torrent path/to/torrent/file.torrent
```

Files are saved in the downloads/ directory.
