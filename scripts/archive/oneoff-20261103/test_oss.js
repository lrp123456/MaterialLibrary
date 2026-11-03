const crypto = require('crypto');
const https = require('https');

const config = {
  region: 'cn-beijing',
  bucket: 'naite-mes',
  endpoint: 'img.naite.cc',
  accessKeyId: process.env.OSS_AK || '',
  accessKeySecret: process.env.OSS_SK || ''
};

async function testUpload() {
  const content = Buffer.from('hello oss test ' + Date.now());
  const objectKey = 'test/ping_' + Date.now() + '.txt';
  const date = new Date().toUTCString();
  const contentType = 'text/plain';

  // 1. 测试标准 OSS 域名：naite-mes.oss-cn-beijing.aliyuncs.com
  const ossHost = `${config.bucket}.oss-${config.region}.aliyuncs.com`;
  const canonicalResource = `/${config.bucket}/${objectKey}`;
  const stringToSign = `PUT\n\n${contentType}\n${date}\n${canonicalResource}`;
  const signature = crypto.createHmac('sha1', config.accessKeySecret).update(stringToSign).digest('base64');
  const authHeader = `OSS ${config.accessKeyId}:${signature}`;

  console.log('Testing upload to:', ossHost, 'key:', objectKey);

  const req = https.request({
    hostname: ossHost,
    port: 443,
    path: `/${objectKey}`,
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Date': date,
      'Authorization': authHeader
    }
  }, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => {
      console.log('OSS Status:', res.statusCode);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log('SUCCESS! File uploaded.');
        console.log('Standard URL:', `https://${ossHost}/${objectKey}`);
        console.log('Custom Domain URL:', `https://${config.endpoint}/${objectKey}`);
        
        // 尝试用自定义域名 GET 读取
        testRead(`https://${config.endpoint}/${objectKey}`);
      } else {
        console.error('Failed. Response:', body);
      }
    });
  });

  req.on('error', (err) => {
    console.error('Req error:', err.message);
  });

  req.write(content);
  req.end();
}

function testRead(url) {
  https.get(url, (res) => {
    console.log('Custom domain read status:', res.statusCode);
  }).on('error', (err) => {
    console.log('Custom domain read error:', err.message);
  });
}

testUpload();
