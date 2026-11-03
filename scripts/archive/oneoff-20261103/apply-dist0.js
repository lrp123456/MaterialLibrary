const path = require('path')
const fs = require('fs')
const { openDb } = require('../src/db')
const { applyDedupePairs, formatReportCsv } = require('../src/dedupe-library')

const dataDir = process.env.ML_DATA_DIR || '/home/lrp/.dsh-material-library'
const split = JSON.parse(fs.readFileSync('/tmp/dedupe-split.json', 'utf8'))
const toDelete = split.to_delete || []
console.log('will delete dist=0 pairs:', toDelete.length)

const db = openDb(dataDir)
const services = { db, config: { dataDir }, logger: console }
const r = applyDedupePairs(services, toDelete)
console.log(JSON.stringify({ attempted: r.attempted, deleted: r.deleted, failed: r.failed, failSample: (r.results||[]).filter(x=>!x.ok).slice(0,5) }, null, 2))

const review = split.review || []
fs.writeFileSync('/tmp/dedupe-review-nz.csv', formatReportCsv({ pairs: review }))
fs.writeFileSync('/tmp/dedupe-review-nz.json', JSON.stringify({ matched: review.length, pairs: review }, null, 2))
console.log('review non-zero written', review.length)
try { db.close() } catch (e) {}
