const fs = require('fs');
const lines = fs.readFileSync('./src/api.js', 'utf8').split('\n');
lines.forEach((l, i) => {
  if (l.includes("pathname === '/assets") || l.includes("pathname.startsWith('/assets")) {
    console.log(i + 1, l.trim());
  }
});
