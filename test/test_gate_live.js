const { setGlobalDispatcher, EnvHttpProxyAgent } = require('undici');
process.env.HTTP_PROXY = process.env.HTTP_PROXY || 'http://127.0.0.1:7890';
process.env.HTTPS_PROXY = process.env.HTTPS_PROXY || 'http://127.0.0.1:7890';
process.env.NO_PROXY = '127.0.0.1,localhost,::1';
setGlobalDispatcher(new EnvHttpProxyAgent());

const betterSqlite = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
const db = new betterSqlite('/home/lrp/.dsh-material-library/material.db');
const { executeGate } = require('../src/nodes');

async function main() {
  const asset = db.prepare("SELECT * FROM assets WHERE kind='image' ORDER BY created_at DESC LIMIT 1").get();
  console.log('Testing asset:', asset.fid, asset.file_name);

  const services = {
    db,
    config: { dataDir: '/home/lrp/.dsh-material-library' },
    logger: console
  };

  const nodeConfig = {
    model: 'doubao-seed-2-0-pro-260215'
  };

  console.log('Calling executeGate...');
  const res = await executeGate(services, nodeConfig, asset);
  console.log('executeGate Result:', res);
}

main().catch(console.error).finally(() => db.close());
