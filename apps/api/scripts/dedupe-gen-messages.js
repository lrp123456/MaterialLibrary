/**
 * 清理「一次生成两条消息」的历史脏数据。
 *
 * 背景：worker 完成时会落一条 assistant 结果消息（run_id=job_id），前端生成完又 POST 了一条
 * （不传 id、不传 runId），于是同一次生成留下两条同图记录 —— 刷新/切回会话就看到两张一样的图。
 * 现在已改成两侧共用 `genmsg_<jobId>` 主键 upsert，这个脚本只负责把旧数据合并掉。
 *
 * 用法（在 WSL 里跑，Windows 侧 better-sqlite3 是 ELF 模块加载不了）：
 *   node scripts/dedupe-gen-messages.js                 # dry-run，只打印将要合并的组
 *   node scripts/dedupe-gen-messages.js --json r.json   # 附带导出明细
 *   node scripts/dedupe-gen-messages.js --apply         # 真正合并（会先备份 material.db）
 *   node scripts/dedupe-gen-messages.js --since 30      # 只看最近 30 天（默认全量）
 *
 * 判定：同 session、role=assistant，按「媒体地址」分组；失败/取消消息没有媒体地址时
 * 退化为「结果正文」分组，只合并字体完全相同的错误卡。组内 created_at 相差 ≤ 15 分钟，
 * 且必须同时含「带 run_id 的权威行」与「不带 run_id 的旧前端行」（一权威一非权威才合并，
 * 用户真实重试产生的多条独立失败不会被误吞）。保留信息最全的一条，其余合并后删除。
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { openDb } = require('../src/db');

const GAP_MS = 15 * 60 * 1000;

/** 只有「worker 权威行 + 旧前端无 run_id 行」同簇才是双写脏数据。 */
function isDoubleWrite(cluster) {
  return cluster.some((r) => r.run_id) && cluster.some((r) => !r.run_id);
}

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return def;
}
function has(name) {
  return process.argv.includes(name);
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

function mediaUrlOf(row) {
  const r = parseJson(row.result_json, {}) || {};
  return String(r.imageUrl || r.videoUrl || r.audioUrl || '');
}

/** 去重签名：优先媒体地址；失败/取消卡没有媒体，用结果正文（与前端 dedupeLoadedMessages 一致）。 */
function signatureOf(row) {
  const media = mediaUrlOf(row);
  if (media) return `media:${media}`;
  const r = parseJson(row.result_json, {}) || {};
  const content = String(r.content || row.prompt || '').trim();
  if (content.startsWith('生成遇到问题') || content === '生成已取消') return `text:${content}`;
  return '';
}

/** 保留信息更全的那条：有 run_id > prompt 非空 > params_json 更长 > 更新 */
function score(row) {
  const r = parseJson(row.result_json, {}) || {};
  return (row.run_id ? 1000 : 0)
    + (String(r.prompt || row.prompt || '').trim() ? 100 : 0)
    + Math.min(99, String(row.params_json || '').length / 20)
    + (Number(row.created_at || 0) / 1e13);
}

function main() {
  const dataDir = arg('--data', path.join(__dirname, '..', 'data'));
  const apply = has('--apply');
  const outJson = arg('--json', '');
  const sinceDays = Number(arg('--since', '0')) || 0;

  const db = openDb(dataDir);
  const dbPath = db.name || '';
  const minCreated = sinceDays > 0 ? Date.now() - sinceDays * 86400000 : 0;
  const rows = db.prepare(`
    SELECT id, session_id, role, mode, prompt, params_json, result_json, run_id, created_at
    FROM chat_messages
    WHERE role = 'assistant'
      AND result_json IS NOT NULL
      AND created_at >= ?
    ORDER BY session_id ASC, created_at ASC
  `).all(minCreated);

  console.log(`[dedupe-gen-messages] dataDir=${dataDir} 扫描 ${rows.length} 条 assistant 消息  mode=${apply ? 'APPLY' : 'DRY-RUN'}`);

  // 按 session + 签名（媒体地址，失败卡退化为错误正文）分组，再按时间间隙切成相邻簇
  const buckets = new Map();
  for (const row of rows) {
    const sig = signatureOf(row);
    if (!sig) continue;
    const key = `${row.session_id}::${sig}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(row);
  }

  const groups = [];
  for (const [key, list] of buckets) {
    if (list.length < 2) continue;
    list.sort((a, b) => Number(a.created_at) - Number(b.created_at));
    let cluster = [list[0]];
    for (let i = 1; i < list.length; i += 1) {
      const gap = Number(list[i].created_at) - Number(list[i - 1].created_at);
      if (gap <= GAP_MS) {
        cluster.push(list[i]);
      } else {
        if (cluster.length > 1 && isDoubleWrite(cluster)) groups.push({ key, rows: cluster });
        cluster = [list[i]];
      }
    }
    if (cluster.length > 1 && isDoubleWrite(cluster)) groups.push({ key, rows: cluster });
  }

  console.log(`[dedupe-gen-messages] 命中 ${groups.length} 组重复，共可删除 ${groups.reduce((n, g) => n + g.rows.length - 1, 0)} 条`);

  const detail = [];
  for (const g of groups) {
    const sorted = [...g.rows].sort((a, b) => score(b) - score(a));
    const keep = sorted[0];
    const drops = sorted.slice(1);
    detail.push({
      key: g.key,
      keep: { id: keep.id, run_id: keep.run_id, created_at: keep.created_at },
      drop: drops.map((d) => ({ id: d.id, run_id: d.run_id, created_at: d.created_at })),
    });
    console.log(`  KEEP ${keep.id}${keep.run_id ? ` (run_id=${keep.run_id})` : ''}  DROP ${drops.map((d) => d.id).join(', ')}`);
  }

  if (outJson) {
    fs.writeFileSync(outJson, JSON.stringify(detail, null, 2), 'utf8');
    console.log(`明细已写入 ${outJson}`);
  }

  if (!apply) {
    db.close();
    console.log('dry-run 结束。确认无误后加 --apply 执行（会先备份 material.db）。');
    return;
  }
  if (!groups.length) {
    db.close();
    console.log('没有需要处理的数据。');
    return;
  }

  // 备份：直接复制主库文件（WAL 已 checkpoint 的部分足够恢复；如需完整一致性请停服执行）
  if (dbPath && fs.existsSync(dbPath)) {
    const bak = `${dbPath}.bak-${Date.now()}`;
    fs.copyFileSync(dbPath, bak);
    console.log(`已备份数据库 → ${bak}`);
  } else {
    console.log('未取到数据库文件路径，跳过自动备份（请自行确认已备份）。');
  }

  const mergeStmt = db.prepare(`
    UPDATE chat_messages
    SET run_id = COALESCE(run_id, ?),
        prompt = CASE WHEN COALESCE(prompt,'')='' THEN ? ELSE prompt END,
        params_json = CASE WHEN COALESCE(params_json,'') IN ('','{}') THEN ? ELSE params_json END,
        result_json = COALESCE(result_json, ?)
    WHERE id = ?
  `);
  const delStmt = db.prepare('DELETE FROM chat_messages WHERE id = ?');

  let removed = 0;
  const tx = db.transaction((batch) => {
    for (const g of batch) {
      const sorted = [...g.rows].sort((a, b) => score(b) - score(a));
      const keep = sorted[0];
      for (const drop of sorted.slice(1)) {
        mergeStmt.run(drop.run_id || null, drop.prompt || '', drop.params_json || '', drop.result_json || null, keep.id);
        delStmt.run(drop.id);
        removed += 1;
      }
    }
  });
  tx(groups);
  db.close();
  console.log(`完成：删除 ${removed} 条重复消息。`);
}

main();
