const fs = require('fs')
const { openDb } = require('../src/db')
const { applyDedupePairs } = require('../src/dedupe-library')
const dataDir = '/home/lrp/.dsh-material-library'
const split = JSON.parse(fs.readFileSync('/tmp/remain-phash0.json', 'utf8'))
const toDelete = split.to_delete.map(x => ({ dropFid: x.dropFid, dropName: x.dropName, keepFid: x.keepFid, keepName: x.keepName, reason: x.reason, dist: 0 }))
console.log('delete remaining phash0 extras', toDelete.length)
const db = openDb(dataDir)
const r = applyDedupePairs({ db, config: { dataDir }, logger: console }, toDelete)
console.log(JSON.stringify({ attempted: r.attempted, deleted: r.deleted, failed: r.failed }, null, 2))
try { db.close() } catch (e) {}
