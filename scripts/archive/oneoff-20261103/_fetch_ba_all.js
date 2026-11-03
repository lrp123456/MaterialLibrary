const fs = require('fs');
const { loadProjectEnv } = require('../src/env-secrets');
loadProjectEnv();

const config = {
  base: String(process.env.BA_RESOURCE_BASE || '').trim().replace(/\/+$/, ''),
  username: String(process.env.BA_RESOURCE_USER || '').trim(),
  password: String(process.env.BA_RESOURCE_PASSWORD || '').trim()
};

async function main() {
  const loginRes = await fetch(`${config.base}/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.username, password: config.password })
  });
  const token = (await loginRes.json()).token;

  const recordsMap = {};
  // Let's add more keywords: common letters, numbers, chinese characters
  const keywords = [
    '的', '图', '生', '视', '一', '我', '帮', '室', '内', '风', '片', '像', '家', '客', '装', '画', '照', '景', '空', '间', '墙', '灯', '门', '窗', '沙', '发', '桌', '椅', '柜', '床',
    '你', '有', '在', '是', '人', '了', '中', '大', '小', '美', '新', '样', '现代', '复古', '简约', '日式', '北欧', '法式', '轻奢', '奶油', '侘寂', '卧室', '餐厅', '厨房', '卫生间', '玄关', '阳台', '书房', '衣帽间',
    'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o', 'p', 'q', 'r', 's', 't', 'u', 'v', 'w', 'x', 'y', 'z',
    '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
  ];

  for (const kw of keywords) {
    let current = 1;
    while (true) {
      try {
        const url = new URL(`${config.base}/resource/v1/search`);
        url.searchParams.set('keyword', kw);
        url.searchParams.set('type', 'all');
        url.searchParams.set('current', String(current));
        url.searchParams.set('size', '50');
        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        const records = data.data?.records || [];
        for (const r of records) {
          if (r.id && r.createTime) {
            recordsMap[String(r.id)] = {
              id: r.id,
              createTime: r.createTime,
              type: r.type,
              context: r.context,
              info: r.info,
              url: r.url
            };
          }
        }
        if (current >= (data.data?.pages || 1)) break;
        current++;
      } catch (err) {
        console.error('Error on kw', kw, 'current', current, err.message);
        break;
      }
    }
  }

  console.log('Total unique records found:', Object.keys(recordsMap).length);
  fs.writeFileSync('scripts/ba_records_map.json', JSON.stringify(recordsMap, null, 2));
}

main().catch(console.error);
