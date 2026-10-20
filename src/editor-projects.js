/**
 * 剪辑工程与导出。
 * 工程存在 editor_projects。片段媒体字段是素材库 fid，不另建素材表，不预置演示片。
 * 导出由页面交帧，本机 ffmpeg 混成 mp4，再写入成品架。不走 registerGenerated。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const FFMPEG = process.env.FFMPEG_PATH || '/home/lrp/.local/bin/ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || '/home/lrp/.local/bin/ffprobe';

function bin(name, fallback) {
  return fs.existsSync(fallback) ? fallback : name;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function run(cmd, args, timeout = 120000) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, timeout);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ code: 127, stdout, stderr: err.message });
    });
  });
}

function safeName(name) {
  const raw = String(name == null ? '' : name).trim();
  // `.` / `..` 会让 path.join 逃出目标目录，进而被 rmSync 递归删除。
  if (!raw || /^\.+$/.test(raw)) return 'clip';
  return raw
    .replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]+/g, '_')
    .replace(/^\.+/, '_')
    .slice(0, 80) || 'clip';
}

function assertSessionId(value) {
  const id = String(value || '');
  // start 生成的是 exp_<base36>_<hex>；这里只放行单段安全字符，彻底杜绝路径穿越。
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) {
    throw Object.assign(new Error('导出会话标识不合法'), { status: 400 });
  }
  return id;
}

function assertInside(root, target) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('导出会话路径越界'), { status: 400 });
  }
  return target;
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function ensureTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS editor_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      data TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      rev INTEGER NOT NULL DEFAULT 1
    );
  `);
  // 旧库没有 rev 列：多端后写覆盖先写无法察觉。这里补列并回填 1。
  const cols = db.prepare('PRAGMA table_info(editor_projects)').all();
  if (!cols.some((c) => c.name === 'rev')) {
    db.exec('ALTER TABLE editor_projects ADD COLUMN rev INTEGER NOT NULL DEFAULT 1');
  }
}

function dirs(config) {
  const root = path.join(config.dataDir, 'editor-export');
  const sessions = path.join(root, '.sessions');
  fs.mkdirSync(sessions, { recursive: true });
  return { root, sessions };
}

/** 浏览器崩溃/关标签页不会发 abort，超过 6 小时的会话目录视为垃圾。 */
function sweepSessions(sessions) {
  const cutoff = Date.now() - 6 * 3600 * 1000;
  let names = [];
  try { names = fs.readdirSync(sessions); } catch { return; }
  for (const name of names) {
    const dir = path.join(sessions, name);
    try {
      const st = fs.statSync(dir);
      if (st.isDirectory() && st.mtimeMs < cutoff) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch { /* 单个目录清理失败不影响导出 */ }
  }
}

function projectSummary(row) {
  let data = {};
  try { data = JSON.parse(row.data); } catch { data = {}; }
  const scenes = Array.isArray(data.scenes) ? data.scenes : [];
  let duration = 0;
  for (const scene of scenes) {
    for (const track of scene.tracks || []) {
      for (const el of track.elements || []) {
        duration = Math.max(duration, (Number(el.start) || 0) + (Number(el.duration) || 0));
      }
    }
  }
  return {
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    updated_at: row.updated_at,
    rev: Number(row.rev) || 1,
    canvas: data.canvas || null,
    fps: Number(data.fps) || 30,
    duration: Number(duration.toFixed(3)),
    sceneCount: scenes.length,
    schemaVersion: data.schemaVersion || data.version || 1,
  };
}

function listProjects(db) {
  // 列表页要显示画布、帧率、时长与场景数；只 SELECT 元数据会让卡片全部显示占位符。
  const rows = db.prepare('SELECT id, name, data, created_at, updated_at, rev FROM editor_projects ORDER BY updated_at DESC').all();
  return rows.map(projectSummary);
}

function getProject(db, id) {
  const row = db.prepare('SELECT id, name, data, created_at, updated_at, rev FROM editor_projects WHERE id=?').get(id);
  if (!row) return null;
  let data;
  try {
    data = JSON.parse(row.data);
  } catch {
    // 返回空对象会让前端自动保存后把损坏原文彻底覆盖；这里宁可拒绝打开。
    throw Object.assign(new Error('工程数据损坏，已阻止打开以免覆盖原始数据'), { status: 500 });
  }
  return {
    id: row.id, name: row.name, data, rev: Number(row.rev) || 1,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

function saveProject(db, id, name, data, expectedRev) {
  const now = Date.now();
  // rev 只存列里。若同时写进 JSON，下次被别人读到会当成基线版本，造成假冲突。
  const clean = { ...data };
  delete clean.rev;
  const payload = JSON.stringify(clean);
  if (expectedRev == null) {
    // 新建：无历史版本。
    db.prepare(`
      INSERT INTO editor_projects (id, name, data, created_at, updated_at, rev)
      VALUES (?, ?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        name=excluded.name, data=excluded.data, updated_at=excluded.updated_at, rev=editor_projects.rev+1
    `).run(id, name, payload, now, now);
    return Number(db.prepare('SELECT rev FROM editor_projects WHERE id=?').get(id)?.rev) || 1;
  }
  // 比较并交换：只有客户端持有的 rev 仍是库里最新值时才写。
  // 否则多标签页/双端会静默后写覆盖先写，且没人知道内容丢过。
  const r = db.prepare(`
    UPDATE editor_projects SET name=?, data=?, updated_at=?, rev=rev+1
    WHERE id=? AND rev=?
  `).run(name, payload, now, id, Number(expectedRev));
  if (!r.changes) {
    const cur = db.prepare('SELECT rev FROM editor_projects WHERE id=?').get(id);
    if (!cur) throw Object.assign(new Error('工程不存在'), { status: 404 });
    throw Object.assign(new Error('工程已在其它窗口被修改，请刷新后再改'), {
      status: 409,
      conflict: true,
      rev: Number(cur.rev) || 1,
    });
  }
  return Number(expectedRev) + 1;
}

function blankProject(id, name, body) {
  const now = Date.now();
  return {
    version: 1,
    id,
    name,
    createdAt: now,
    updatedAt: now,
    canvas: body.canvas || { width: 1280, height: 720, background: '#0b1020' },
    fps: Number(body.fps) || 30,
    pixelsPerSecond: Number(body.pixelsPerSecond) || 100,
    playhead: 0,
    activeSceneId: 'scene-main',
    media: [],
    scenes: [{
      id: 'scene-main', name: '主场景', isMain: true, bookmarks: [],
      tracks: [
        { id: 'track-main', type: 'video', name: 'V1 主视频', isMain: true, muted: false, hidden: false, locked: false, elements: [] },
        { id: 'track-audio', type: 'audio', name: 'A1 音频', isMain: false, muted: false, hidden: false, locked: false, elements: [] },
      ],
    }],
  };
}

async function resolveAssetFile(services, fid) {
  const { db } = services;
  const { resolveDerivativeFile } = require('./derivatives');
  const deriv = db.prepare(`
    SELECT * FROM derivatives
    WHERE asset_fid=?
    ORDER BY CASE kind WHEN 'origin' THEN 0 WHEN 'clean' THEN 1 ELSE 2 END, id DESC
    LIMIT 1
  `).get(fid);
  if (!deriv) return null;
  const file = await resolveDerivativeFile(services, deriv);
  if (!file || !fs.existsSync(file)) return null;
  return file;
}

async function probeFile(file) {
  const r = await run(bin('ffprobe', FFPROBE), [
    '-v', 'error', '-show_entries', 'format=duration',
    '-show_streams', '-of', 'json', file,
  ], 20000);
  if (r.code !== 0) return { duration: 0, width: 0, height: 0, hasAudio: false };
  let json = {};
  try { json = JSON.parse(r.stdout || '{}'); } catch { json = {}; }
  const streams = json.streams || [];
  const video = streams.find((s) => s.codec_type === 'video');
  const audio = streams.find((s) => s.codec_type === 'audio');
  return {
    duration: Number(json.format?.duration) || 0,
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    hasAudio: Boolean(audio),
  };
}

async function listLibraryMedia(services) {
  const rows = services.db.prepare(`
    SELECT fid, file_name, kind, width, height
    FROM assets
    WHERE status='ready' AND kind IN ('video', 'image', 'audio')
    ORDER BY created_at DESC
    LIMIT 40
  `).all();
  const items = [];
  for (const row of rows) {
    const file = await resolveAssetFile(services, row.fid);
    const type = row.kind === 'audio' ? 'audio' : row.kind === 'video' ? 'video' : 'image';
    let duration = type === 'image' ? 5 : 0;
    let hasAudio = type === 'audio';
    let width = row.width || 0;
    let height = row.height || 0;
    if (file && type !== 'image') {
      const probe = await probeFile(file);
      duration = probe.duration || 0;
      hasAudio = type === 'audio' ? true : probe.hasAudio;
      width = width || probe.width;
      height = height || probe.height;
    }
    if (!file) {
      items.push({
        id: row.fid,
        fid: row.fid,
        name: row.file_name || row.fid,
        type,
        duration: 0,
        width, height,
        hasAudio: false,
        missing: true,
        url: '',
        audioUrl: '',
      });
      continue;
    }
    const url = `/api/viewer/assets/${encodeURIComponent(row.fid)}/file`;
    items.push({
      id: row.fid,
      fid: row.fid,
      name: row.file_name || row.fid,
      type,
      duration,
      width, height,
      hasAudio,
      missing: false,
      url,
      audioUrl: hasAudio ? url : '',
    });
  }
  return items;
}

function roleFor(track, clip) {
  if (clip.type === 'audio' || track.type === 'audio') return '音频';
  if (clip.type === 'image') return '图片';
  if (track.type === 'video' && track.isMain) return '主视频';
  if (track.type === 'video') return '叠加';
  return '';
}

function collectEditUses(project) {
  const uses = [];
  const scenes = project?.scenes || [];
  for (const scene of scenes) {
    for (const track of scene.tracks || []) {
      for (const clip of track.elements || []) {
        const fid = String(clip.mediaId || '').trim();
        const role = roleFor(track, clip);
        if (!fid || !role) continue;
        uses.push({
          fid,
          role,
          start: Number(clip.start) || 0,
          duration: Number(clip.duration) || 0,
          projectId: project.id || '',
        });
      }
    }
  }
  return uses;
}

async function ensureWav(services, fid, cacheDir) {
  const file = await resolveAssetFile(services, fid);
  if (!file) return null;
  const probe = await probeFile(file);
  if (!probe.hasAudio && !/\.(mp3|wav|m4a|aac)$/i.test(file)) return null;
  const dest = path.join(cacheDir, `${safeName(fid)}.wav`);
  if (fs.existsSync(dest)) return dest;
  fs.mkdirSync(cacheDir, { recursive: true });
  const r = await run(bin('ffmpeg', FFMPEG), [
    '-y', '-v', 'error', '-i', file, '-vn', '-ac', '2', '-ar', '48000', '-c:a', 'pcm_s16le', dest,
  ], 90000);
  if (r.code !== 0 || !fs.existsSync(dest)) return null;
  return dest;
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function atempoChain(speed) {
  let s = clamp(Number(speed) || 1, 0.25, 4);
  const parts = [];
  while (s > 2) { parts.push('atempo=2'); s /= 2; }
  while (s < 0.5) { parts.push('atempo=0.5'); s /= 0.5; }
  parts.push(`atempo=${s.toFixed(6)}`);
  return parts;
}

async function assembleExport(services, body) {
  const { sessionId, projectId, fps, format, duration, audioClips = [], frameCount, width, height } = body;
  if (!sessionId || !projectId) throw Object.assign(new Error('缺少导出会话'), { status: 400 });
  if (String(format || 'mp4').toLowerCase() !== 'mp4') {
    // UI 已隐藏 WebM；后端也拒绝，避免"选了 WebM 却拿到 MP4"的静默契约违背。
    throw Object.assign(new Error('当前导出通道仅支持 MP4'), { status: 400 });
  }
  const { sessions, root } = dirs(services.config);
  const sessionKey = assertSessionId(sessionId);
  const sessionDir = assertInside(sessions, path.join(sessions, sessionKey));
  const frameDir = path.join(sessionDir, 'frames');
  const frames = fs.existsSync(frameDir) ? fs.readdirSync(frameDir).filter((f) => /^frame-\d{6}\.jpg$/.test(f)) : [];
  if (frames.length < 1) throw new Error('没有收到任何帧');
  const expected = Math.max(1, Number(frameCount) || frames.length);
  if (frames.length < expected) throw new Error(`帧数不足：收到 ${frames.length}/${expected}`);

  const total = Math.max(0.1, Number(duration) || 0);
  const fpsN = Number(fps) || 24;
  const outExt = 'mp4';
  const proj = getProject(services.db, projectId);
  const baseName = safeName(proj ? proj.name : projectId);
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  // 同一工程同秒并发导出会写到同一路径，加短随机码避免互相覆盖。
  const outName = `${baseName}-${stamp}-${crypto.randomBytes(2).toString('hex')}.${outExt}`;
  const outPath = path.join(root, outName);
  const args = ['-y', '-v', 'error', '-framerate', String(fpsN), '-start_number', '0', '-i', path.join(frameDir, 'frame-%06d.jpg')];
  const filterParts = [];
  const labels = [];
  const audioInputs = [];
  let inputIndex = 1;
  const wavDir = path.join(root, 'audio-cache');
  for (const clip of audioClips) {
    if (!clip || !clip.mediaId) continue;
    const wav = await ensureWav(services, clip.mediaId, wavDir);
    if (!wav) continue;
    const sourceSpan = Math.max(0.05, (Number(clip.duration) || 0) * (Number(clip.speed) || 1));
    args.push('-ss', String(Math.max(0, Number(clip.trimStart) || 0)), '-t', String(sourceSpan), '-i', wav);
    audioInputs.push({ clip, idx: inputIndex });
    inputIndex += 1;
  }
  if (audioInputs.length) {
    audioInputs.forEach(({ clip, idx }, i) => {
      const speed = clamp(Number(clip.speed) || 1, 0.25, 4);
      const chain = ['aresample=48000', 'aformat=sample_fmts=fltp:channel_layouts=stereo'];
      if (Math.abs(speed - 1) > 1e-4) {
        if (clip.maintainPitch === false) chain.push(`asetrate=${Math.round(48000 * speed)}`, 'aresample=48000');
        else chain.push(...atempoChain(speed));
      }
      const volume = clamp(Number(clip.volume == null ? 100 : clip.volume) / 100, 0, 4);
      chain.push(`volume=${volume.toFixed(4)}`);
      const clipDur = Math.max(0.05, Number(clip.duration) || 0);
      const fadeIn = clamp(Number(clip.fadeIn) || 0, 0, clipDur);
      const fadeOut = clamp(Number(clip.fadeOut) || 0, 0, clipDur);
      if (fadeIn > 0.01) chain.push(`afade=t=in:st=0:d=${fadeIn.toFixed(3)}`);
      if (fadeOut > 0.01) chain.push(`afade=t=out:st=${Math.max(0, clipDur - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`);
      const delayMs = Math.max(0, Math.round((Number(clip.start) || 0) * 1000));
      if (delayMs > 0) chain.push(`adelay=${delayMs}|${delayMs}`);
      filterParts.push(`[${idx}:a]${chain.join(',')}[a${i}]`);
      labels.push(`[a${i}]`);
    });
    filterParts.push(`${labels.join('')}amix=inputs=${labels.length}:duration=longest:normalize=0,apad=whole_dur=${total.toFixed(3)},atrim=0:${total.toFixed(3)}[aout]`);
  }
  args.push('-r', String(fpsN));
  if (labels.length) args.push('-filter_complex', filterParts.join(';'), '-map', '0:v:0', '-map', '[aout]');
  else args.push('-an');
  args.push('-t', total.toFixed(3), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p');
  if (labels.length) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-movflags', '+faststart', outPath);
  const r = await run(bin('ffmpeg', FFMPEG), args, 10 * 60 * 1000);
  if (r.code !== 0 || !fs.existsSync(outPath)) {
    throw new Error(`ffmpeg 导出失败: ${(r.stderr || '').slice(-800)}`);
  }
  const probe = await probeFile(outPath);
  try { fs.rmSync(sessionDir, { recursive: true, force: true }); } catch { /* ignore */ }
  const filed = await fileFinishedCut(services, {
    filePath: outPath,
    project: proj ? proj.data : null,
    projectId,
    projectName: proj ? proj.name : projectId,
    width: Number(width) || probe.width,
    height: Number(height) || probe.height,
    duration: probe.duration,
  });
  return {
    file: outName,
    url: `/api/viewer/assets/${encodeURIComponent(filed.fid)}/file`,
    fid: filed.fid,
    shelf: 'finished',
    projectId,
    projectName: proj ? proj.name : '',
    format: outExt,
    width: Number(width) || probe.width,
    height: Number(height) || probe.height,
    fps: fpsN,
    duration: probe.duration,
    requestedDuration: total,
    frames: expected,
    audioClips: audioInputs.length,
    editUses: filed.editUses,
    createdAt: Date.now(),
  };
}

async function fileFinishedCut(services, { filePath, project, projectId, projectName, width, height, duration }) {
  const { db, config } = services;
  const { createDerivative, setMainDerivative } = require('./derivatives');
  const { ensureColumns } = require('./shelf-lineage');
  ensureColumns(db);
  const buf = fs.readFileSync(filePath);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const editUses = collectEditUses(project || { id: projectId });
  const now = Date.now();
  const record = {
    parentFid: '',
    refFids: [],
    prompt: '',
    negative: '',
    model: '',
    mode: '',
    ratio: '',
    at: now,
    sessionId: '',
    projectId,
    editUses,
  };
  const existing = db.prepare('SELECT fid FROM assets WHERE sha256=?').get(sha);
  if (existing) {
    db.prepare(`
      UPDATE assets
      SET library_shelf='finished', kind='video', category='video', source='edit', is_ai=0,
          lineage_json=?, updated_at=?
      WHERE fid=?
    `).run(JSON.stringify(record), now, existing.fid);
    return { fid: existing.fid, deduped: true, editUses };
  }
  const fid = `edit_${sha.slice(0, 24)}`;
  const fileName = `${safeName(projectName || '剪辑成片')}.mp4`;
  db.prepare(`
    INSERT INTO assets (
      fid, kind, category, file_name, size, width, height, orientation,
      status, is_ai, source, source_asset_id, parent_fid,
      sha256, library_shelf, lineage_json, created_at, discovered_at, updated_at
    ) VALUES (?, 'video', 'video', ?, ?, ?, ?, ?, 'ready', 0, 'edit', NULL, NULL, ?, 'finished', ?, ?, ?, ?)
  `).run(
    fid,
    fileName,
    buf.length,
    width || null,
    height || null,
    width && height ? (height > width * 1.05 ? 'portrait' : (width > height * 1.05 ? 'landscape' : 'square')) : null,
    sha,
    JSON.stringify(record),
    now, now, now
  );
  const deriv = await createDerivative(services, {
    assetFid: fid,
    kind: 'origin',
    srcPath: filePath,
    fileName,
    width: width || null,
    height: height || null,
    mime: 'video/mp4',
    params: { source: 'edit', sha256: sha, projectId, duration },
  });
  setMainDerivative(db, fid, deriv.id);
  try {
    const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`);
    fs.mkdirSync(path.dirname(thumb), { recursive: true });
    await run(bin('ffmpeg', FFMPEG), ['-y', '-v', 'error', '-ss', '0', '-i', filePath, '-frames:v', '1', thumb], 20000);
  } catch { /* 缩略图失败仍保留成片 */ }
  return { fid, deduped: false, editUses };
}

function filmsUsing(db, fid) {
  try {
    return db.prepare(`
      SELECT a.fid, a.file_name, a.created_at
      FROM assets a, json_each(a.lineage_json, '$.editUses') e
      WHERE a.lineage_json IS NOT NULL
        AND json_valid(a.lineage_json)
        AND json_extract(e.value, '$.fid') = ?
        AND a.fid != ?
      ORDER BY a.created_at DESC
    `).all(fid, fid);
  } catch {
    return [];
  }
}

async function handleEditorApi(services, req, res) {
  const { db, config } = services;
  const auth = require('./auth');
  const url = new URL(req.url, 'http://127.0.0.1');
  const token = String(req.headers.authorization || '').startsWith('Bearer ')
    ? String(req.headers.authorization).slice(7).trim()
    : '';
  // SEC-001：已移除免密内部会话，剪辑工程接口一律真实登录。
  const user = auth.verifySession(db, token);
  if (!user) {
    sendJson(res, 401, { error: '需要登录' });
    return true;
  }
  // SEC-007：角色区分——viewer 只读，工程写操作（覆盖/删除/导出）一律 admin。
  if (user.role !== 'admin' && !['GET', 'HEAD'].includes(req.method)) {
    sendJson(res, 403, { error: '剪辑工程的写操作需要管理员账号' });
    return true;
  }
  ensureTables(db);
  const p = url.pathname;
  try {
    if (p === '/editor-api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (p === '/editor-api/projects' && req.method === 'GET') {
      sendJson(res, 200, { items: listProjects(db) });
      return true;
    }
    if (p === '/editor-api/projects' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 2 * 1024 * 1024)).toString('utf8') || '{}');
      const id = makeId('proj');
      const project = blankProject(id, String(body.name || '未命名工程'), body);
      const rev = saveProject(db, id, project.name, project);
      sendJson(res, 200, { project: { id, name: project.name, data: project, rev } });
      return true;
    }
    if (p === '/editor-api/media' && req.method === 'GET') {
      const items = await listLibraryMedia(services);
      sendJson(res, 200, { items });
      return true;
    }
    if (p === '/editor-api/media/upload') {
      sendJson(res, 400, { error: '片段只用素材库里的素材。请从素材池点选。' });
      return true;
    }
    const projectMatch = /^\/editor-api\/projects\/([^/]+)$/.exec(p);
    if (projectMatch) {
      const id = decodeURIComponent(projectMatch[1]);
      if (req.method === 'GET') {
        const project = getProject(db, id);
        if (!project) sendJson(res, 404, { error: '工程不存在' });
        else sendJson(res, 200, { project });
        return true;
      }
      if (req.method === 'PUT' || req.method === 'PATCH') {
        const body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8') || '{}');
        const existing = getProject(db, id);
        if (!existing) { sendJson(res, 404, { error: '工程不存在' }); return true; }
        const data = body.data || body.project || body;
        const name = String(body.name || data.name || existing.name);
        data.id = id;
        data.name = name;
        data.updatedAt = Date.now();
        if (Array.isArray(data.media)) {
          data.media = data.media.map((m) => ({ ...m, url: String(m.url || '').split('?')[0], audioUrl: String(m.audioUrl || '').split('?')[0] }));
        }
        // 客户端可用 If-Match 或 body.rev 携带基线版本；未携带表示旧客户端，按"先到先写"兼容。
        const ifMatch = String(req.headers['if-match'] || '').replace(/^W\//, '').replace(/"/g, '').trim();
        const rawRev = ifMatch || body.rev;
        const expectedRev = rawRev == null || rawRev === '' ? null : Number(rawRev);
        const rev = saveProject(db, id, name, data,
          Number.isFinite(expectedRev) ? expectedRev : null);
        sendJson(res, 200, { ok: true, id, rev, updatedAt: data.updatedAt });
        return true;
      }
      if (req.method === 'DELETE') {
        db.prepare('DELETE FROM editor_projects WHERE id=?').run(id);
        sendJson(res, 200, { ok: true });
        return true;
      }
    }
    if (p === '/editor-api/export/start' && req.method === 'POST') {
      const sessionId = makeId('exp');
      const { sessions } = dirs(config);
      sweepSessions(sessions);
      const frameDir = path.join(sessions, sessionId, 'frames');
      fs.mkdirSync(frameDir, { recursive: true });
      sendJson(res, 200, { sessionId });
      return true;
    }
    if (p === '/editor-api/export/frame' && req.method === 'POST') {
      const sessionId = url.searchParams.get('session') || '';
      const index = Number(url.searchParams.get('index'));
      if (!sessionId || !Number.isFinite(index) || index < 0 || index > 20000) {
        sendJson(res, 400, { error: '缺少会话或帧序号' });
        return true;
      }
      const raw = await readBody(req, 12 * 1024 * 1024);
      if (raw.length < 4 || raw[0] !== 0xFF || raw[1] !== 0xD8 || raw[2] !== 0xFF) {
        sendJson(res, 400, { error: '帧数据不是合法 JPEG' });
        return true;
      }
      const sessionKey = assertSessionId(sessionId);
      const { sessions } = dirs(config);
      const frameDir = assertInside(sessions, path.join(sessions, sessionKey, 'frames'));
      fs.mkdirSync(frameDir, { recursive: true });
      // 异步写，避免大帧同步 IO 阻塞同进程的 30001/30002 接口。
      await fs.promises.writeFile(path.join(frameDir, `frame-${String(index).padStart(6, '0')}.jpg`), raw);
      sendJson(res, 200, { ok: true, index });
      return true;
    }
    if (p === '/editor-api/export/assemble' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8') || '{}');
      try {
        const meta = await assembleExport(services, body);
        sendJson(res, 200, { ok: true, meta });
      } catch (e) {
        // 失败/取消/超时同样要清理帧目录，否则反复失败会写满磁盘。
        try {
          const { sessions } = dirs(config);
          const key = assertSessionId(body.sessionId);
          fs.rmSync(assertInside(sessions, path.join(sessions, key)), { recursive: true, force: true });
        } catch { /* 会话不合法或已清理 */ }
        throw e;
      }
      return true;
    }
    if (p === '/editor-api/export/abort' && req.method === 'POST') {
      const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8') || '{}');
      const { sessions } = dirs(config);
      const key = assertSessionId(body.sessionId);
      fs.rmSync(assertInside(sessions, path.join(sessions, key)), { recursive: true, force: true });
      sendJson(res, 200, { ok: true });
      return true;
    }
    if (p === '/editor-api/export/list' && req.method === 'GET') {
      sendJson(res, 200, { items: [] });
      return true;
    }
    sendJson(res, 404, { error: '未知剪辑接口' });
    return true;
  } catch (e) {
    const status = e.status || 500;
    if (!res.headersSent) {
      sendJson(res, status, {
        error: e.message || String(e),
        ...(e.conflict ? { conflict: true, rev: e.rev } : {}),
      });
    }
    return true;
  }
}

module.exports = { handleEditorApi, filmsUsing, ensureTables };
