const http = require('http');

function testUrl(url, headers = {}) {
  return new Promise((resolve) => {
    http.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => {
        if (data.length < 500) data += chunk.toString();
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          contentType: res.headers['content-type'],
          contentLength: res.headers['content-length'],
          dataPreview: data.slice(0, 120)
        });
      });
    }).on('error', err => resolve({ error: err.message }));
  });
}

async function run() {
  const url1 = 'http://127.0.0.1:30000/api/creation-templates/tpl_1795146181668_19641370/media/origin/0';
  const urlPoster = 'http://127.0.0.1:30000/api/creation-templates/tpl_1795148532753_034eeb82/media/poster/0';
  const urlResult = 'http://127.0.0.1:30000/api/creation-templates/tpl_1795148532753_034eeb82/media/result/0';
  
  console.log('--- 1. Request to Port 30000 (Backend directly, no cookie) ---');
  console.log('origin 0:', await testUrl(url1));
  console.log('poster 0:', await testUrl(urlPoster));
  console.log('result 0 (video):', await testUrl(urlResult));

  console.log('\n--- 2. Request to Port 30003 (Web proxy, no cookie) ---');
  console.log('origin 0 via 30003:', await testUrl('http://127.0.0.1:30003/api/creation-templates/tpl_1795146181668_19641370/media/origin/0'));
  console.log('poster 0 via 30003:', await testUrl('http://127.0.0.1:30003/api/creation-templates/tpl_1795148532753_034eeb82/media/poster/0'));
}

run();
