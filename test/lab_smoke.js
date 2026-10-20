/**
 * Lab HTTP smoke：登录 admin → GET /lab/capabilities → 校验结构
 */
const BASE = process.env.ML_BASE || 'http://127.0.0.1:30001';
const USER = process.env.ML_USER;
const PASS = process.env.ML_PASS || '';
if (!USER) {
  console.error('请先设置环境变量 ML_USER（登录账号）');
  process.exit(1);
}

async function main() {
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS })
  });
  const login = await loginRes.json();
  const token = login.token || login.data?.token;
  const role = login.user?.role || login.data?.user?.role;
  if (!loginRes.ok || !token) {
    console.error('login failed', loginRes.status, login);
    process.exit(1);
  }
  console.log('login ok, role=', role);

  const capRes = await fetch(`${BASE}/api/lab/capabilities`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const cap = await capRes.json();
  if (!capRes.ok) {
    console.error('capabilities failed', capRes.status, cap);
    process.exit(1);
  }
  const data = cap.data || {};
  const entries = data.entries || [];
  console.log('entries=', entries.length);
  console.log('engines=', JSON.stringify({
    umbra: data.engines?.umbra?.ready,
    gateway: data.engines?.gateway?.ready,
    gen: data.engines?.gen?.ready
  }));
  const groups = {};
  for (const e of entries) groups[e.group] = (groups[e.group] || 0) + 1;
  console.log('byGroup=', groups);
  const ready = entries.filter(e => e.ready).map(e => e.id);
  console.log('readyEntries=', ready.join(','));
  if (entries.length < 15) {
    console.error('too few entries');
    process.exit(1);
  }
  console.log('SMOKE OK');
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
