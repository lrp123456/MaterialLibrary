const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'studio', 'studio.vue'), 'utf8');
const m = s.match(/<script>([\s\S]*?)<\/script>/);
if (!m) {
  console.log('no script');
  process.exit(1);
}
try {
  // rough syntax check: strip imports/exports
  let body = m[1]
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/export\s+default/, 'const __d =');
  new Function(body);
  console.log('script parse OK', body.length);
} catch (e) {
  console.log('PARSE_ERR', e.message);
}
// count tags roughly
const open = (s.match(/<view\b/g) || []).length;
const close = (s.match(/<\/view>/g) || []).length;
console.log('view open/close', open, close, open === close ? 'balanced' : 'MISMATCH');
