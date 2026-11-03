const fs = require('fs')
const { openDb } = require('../src/db')
const { applyDedupePairs } = require('../src/dedupe-library')
const dataDir = '/home/lrp/.dsh-material-library'
const junk = JSON.parse(fs.readFileSync('/tmp/junk-assets.json', 'utf8'))
const pairs = junk.map(j => ({
  dropFid: j.fid,
  dropName: j.name,
  keepFid: 'junk-cleanup',
  keepName: '(non-interior screenshot/ui)',
  reason: 'non_interior_ui',
  dist: null,
}))
console.log('delete junk UI/screenshots', pairs.length)
const db = openDb(dataDir)
const r = applyDedupePairs({ db, config: { dataDir }, logger: console }, pairs)
console.log(JSON.stringify({ attempted: r.attempted, deleted: r.deleted, failed: r.failed, failSample: (r.results||[]).filter(x=>!x.ok).slice(0,8) }, null, 2))
try { db.close() } catch (e) {}
