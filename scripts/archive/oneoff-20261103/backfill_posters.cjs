const path = require('path');
const os = require('os');
const fs = require('fs');
const { openDb } = require('../src/db');
const dataDir = process.platform === 'win32'
  ? '\\\\wsl$\\Ubuntu\\home\\lrp\\.dsh-material-library'
  : path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);

const videos = db.prepare("SELECT fid, poster_path FROM assets WHERE kind='video'").all();
console.log('Total videos:', videos.length);
let updated = 0;
const updateStmt = db.prepare("UPDATE assets SET poster_path=? WHERE fid=?");

db.transaction(() => {
  for (const v of videos) {
    const thumbPath = path.join(dataDir, 'cache', 'thumbs', `${v.fid}.jpg`);
    if (fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
      const relPath = `cache/thumbs/${v.fid}.jpg`;
      if (v.poster_path !== relPath) {
        updateStmt.run(relPath, v.fid);
        updated++;
      }
    }
  }
})();

console.log(`Successfully backfilled ${updated} video poster_paths!`);
