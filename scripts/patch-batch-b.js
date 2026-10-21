const fs = require('fs');
const path = require('path');

console.log('--- Applying Batch B Patches ---');

// 1. patch src/fingerprint.js
const fpFile = path.resolve(__dirname, '../src/fingerprint.js');
let fpContent = fs.readFileSync(fpFile, 'utf8');

const fpTarget = `  if (!phash) return null;`;
if (fpContent.includes(fpTarget) && !fpContent.includes('const maxSameDist = opts.exactOnly ? 0 : sameThreshold;')) {
  const fpReplacement = `  if (!phash) return null;

  // 决策 1：入库网关严格只拦绝对重复（dist === 0）；1 <= dist <= 8 连拍图交由工作台人工筛选
  const maxSameDist = opts.exactOnly ? 0 : sameThreshold;
  const maxNearDist = opts.exactOnly ? 0 : nearThreshold;`;

  fpContent = fpContent.replace(fpTarget, fpReplacement);
  fpContent = fpContent.replace(/if \(dist > nearThreshold\) continue;/g, 'if (dist > maxNearDist) continue;');
  fpContent = fpContent.replace(/reason: dist <= sameThreshold \? `phash:\$\{dist\}` : `phash_near:\$\{dist\}`/g, 'reason: dist <= maxSameDist ? `phash:${dist}` : `phash_near:${dist}`');
  fpContent = fpContent.replace(/if \(dist <= sameThreshold\) return best;/g, 'if (dist <= maxSameDist) return best;');

  fs.writeFileSync(fpFile, fpContent, 'utf8');
  console.log('[PASS] src/fingerprint.js patched');
} else {
  console.log('[INFO] src/fingerprint.js already patched or target not found');
}

// 2. patch src/stream-upload.js
const streamUploadFile = path.resolve(__dirname, '../src/stream-upload.js');
let suContent = fs.readFileSync(streamUploadFile, 'utf8');

// 2a. 只读前 64KB 读取 exportTag，避免大文件 OOM
const suOomTarget = `    const { extractExportTag } = require('./export-tag');
    const tagBuf = fs.readFileSync(filePath);
    const tag = extractExportTag(tagBuf);`;

const suOomReplacement = `    const { extractExportTag } = require('./export-tag');
    const fd = fs.openSync(filePath, 'r');
    let tagBuf;
    try {
      tagBuf = Buffer.alloc(Math.min(65536, size || 65536));
      fs.readSync(fd, tagBuf, 0, tagBuf.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    const tag = extractExportTag(tagBuf);`;

if (suContent.includes(suOomTarget)) {
  suContent = suContent.replace(suOomTarget, suOomReplacement);
  console.log('[PASS] src/stream-upload.js 64KB OOM fix applied');
}

// 2b. 加入 ML_SAVED_ 文件名识别拦截 + 全量可见图检查
const suGateTarget = `  // 1. 去重检查：若同 sha256 已存在，直接返回`;
if (suContent.includes(suGateTarget) && !suContent.includes('// 0c. ML_SAVED_ 文件名识别拦截')) {
  const suGateAddition = `  // 0c. ML_SAVED_ 文件名识别拦截（本端保存素材）
  if (/^ML_SAVED_/i.test(String(fileName || ''))) {
    logger?.info?.(\`[stream-upload] ML_SAVED_ 文件名拦截 name=\${fileName}\`);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    const err = new Error('本端导出件（文件名包含 ML_SAVED_），拒绝重复入库');
    err.code = 'export_saved_name';
    throw err;
  }

  // 0d. 检查 export_registry、预览图/缩略图以及全部衍生图绝对哈希
  try {
    const regHit = db.prepare('SELECT source_fid, variant FROM export_registry WHERE sha256 = ? OR (md5 IS NOT NULL AND md5 = ?) LIMIT 1').get(sha256, sha256);
    if (regHit) {
      logger?.info?.(\`[stream-upload] export_registry 绝对查重拦截 sha=\${sha256.slice(0, 12)} fid=\${regHit.source_fid}\`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      return { fid: regHit.source_fid, deduped: true, reason: 'export_registry', sha256, matchedKind: regHit.variant };
    }

    const derivHit = db.prepare('SELECT asset_fid, kind FROM derivatives WHERE sha256 = ? OR (md5 IS NOT NULL AND md5 = ?) LIMIT 1').get(sha256, sha256);
    if (derivHit) {
      logger?.info?.(\`[stream-upload] 衍生图绝对查重拦截 sha=\${sha256.slice(0, 12)} fid=\${derivHit.asset_fid}\`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      return { fid: derivHit.asset_fid, deduped: true, reason: 'duplicate_of_derivative', sha256, matchedKind: derivHit.kind };
    }

    const visHit = db.prepare('SELECT fid FROM assets WHERE preview_sha256 = ? OR preview_md5 = ? OR thumb_sha256 = ? OR thumb_md5 = ? LIMIT 1').get(sha256, sha256, sha256, sha256);
    if (visHit) {
      logger?.info?.(\`[stream-upload] 可见缓存图绝对查重拦截 sha=\${sha256.slice(0, 12)} fid=\${visHit.fid}\`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      return { fid: visHit.fid, deduped: true, reason: 'visible_cache_duplicate', sha256 };
    }
  } catch (_) {}

  // 1. 去重检查：若同 sha256 已存在，直接返回`;

  suContent = suContent.replace(suGateTarget, suGateAddition);
  console.log('[PASS] src/stream-upload.js 8-defense gateway applied');
}

