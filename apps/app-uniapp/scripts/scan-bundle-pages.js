/**
 * 从旧 app-service.js 中抽取各页面/组件的源码痕迹，列出可还原目标。
 */
const fs = require('fs')
const path = require('path')

const bundle = process.argv[2]
const text = fs.readFileSync(bundle, 'utf8')
const targets = [
  'pages/quick/expand',
  'pages/quick/enhance',
  'pages/quick/insert',
  'pages/quick/replace',
  'pages/quick/walkthrough',
  'pages/quick/remove',
  'pages/quick/watermark',
  'pages/studio/studio',
  'pages/editor/editor',
  'pages-h5/create/create',
  'components/HomeLibrary',
  'components/AiTaskPill',
  'components/TouchSelector',
  'components/WalkthroughDrawer',
]

for (const t of targets) {
  const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '[^\\n]{0,80}', 'g')
  const hits = text.match(re) || []
  const uniq = [...new Set(hits)].slice(0, 5)
  console.log('\n===', t, 'hits=', hits.length, '===')
  for (const h of uniq) console.log(' ', h.slice(0, 120))
}

// 统计 __file 注入的源文件
const files = text.match(/at pages(?:-h5)?\\?\/[^"')\s]+/g) || []
const counts = {}
for (const f of files) {
  const k = f.replace(/^at /, '').split(':')[0]
  counts[k] = (counts[k] || 0) + 1
}
console.log('\n=== source files with logs ===')
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(v, k)
}
