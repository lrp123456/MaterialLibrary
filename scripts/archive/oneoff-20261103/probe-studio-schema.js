/* 只读探针：确认 /studio/schema 真的给 chat.vue 下发了模型与控制项
 * 用法: node scripts/probe-studio-schema.js
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

(async () => {
  const lr = await fetch(`${BASE}/api/viewer/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: readPass() }),
  }).then((r) => r.json());
  const token = lr.data && lr.data.token;
  const get = async (p) => fetch(BASE + p, { headers: { Authorization: 'Bearer ' + token } }).then((r) => r.json());

  const s = (await get('/api/studio/schema')).data;
  console.log('── /api/studio/schema（chat.vue 用它渲染模型与快捷控制项）──');
  console.log('models:', (s.models || []).length, JSON.stringify((s.models || []).map((m) => `${m.id}|${m.name}`)));
  console.log('inputControls keys:', Object.keys(s.inputControls || {}));
  for (const [k, v] of Object.entries(s.inputControls || {})) {
    console.log(`  ${k}: ${(v || []).map((f) => `${f.key}(${(f.options || []).length})`).join(', ') || '(空)'}`);
  }

  const c = (await get('/api/studio/catalog')).data;
  const schemas = c.schemas || {};
  const one = Object.values(schemas)[0];
  console.log('\n── /api/studio/catalog（工坊参数契约，home.vue 用它）──');
  console.log('schemas:', Object.keys(schemas).length, '| models:', (c.models || []).length);
  console.log('首个 schema 字段数: common=' + (one.common || []).length + ' advanced=' + (one.advanced || []).length
    + ' modes=' + (one.modes || []).length);
})();
