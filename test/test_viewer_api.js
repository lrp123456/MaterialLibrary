async function test() {
  const loginRes = await fetch('http://127.0.0.1:30001/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'viewer', password: '' })
  });
  const loginData = await loginRes.json();
  console.log('Login Result:', loginData);
  const token = loginData.data?.token || loginData.token;

  const assetsRes = await fetch('http://127.0.0.1:30001/api/viewer/assets?page=1&pageSize=5', {
    headers: { Authorization: `Bearer ${token}` }
  });
  const assetsData = await assetsRes.json();
  console.log('Viewer Assets Total:', assetsData.data?.total || assetsData.total);
  const items = assetsData.data?.items || assetsData.items || [];
  console.log('Viewer Items Count:', items.length);
  if (items[0]) {
    console.log('First Asset Sample:', {
      fid: items[0].fid,
      file_name: items[0].file_name,
      status: items[0].status,
      kind: items[0].kind,
      created_at: new Date(Number(items[0].created_at)).toLocaleString('zh-CN')
    });
  }
}

test().catch(console.error);
