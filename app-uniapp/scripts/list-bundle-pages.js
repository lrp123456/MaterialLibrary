/**
 * 列出 bundle 中 __definePage 注册的全部页面及组件 __file。
 */
const fs = require('fs')
const bundle = process.argv[2]
const text = fs.readFileSync(bundle, 'utf8')

const defines = [...text.matchAll(/__definePage\("([^"]+)"\s*,\s*([A-Za-z_$][\w$]*)\)/g)]
console.log('=== __definePage routes ===')
for (const m of defines) console.log(m[1], '->', m[2])

const files = [...text.matchAll(/__file\s*,\s*"([^"]+\.vue)"/g)].map((m) => m[1])
console.log('\n=== __file SFC ===')
for (const f of [...new Set(files)]) console.log(f)

// 含 quick 的任意片段
const quick = [...new Set(text.match(/quick[^"'\s]{0,40}/g) || [])]
console.log('\n=== quick* tokens ===')
for (const q of quick.slice(0, 40)) console.log(q)

const studio = [...new Set(text.match(/studio[^"'\s]{0,40}/g) || [])]
console.log('\n=== studio* tokens ===')
for (const q of studio.slice(0, 40)) console.log(q)
