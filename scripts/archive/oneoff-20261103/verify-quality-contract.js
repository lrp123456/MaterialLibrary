/**
 * 阶段 3 验证：筛选面板契约 + 9 维评估 + 相似组
 * 在 WSL 侧运行：node scripts/verify-quality-contract.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA_DIR = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const BASE = process.env.ML_BASE || 'http://127.0.0.1:30001';

function readCredentials() {
  try {
    const txt = fs.readFileSync(path.join(DATA_DIR, 'bootstrap-credentials.txt'), 'utf8');
    const line = txt.split(/\r?\n/).find((l) => l.trim().startsWith('admin:'));
    const m = line && line.match(/admin:\s*(\S+)/);
    return m ? m[1] : null;
  } catch (_) { return null; }
}

async function api(p, { method = 'GET', token = '', body = null } = {}) {
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

function ok(cond, msg) {
  console.log((cond ? '[PASS] ' : '[FAIL] ') + msg);
  return !!cond;
}

(async () => {
  const pass = readCredentials();
  const login = await api('/api/viewer/auth/login', { method: 'POST', body: { username: 'admin', password: pass } });
  const token = login.json && login.json.data && login.json.data.token;
  if (!token) { console.error('登录失败', login.text.slice(0, 200)); process.exit(1); }
  console.log('登录成功\n');

  // ── 17. 筛选面板维度契约 ──
  const list = await api('/api/viewer/assets?page=1&pageSize=5&media_type=image&sort=latest', { token });
  const data = (list.json && list.json.data) || {};
  const fo = data.filterOptions || {};
  const dims = Array.isArray(fo.dimensions) ? fo.dimensions : [];
  ok(dims.length === 10, `filterOptions.dimensions 维度数 = ${dims.length}（期望 10）`);
  const dimKeys = dims.map((d) => d.key).sort().join(',');
  ok(dimKeys === 'character,color,furniture,material,mood,orientation,pose,space,style,videoSource',
    `维度键 = ${dimKeys}`);
  for (const d of dims) {
    const sources = Array.isArray(d.source) ? d.source : [d.source];
    const missing = sources.filter((s) => !Array.isArray(fo[s]));
    ok(missing.length === 0, `维度 ${d.key} 的来源 ${sources.join('+')} 都有数据${missing.length ? '（缺 ' + missing.join(',') + '）' : ''}`);
  }
  ok(Array.isArray(fo.mood) && fo.mood.length > 0, `mood 分面 ${(fo.mood || []).length} 项：${(fo.mood || []).slice(0, 4).map((m) => m.dir + '=' + m.label).join(' ')}`);
  ok(Array.isArray(fo.pose) && fo.pose.length > 0, `pose 分面 ${(fo.pose || []).length} 项：${(fo.pose || []).map((m) => m.dir).join(' ')}`);
  ok(Array.isArray(fo.character) && fo.character.length > 0, `character 分面 ${(fo.character || []).length} 项：${(fo.character || []).map((m) => m.dir).join(' ')}`);
  ok(Array.isArray(fo.video_source) && fo.video_source.length === 2, `video_source 分面 ${(fo.video_source || []).length} 项`);
  ok(Array.isArray(fo.colors) && fo.colors.length > 0 && fo.colors.every((c) => !!c.hex),
    `colors 分面 ${(fo.colors || []).length} 项，全部带 hex`);

  // 用服务端给的真实值反查，确认筛选链路通（挑一个命中数 > 0 的取值）
  const probe = async (dim, facetKey, param) => {
    const list = (fo[facetKey] || []);
    const hit = list.find((x) => Number(x.count) > 0);
    if (!hit) {
      console.log(`[INFO] ${dim} 当前库里没有命中数 > 0 的取值（词表 ${list.length} 项），跳过反查`);
      return;
    }
    const r = await api('/api/viewer/assets?page=1&pageSize=1&' + param + '=' + encodeURIComponent(hit.dir), { token });
    const t = (r.json && r.json.data && r.json.data.total) || 0;
    ok(t > 0, `按 ${param}=${hit.dir} 反查命中 ${t} 条（分面计数 ${hit.count}）`);
  };
  await probe('mood', 'mood', 'mood');
  await probe('colors', 'colors', 'colors');
  await probe('orientation', 'orientation', 'orientation');
  await probe('space', 'space', 'space');
  await probe('pose', 'pose', 'pose');
  await probe('character', 'character', 'character');
  await probe('material', 'material_kind', 'material');
  await probe('style', 'style_atom', 'style');
  await probe('furniture', 'furniture_item', 'furniture_item');

  // ── 18/19/20. 9 维分 + 相似组 ──
  const items = data.items || [];
  ok(items.length > 0, `列表取到 ${items.length} 条样本`);

  // 找一个「有相似组」的样本，证明相似组逻辑真的能出结果
  const probeList = await api('/api/viewer/assets?page=1&pageSize=30&media_type=image&sort=latest', { token });
  const probeItems = ((probeList.json && probeList.json.data && probeList.json.data.items) || []);
  let sample = null;
  let sampleQuality = null;
  for (const it of probeItems) {
    const r = await api('/api/viewer/assets/' + encodeURIComponent(it.fid) + '/quality', { token });
    const d = (r.json && r.json.data) || null;
    if (!d) continue;
    if (!sample) { sample = it; sampleQuality = d; }
    if (d.similar && d.similar.count > 0) { sample = it; sampleQuality = d; break; }
  }
  ok(!!sample, `找到评估样本 ${sample ? sample.fid : '无'}`);
  const fid = sample && sample.fid;
  const qd = sampleQuality || {};
  ok(Array.isArray(qd.dims) && qd.dims.length === 9, `9 维分维度数 = ${(qd.dims || []).length}`);
  console.log('  ' + (qd.dims || []).map((d) => `${d.label} ${d.score}/${d.max}(${d.detail})`).join('  '));
  ok(qd.max === 145, `满分 = ${qd.max}（期望 145）`);
  ok(qd.similar && Array.isArray(qd.similar.groups), `相似组字段存在，命中 ${(qd.similar && qd.similar.count) || 0} 个近似素材`);
  if ((qd.similar && qd.similar.count) > 0) {
    const g = qd.similar.groups[0];
    console.log(`  相似组 1：${g.size} 张，最相近 ${g.members[0].fid} 距离 ${g.members[0].distance}`);
    ok(g.members.length > 0 && typeof g.members[0].distance === 'number', '相似组成员带距离值');
  } else {
    console.log('[INFO] 该样本没有近似素材（库内相似度分散），字段结构正常');
  }

  // ── 18. assets.sharpness 真的有值 ──
  const Database = require('/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/node_modules/better-sqlite3');
  const db = new Database(path.join(DATA_DIR, 'material.db'), { readonly: true });
  const sharpStat = db.prepare('SELECT COUNT(*) c FROM assets WHERE sharpness IS NOT NULL AND sharpness > 0').get();
  ok(sharpStat.c > 0, `assets.sharpness 非零行数 = ${sharpStat.c}`);
  const qCount = db.prepare('SELECT COUNT(*) c FROM asset_quality_score').get();
  ok(qCount.c > 0, `asset_quality_score 落表行数 = ${qCount.c}`);
  const sampleRow = db.prepare('SELECT sharpness FROM assets WHERE fid=?').get(fid);
  ok(sampleRow && sampleRow.sharpness > 0, `样本 ${fid} 的 sharpness = ${sampleRow && sampleRow.sharpness}`);
  db.close();
})().catch((e) => { console.error('脚本异常:', e); process.exit(1); });
