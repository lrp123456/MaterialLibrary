const fs = require('fs');
const path = require('path');

async function main() {
  console.log('=== 1. Server Process Environ ===');
  try {
    const pid = fs.readFileSync('/home/lrp/.dsh-material-library/server.pid', 'utf8').trim();
    const envBuf = fs.readFileSync(`/proc/${pid}/environ`, 'utf8');
    const envVars = envBuf.split('\0');
    const matched = envVars.filter(e => /umbra|tpl|bff|vlm|llm|lite|port|host|kilo|gateway/i.test(e));
    console.log(`Server PID: ${pid}`);
    console.log('Relevant env vars:', matched);
  } catch (e) {
    console.log('Error reading server environ:', e.message);
  }

  console.log('\n=== 2. Check KX2BFK_umbra_quick .env ===');
  try {
    const envFile = '/home/lrp/my_folder/smu/KX2BFK_umbra_quick/.env';
    if (fs.existsSync(envFile)) {
      const lines = fs.readFileSync(envFile, 'utf8').split('\n')
        .filter(l => l && !l.startsWith('#'))
        .filter(l => /port|host|token|url|api|key/i.test(l))
        .map(l => {
          const idx = l.indexOf('=');
          if (idx > -1) {
            const k = l.slice(0, idx);
            const v = l.slice(idx + 1);
            return `${k}=${v.length > 8 ? v.slice(0, 4) + '...' + v.slice(-4) : v}`;
          }
          return l;
        });
      console.log('KX2BFK_umbra_quick .env keys:', lines);
    } else {
      console.log('No .env found');
    }
  } catch (e) {
    console.log('Error reading KX2BFK .env:', e.message);
  }

  console.log('\n=== 3. Check LiteLLM / Port 4000 & 8000 & 3001 & 3000 Services ===');
  const ports = [3000, 3001, 4000, 5000, 8000, 8787, 8798, 30001];
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      console.log(`Port ${port}: reachable HTTP ${res.status}`);
    } catch (e) {
      console.log(`Port ${port}: ${e.message}`);
    }
  }

  console.log('\n=== 4. Check active VLM in MaterialLibraryServer ===');
  const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
  const db = new betterSqlite('/home/lrp/.dsh-material-library/material.db', { readonly: true });
  const provs = db.prepare("SELECT * FROM llm_providers").all();
  console.log('LLM Providers:', provs);
  const models = db.prepare("SELECT * FROM llm_models").all();
  console.log('LLM Models:', models);

  console.log('\n=== 5. Test VLM Endpoint ===');
  for (const p of provs) {
    console.log(`Testing provider ${p.name} at ${p.base_url}`);
    try {
      const endpoint = p.base_url;
      const res = await fetch(endpoint, { signal: AbortSignal.timeout(3000) });
      console.log(`Provider ${p.name}: HTTP ${res.status}`);
    } catch (e) {
      console.log(`Provider ${p.name} failed: ${e.message}`);
    }
  }
}

main().catch(console.error);
