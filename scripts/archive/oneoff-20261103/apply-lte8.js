const fs = require('fs')
const { openDb } = require('../src/db')
const { applyDedupePairs } = require('../src/dedupe-library')
const dataDir = '/home/lrp/.dsh-material-library'
const report = JSON.parse(fs.readFileSync('/tmp/dedupe-lte8.json', 'utf8'))
const pairs = report.pairs || []
console.log('apply phash<=8', pairs.length)
const db = openDb(dataDir)
const r = applyDedupePairs({ db, config: { dataDir }, logger: console }, pairs)
console.log(JSON.stringify({ attempted: r.attempted, deleted: r.deleted, failed: r.failed, failSample: (r.results||[]).filter(x=>!x.ok).slice(0,5) }, null, 2))
try { db.close() } catch (e) {}
