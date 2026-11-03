const { openDb } = require('../src/db');
const { runScan } = require('../src/sync');
const { resolveQuarkCli } = require('../src/quark');
const path = require('path');
const os = require('os');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);

const config = {
  cliPath: resolveQuarkCli(process.env.QUARK_CLI_PATH),
  rootFid: process.env.QUARK_ROOT_FID || '225f01205b7942b1a75bb0c2d7a0565a',
  systemFid: process.env.QUARK_SYSTEM_FID || 'a082098178f74add99cbf6de2c4caa8a',
  dataDir,
  nasDir: process.env.ML_NAS_DIR || '/mnt/synology/material'
};

const services = { db, config, logger: console };

console.log('[sync] 开始执行夸克网盘全量同步扫描...');
runScan(services, { manual: true }).then((stats) => {
  console.log('[sync] 同步完成，统计结果:');
  console.log(JSON.stringify(stats, null, 2));

  // 检查当前 assets 状态与数量
  const total = db.prepare("SELECT count(*) c FROM assets").get().c;
  const discovered = db.prepare("SELECT count(*) c FROM assets WHERE status='discovered'").get().c;
  const ready = db.prepare("SELECT count(*) c FROM assets WHERE status='ready'").get().c;
  console.log(`\n当前总素材数: ${total}, discovered: ${discovered}, ready: ${ready}`);
}).catch((err) => {
  console.error('[sync] 同步失败:', err);
});
