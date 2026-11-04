const fs = require('fs');
const path = require('path');
const s = fs.readFileSync(path.join(__dirname, '..', 'src', 'pages', 'studio', 'studio.vue'), 'utf8');
// only template
const t = s.match(/<template>([\s\S]*)<\/template>/);
if (!t) { console.log('no template'); process.exit(1); }
const tpl = t[1];
// strip comments
const clean = tpl.replace(/<!--[\s\S]*?-->/g, '');
const stack = [];
const re = /<\/?(view|text|image|scroll-view|button|input|textarea|video|block|switch|progress)\b[^>]*?(\/?)>/g;
let mm;
let line = 1;
const lines = clean.split('\n');
// map offsets to lines
let posToLine = [];
let acc = 0;
for (const ln of lines) {
  for (let i = 0; i < ln.length + 1; i++) posToLine[acc + i] = line;
  acc += ln.length + 1;
  line++;
}
while ((mm = re.exec(clean))) {
  const tag = mm[1];
  const isClose = mm[0].startsWith('</');
  const selfClose = mm[2] === '/' || mm[0].endsWith('/>');
  const ln = posToLine[mm.index] || 0;
  if (isClose) {
    const last = stack.pop();
    if (!last || last.tag !== tag) {
      console.log('MISMATCH close', tag, 'line', ln, 'expected', last && last.tag, 'line', last && last.line);
    }
  } else if (!selfClose) {
    stack.push({ tag, line: ln });
  }
}
if (stack.length) {
  console.log('unclosed', stack.slice(-20));
} else {
  console.log('template tags balanced');
}