// 2c. 确保 findFingerprintHit 使用 exactOnly: true，彻底摘除 pHash <= 8 自动删盘
const suFpHitCall = `      const fpHit = fpApi.findFingerprintHit(
        db,
        { md5: streamFp.md5, sha256: streamFp.sha256, phash: streamFp.phash },
        {}
      );`;
const suFpHitCallReplacement = `      const fpHit = fpApi.findFingerprintHit(
        db,
        { md5: streamFp.md5, sha256: streamFp.sha256, phash: streamFp.phash },
        { exactOnly: true }
      );`;
if (suContent.includes(suFpHitCall)) {
  suContent = suContent.replace(suFpHitCall, suFpHitCallReplacement);
  console.log('[PASS] src/stream-upload.js exactOnly: true applied (no pHash <= 8 deletion)');
}

fs.writeFileSync(streamUploadFile, suContent, 'utf8');

// 3. patch src/ingest.js
const ingestFile = path.resolve(__dirname, '../src/ingest.js');
let ingestContent = fs.readFileSync(ingestFile, 'utf8');
const ingestFpTarget = `    const fpHit = fpApi.findFingerprintHit(
      db,
      { md5: ingestFp.md5, sha256: ingestFp.sha256, phash: ingestFp.phash },
      {}
    );`;
const ingestFpReplacement = `    const fpHit = fpApi.findFingerprintHit(
      db,
      { md5: ingestFp.md5, sha256: ingestFp.sha256, phash: ingestFp.phash },
      { exactOnly: true }
    );`;
if (ingestContent.includes(ingestFpTarget)) {
  ingestContent = ingestContent.replace(ingestFpTarget, ingestFpReplacement);
  fs.writeFileSync(ingestFile, ingestContent, 'utf8');
  console.log('[PASS] src/ingest.js exactOnly: true applied');
} else {
  console.log('[INFO] src/ingest.js target not found or already patched');
}

// 4. patch src/nodes/index.js (executeRestageDual deferred restage)
const nodesIndexFile = path.resolve(__dirname, '../src/nodes/index.js');
let nodesContent = fs.readFileSync(nodesIndexFile, 'utf8');

const restageTarget = `  // 1. CONFLICT-002：重复组退役——原「组员切片跳过生图、共享代表图成果」逻辑已移除，
  //    每个素材独立判断是否需要画幅重构（P2 去重工作台将另行提供批量去重生图）。

  // 2. 检查适配器 —— 构造「主通道 + 降级通道」候选链`;

const restageReplacement = `  // ── 决策 3（方案 A）：若与近 7 天同品类有效素材存在 1 <= pHash <= 6 的高相似连拍图，暂缓双画幅重构 ──
  const forceRestage = Boolean(nodeConfig?.forceRestage || runCtx?.forceRestage);
  if (!forceRestage && asset.phash && asset.phash.length >= 16) {
    const { hammingDistanceHex } = require('../dedupe');
    const { isVideoExtractStill } = require('../cluster');
    if (!isVideoExtractStill(asset)) {
      const currentCategory = asset.category || runCtx?.lastOutput?.category || 'interior';
      const sevenDaysAgo = (asset.created_at || Date.now()) - 7 * 86400 * 1000;
      const peers = db.prepare(\`
        SELECT fid, phash, file_name, source, created_at
        FROM assets
        WHERE fid != ?
          AND kind = 'image'
          AND category = ?
          AND status IN ('ready', 'ready_with_flags', 'processing', 'pending', 'tagged')
          AND COALESCE(auth_state, 'live') IN ('live', 'authorized')
          AND phash IS NOT NULL AND phash != ''
          AND created_at >= ?
        ORDER BY created_at ASC
        LIMIT 300
      \`).all(asset.fid, currentCategory, sevenDaysAgo);

      let ignoredSet = new Set();
      try {
        const rows = db.prepare(\`
          SELECT fid_a, fid_b FROM similarity_ignored_pairs WHERE fid_a = ? OR fid_b = ?
        \`).all(asset.fid, asset.fid);
        ignoredSet = new Set(rows.map((r) => (r.fid_a === asset.fid ? r.fid_b : r.fid_a)));
      } catch (_) {}

      let hitPeerFid = null;
      let hitDist = 99;
      for (const p of peers) {
        if (ignoredSet.has(p.fid)) continue;
        if (isVideoExtractStill(p)) continue;
        const d = hammingDistanceHex(asset.phash, p.phash);
        if (d >= 1 && d <= 6) {
          hitPeerFid = p.fid;
          hitDist = d;
          break;
        }
      }
      if (hitPeerFid) {
        logger?.info?.(\`[restage_dual] 疑似连拍暂缓生图 fid=\${asset.fid} 与 \${hitPeerFid} 距离=\${hitDist}\`);
        return {
          status: 'skipped',
          skipped: true,
          output: {
            restaged: false,
            skipped: true,
            reason: 'deferred_restage_similar',
            similarToFid: hitPeerFid,
            phashDistance: hitDist,
          },
          flags: ['deferred_restage_similar'],
        };
      }
    }
  }

  // 1. CONFLICT-002：重复组退役——原「组员切片跳过生图、共享代表图成果」逻辑已移除，
  //    每个素材独立判断是否需要画幅重构（P2 去重工作台将另行提供批量去重生图）。

  // 2. 检查适配器 —— 构造「主通道 + 降级通道」候选链`;

if (nodesContent.includes(restageTarget)) {
  nodesContent = nodesContent.replace(restageTarget, restageReplacement);
  fs.writeFileSync(nodesIndexFile, nodesContent, 'utf8');
  console.log('[PASS] src/nodes/index.js deferred restage applied');
} else {
  console.log('[INFO] src/nodes/index.js target not found or already patched');
}
