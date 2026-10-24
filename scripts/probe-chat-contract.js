/* 契约探针：App 聊天页的载荷打到 /gen/chat 会得到什么，以及正确契约长什么样
 * 用法: node scripts/probe-chat-contract.js
 * 注意：会发起两次极小的真实对话调用。
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const DATA_DIR = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const BASE = process.env.ML_BASE || 'http://127.0.0.1:30001';

function readPass() {
  if (process.env.ML_PREWARM_PASS) return process.env.ML_PREWARM_PASS;
  const m = fs.readFileSync(path.join(DATA_DIR, 'bootstrap-credentials.txt'), 'utf8').match(/admin:\s*(\S+)/);
  return m ? m[1] : null;
}

async function main() {
  const lr = await fetch(`${BASE}/api/viewer/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: readPass() }),
  }).then((r) => r.json());
  const token = lr.data && lr.data.token;
  const H = { 'content-type': 'application/json', Authorization: 'Bearer ' + token };
  const post = async (p, body) => {
    const t0 = Date.now();
    const res = await fetch(BASE + p, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    return { status: res.status, ms: Date.now() - t0, j };
  };

  // 1) 完全复刻 App 现在的行为（app-uniapp/src/pages/chat/chat.vue:268）
  const schema = (await fetch(`${BASE}/api/studio/schema`, { headers: H }).then((r) => r.json())).data;
  const picked = ((schema && schema.models) || [])[0] || {};
  console.log('1) App 现状：把 /studio/schema 的第一项当对话模型提交');
  console.log('   选择器首项 =', picked.id, '/', picked.name);
  const a = await post('/api/viewer/gen/chat', { text: '只回复一个字：好', refs: [], model: picked.id || '' });
  console.log(`   HTTP ${a.status} (${a.ms}ms) 顶层 keys: ${Object.keys(a.j).join(', ')}`);
  console.log('   有 success 字段吗:', 'success' in a.j, '（App 的 request() 要求 root.success===true 才 resolve）');
  console.log('   error:', String(a.j.error || '').slice(0, 160));

  // 2) 服务端 chat 域到底下发了什么
  const caps = (await fetch(`${BASE}/api/viewer/lab/capabilities`, { headers: H }).then((r) => r.json())).data;
  const chatModels = (((caps || {}).studio || {}).chat || {}).models || [];
  console.log('\n2) 服务端 chat 域模型:', chatModels.map((m) => `${m.id}(${m.name})`).join(', ') || '(无)');

  // 3) 对照组：Web 端同款字段名（prompt/messages）+ chat 域模型
  //    逐个试前几个（上游偶发慢/超时），只要有一个答出来就验证封套
  const tried = chatModels.slice(0, 4);
  for (const cm of tried) {
    console.log(`\n3) 对照组 model=${cm.id} (${cm.name})`);
    const b = await post('/api/viewer/gen/chat', { model: cm.id, prompt: '只回复一个字：好' });
    const d = b.j.data || b.j;
    console.log(`   HTTP ${b.status} (${b.ms}ms) 顶层 keys: ${Object.keys(b.j).slice(0, 6).join(', ')}`);
    console.log('   顶层 success =', b.j.success, '（App 的 request() 只认这个）');
    const content = ((d.choices || [])[0] || {}).message && ((d.choices || [])[0]).message.content;
    console.log('   data.choices[0].message.content =', JSON.stringify(content));
    console.log('   served_model =', d.served_model, '| substituted =', d.substituted, '| error =', b.j.error || d.error || null);
    if (b.status === 200 && content) { console.log('   → 成功，停止逐个试'); break; }
  }
}

main().catch((e) => { console.error('探针失败:', e.message); process.exit(1); });
