fetch('http://127.0.0.1:8787/api/stats')
  .then((r) => r.text())
  .then((t) => console.log('OK', t.slice(0, 300)))
  .catch((e) => console.error('ERR', e.message))
