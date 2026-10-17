const BASE = 'http://127.0.0.1:8787';
async function main() {
  const login = await fetch(`${BASE}/api/viewer/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer', password: process.argv[2] || '' })
  });
  const loginData = await login.json();
  if (!login.ok) {
    console.error('login failed', login.status, loginData);
    process.exit(1);
  }
  const token = loginData.data.token;
  const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const presets = await fetch(`${BASE}/api/viewer/presets`, { headers: H });
  const presetsData = await presets.json();
  console.log('presets', presets.status, presetsData.data?.presets?.length, 'gatewayReady=', presetsData.data?.gatewayReady);

  const assets = await fetch(`${BASE}/api/viewer/assets?page=1&pageSize=1`, { headers: H });
  const assetsData = await assets.json();
  const fid = assetsData.data?.items?.[0]?.fid;
  console.log('first fid', fid, 'total', assetsData.data?.total);

  const procList = await fetch(`${BASE}/api/viewer/assets/${encodeURIComponent(fid)}/process`, { headers: H });
  console.log('process list', procList.status, JSON.stringify(await procList.json()).slice(0, 200));

  const submit = await fetch(`${BASE}/api/viewer/assets/${encodeURIComponent(fid)}/process`, {
    method: 'POST', headers: H, body: JSON.stringify({ preset_id: 'watermark_remove' })
  });
  console.log('submit', submit.status, JSON.stringify(await submit.json()).slice(0, 300));
}
main().catch(e => { console.error(e); process.exit(1); });
