const { openDb } = require('../src/db');
const { resolveQuarkCli, Quark } = require('../src/quark');
const path = require('path');
const os = require('os');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);

console.log('--- 衍生图类型分布 ---');
console.log(db.prepare("SELECT kind, count(*) c FROM derivatives GROUP BY kind").all());

console.log('\n--- 衍生图存储类型分布 ---');
console.log(db.prepare("SELECT storage_type, count(*) c FROM derivatives GROUP BY storage_type").all());

console.log('\n--- 上次夸克扫描记录 ---');
const lastScan = db.prepare("SELECT value FROM kv WHERE key='last_scan'").get();
console.log(lastScan ? JSON.parse(lastScan.value) : '无记录');

console.log('\n--- 检查夸克 CLI 配置与状态 ---');
const cliPath = resolveQuarkCli(process.env.QUARK_CLI_PATH);
console.log('Quark CLI 路径:', cliPath);
const quark = new Quark(cliPath);
quark.version().then(v => {
  console.log('Quark CLI 版本:', v);
}).catch(e => {
  console.log('Quark CLI 获取版本失败:', e.message);
});

console.log('\n--- 检查重评/AI重构图 (restage) 数据 ---');
const restage916 = db.prepare("SELECT count(*) c FROM derivatives WHERE kind='restage_9_16'").get().c;
const restage34 = db.prepare("SELECT count(*) c FROM derivatives WHERE kind='restage_3_4'").get().c;
console.log(`9:16 重构图数量: ${restage916}, 3:4 重构图数量: ${restage34}`);

// 检查素材的重构覆盖情况（CONFLICT-002：重复组退役，不再有「代表图」概念，改用 ready 素材口径）
const readyCount = db.prepare("SELECT count(*) c FROM assets WHERE status='ready' AND kind='image'").get().c;
const readyWithRestage = db.prepare(`
  SELECT count(DISTINCT a.fid) c FROM assets a
  JOIN derivatives d ON a.fid = d.asset_fid
  WHERE a.status='ready' AND a.kind='image' AND d.kind IN ('restage_9_16', 'restage_3_4')
`).get().c;
console.log(`ready 图片总数: ${readyCount}, 已有重构图的: ${readyWithRestage}`);
