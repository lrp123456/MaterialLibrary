/**
 * 将 src 中已修复的文件同步到 src_backup，避免打包脚本用空壳/反编译副本。
 * 用法: node scripts/sync-src-backup.js
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const src = path.join(root, 'src')
const bak = path.join(root, 'src_backup')

const files = [
  'components/HomeLibrary.vue',
  'components/AiTaskPill.vue',
  'components/TouchSelector.vue',
  'components/WalkthroughDrawer.vue',
  'pages/detail/detail.vue',
  'pages/login/login.vue',
  'pages/permission/permission.vue',
  'pages/settings/settings.vue',
  'pages/editor/editor.vue',
  'pages/studio/studio.vue',
  'pages/quick/expand.vue',
  'pages/quick/enhance.vue',
  'pages/quick/insert.vue',
  'pages/quick/replace.vue',
  'pages/quick/walkthrough.vue',
  'pages/quick/remove.vue',
  'pages/quick/watermark.vue',
  'pages-h5/create/create.vue',
  'pages.json',
  'common/Constants.js',
  'service/ServerResolve.js',
  'service/SyncStateStore.js',
  'service/ViewerApi.js',
  'service/ViewerCache.js',
  'service/WebDownload.js',
  'common/assetMap.js',
  'common/filters.js',
  'components/DetailLightbox.vue',
  'components/GlbTransform.vue',
  'pages/home/home.vue',
  'pages/browse/browse.vue',
  'pages/chat/chat.vue',
  'pages-h5/detail/detail.vue',
  'pages-h5/library/library.vue',
  'pages-h5/edit/edit.vue',
  'pages-h5/h5-theme.js',
]

let ok = 0
for (const f of files) {
  const s = path.join(src, f)
  const d = path.join(bak, f)
  if (!fs.existsSync(s)) {
    console.log('MISS src', f)
    continue
  }
  fs.mkdirSync(path.dirname(d), { recursive: true })
  fs.copyFileSync(s, d)
  const len = fs.statSync(d).size
  console.log('SYNC', String(len).padStart(7), f)
  ok++
}
console.log(`done: ${ok}/${files.length} files synced to src_backup`)
