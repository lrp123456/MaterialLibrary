/**
 * 空间创作 · 参考视频逆向分析服务 (rea-video 集成)
 * 职责：
 * 1. 逐镜头拆解参考视频运镜、景别、光影与包装结构
 * 2. 独立任务队列（单并发排队执行，不占用主业务生成队列）
 * 3. 产物隔离写入 test 数据目录下的 rea/<fid>，支持单视频一份报告与重新拆解
 * 4. 提取结构化运镜句，为空间创作图生视频与首尾帧生成提供免填词跳转配方
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { resolveDerivativeFile } = require('../derivatives');

function ensureTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS video_analyses (
      fid TEXT PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      error TEXT DEFAULT '',
      progress TEXT DEFAULT '',
      summary_json TEXT DEFAULT '{}',
      created_at INTEGER,
      updated_at INTEGER
    );
  `);
}

function getReaDir(config, fid) {
  return path.join(config.dataDir, 'rea', String(fid));
}

function synthesizeCameraMovement(shot, breakdown = {}) {
  const camera = shot.aspects?.camera?.result || {};
  const cameraMeasured = shot.aspects?.camera?.measured || {};
  const framing = shot.aspects?.framing?.result || {};
  const framingMeasured = shot.aspects?.framing?.measured || {};
  const feat = shot.features || {};

  let moveDesc = '';
  const move = camera.move || cameraMeasured.move;
  const zoom = Number(feat.zoom_per_s) || 0;
  const pan = Number(feat.pan_px_per_s) || 0;
  const panDir = Number(feat.pan_dir_deg) || 0;

  if (Math.abs(zoom) > 0.005) {
    if (zoom > 0) {
      moveDesc = zoom > 0.02 ? '镜头快速向前推进' : '镜头平稳向前推进';
    } else {
      moveDesc = zoom < -0.02 ? '镜头快速向后拉远' : '镜头平稳向后拉远';
    }
  } else if (pan > 8) {
    if (Math.abs(panDir) < 45) {
      moveDesc = '镜头向右平稳横移';
    } else if (Math.abs(panDir) > 135) {
      moveDesc = '镜头向左平稳横移';
    } else if (panDir > 45 && panDir <= 135) {
      moveDesc = '镜头向上缓缓摇起';
    } else if (panDir < -45 && panDir >= -135) {
      moveDesc = '镜头向下缓缓下摇';
    } else {
      moveDesc = '镜头平稳摇移运镜';
    }
  } else if (move) {
    moveDesc = `镜头${move}运镜`;
  } else {
    moveDesc = '固定机位稳定拍摄';
  }

  const size = framing.shot_size || framingMeasured.shot_size || '中景';
  const angle = framing.camera_angle || framingMeasured.camera_angle || '平视角';
  const position = framing.position || framingMeasured.position || '';

  let supportDesc = '';
  const sup = String(camera.support_zh || camera.support || '');
  if (sup.includes('移动机位') || sup.includes('稳定器') || camera.support === 'moving') {
    supportDesc = '稳定器滑轨平滑运镜';
  } else if (sup.includes('手持') || camera.support === 'handheld') {
    supportDesc = '手持微晃真实感';
  } else if (sup.includes('固定') || sup.includes('三脚架') || camera.support === 'fixed') {
    supportDesc = '三脚架固定机位';
  }

  const parts = [
    moveDesc,
    `景别为${size}`,
    angle && angle !== '平视' && angle !== '平视角' ? angle : '平视角',
    position ? `主体${position}` : '',
    supportDesc
  ].filter(Boolean);

  const cameraSentence = parts.join('，') + '。';
  const promptI2V = `${cameraSentence}保持所挂图片里的空间和主体，只改镜头运动。`;

  let tailFraming = size;
  if (zoom > 0.01) {
    if (size === '全景' || size === '远景') tailFraming = '中景';
    else if (size === '中景') tailFraming = '近景';
    else if (size === '近景') tailFraming = '特写';
  } else if (zoom < -0.01) {
    if (size === '特写' || size === '近景') tailFraming = '中景';
    else if (size === '中景') tailFraming = '全景';
  }
  const promptTailFrame = `同一空间与主体在运镜结束时的画面：${tailFraming}，${angle || '平视角'}，构图规范，保持光影质感与空间主体一致。`;
  const promptFirstLastVideo = `从首帧平滑运动过渡至尾帧，${cameraSentence}`;

  return {
    cameraSentence,
    promptI2V,
    promptTailFrame,
    promptFirstLastVideo,
    shotSize: size,
    cameraAngle: angle,
    moveType: move || '移动'
  };
}

class VideoAnalysisService {
  constructor(services) {
    this.services = services;
    this.queue = [];
    this.activeFid = null;
    this.childProc = null;
    ensureTable(services.db);
  }

  getDb() {
    return this.services.db;
  }

  getConfig() {
    return this.services.config;
  }

  getRecord(fid) {
    const db = this.getDb();
    ensureTable(db);
    return db.prepare('SELECT * FROM video_analyses WHERE fid = ?').get(fid);
  }

  async getAnalysis(fid) {
    const db = this.getDb();
    const config = this.getConfig();
    ensureTable(db);
    const row = db.prepare('SELECT * FROM video_analyses WHERE fid = ?').get(fid);
    if (!row) return null;

    let summary = {};
    try {
      summary = row.summary_json ? JSON.parse(row.summary_json) : {};
    } catch (_) {}

    let breakdown = null;
    const finalDir = getReaDir(config, fid);
    const breakdownFile = path.join(finalDir, 'breakdown.json');
    if (row.status === 'success' && fs.existsSync(breakdownFile)) {
      try {
        const raw = fs.readFileSync(breakdownFile, 'utf8');
        breakdown = JSON.parse(raw);
        if (breakdown && Array.isArray(breakdown.shots)) {
          breakdown.shots.forEach((shot) => {
            shot.synthesized = synthesizeCameraMovement(shot, breakdown);
          });
        }
      } catch (e) {
        console.warn(`[video-analysis] 读取 breakdown.json 失败 (${fid}):`, e.message);
      }
    }

    return {
      fid: row.fid,
      status: row.status,
      error: row.error,
      progress: row.progress,
      summary,
      breakdown,
      hasReport: fs.existsSync(path.join(finalDir, 'report.html')),
      hasStoryboard: fs.existsSync(path.join(finalDir, 'storyboard.jpg')),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  async listHistory({ limit = 30, offset = 0, status = '' } = {}) {
    const db = this.getDb();
    ensureTable(db);
    const validLimit = Math.min(Math.max(Number(limit) || 30, 1), 100);
    const validOffset = Math.max(Number(offset) || 0, 0);

    let whereClause = '';
    const params = [];
    if (status && typeof status === 'string' && status !== 'all') {
      whereClause = 'WHERE va.status = ?';
      params.push(status);
    }

    const totalRow = db.prepare(`SELECT COUNT(*) as count FROM video_analyses va ${whereClause}`).get(...params);
    const total = totalRow ? totalRow.count : 0;

    const sql = `
      SELECT
        va.fid,
        va.status,
        va.error,
        va.progress,
        va.summary_json,
        va.created_at,
        va.updated_at,
        a.file_name,
        a.duration_s,
        a.thumb_url,
        a.width,
        a.height
      FROM video_analyses va
      LEFT JOIN assets a ON va.fid = a.fid
      ${whereClause}
      ORDER BY va.updated_at DESC
      LIMIT ? OFFSET ?
    `;

    const rows = db.prepare(sql).all(...params, validLimit, validOffset);
    const items = rows.map((r) => {
      let summary = {};
      try {
        summary = r.summary_json ? JSON.parse(r.summary_json) : {};
      } catch (_) {}
      return {
        fid: r.fid,
        name: r.file_name || r.fid,
        fileName: r.file_name || r.fid,
        status: r.status,
        error: r.error,
        progress: r.progress,
        duration: r.duration_s || summary.duration || null,
        thumbUrl: r.thumb_url || `/api/thumbs/${r.fid}.jpg`,
        shotsCount: summary.shots_count || (Array.isArray(summary.shots) ? summary.shots.length : null),
        productionMix: summary.production_mix || null,
        production: summary.production || null,
        createdAt: r.created_at,
        updatedAt: r.updated_at
      };
    });

    return { total, items, limit: validLimit, offset: validOffset };
  }

  async deleteRecord(fid) {
    if (!fid) return { success: false, error: '缺少 fid' };
    const db = this.getDb();
    const config = this.getConfig();
    ensureTable(db);

    db.prepare('DELETE FROM video_analyses WHERE fid = ?').run(fid);
    const dir = getReaDir(config, fid);
    try {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (_) {}

    return { success: true };
  }

  async queueAnalysis(fid, { reanalyze = false } = {}) {
    const db = this.getDb();
    const config = this.getConfig();
    ensureTable(db);

    const existing = db.prepare('SELECT * FROM video_analyses WHERE fid = ?').get(fid);
    const finalDir = getReaDir(config, fid);
    const hasExistingBreakdown = fs.existsSync(path.join(finalDir, 'breakdown.json'));

    if (!reanalyze && existing && existing.status === 'success' && hasExistingBreakdown) {
      return await this.getAnalysis(fid);
    }

    if (this.activeFid === fid) {
      return { fid, status: 'running', message: '分析任务正在运行中' };
    }
    if (this.queue.includes(fid)) {
      return { fid, status: 'pending', message: '分析任务正在排队中' };
    }

    const now = Date.now();
    if (existing) {
      db.prepare("UPDATE video_analyses SET status='pending', error='', progress='排队中...', updated_at=? WHERE fid=?")
        .run(now, fid);
    } else {
      db.prepare("INSERT INTO video_analyses (fid, status, error, progress, summary_json, created_at, updated_at) VALUES (?, 'pending', '', '排队中...', '{}', ?, ?)")
        .run(fid, now, now);
    }

    this.queue.push(fid);
    void this._processNext();

    return { fid, status: 'pending', message: '已加入拆解队列' };
  }

  async _resolveVideoFile(fid) {
    const db = this.getDb();
    const config = this.getConfig();

    // 1. derivatives 表解析：优先 origin，其次任意可用衍生
    const derivs = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? ORDER BY CASE kind WHEN 'origin' THEN 0 ELSE 1 END").all(fid);
    for (const deriv of derivs) {
      try {
        const p = await resolveDerivativeFile(this.services, deriv);
        if (p && fs.existsSync(p)) {
          console.log(`[video-analysis] resolveDerivativeFile 命中 (${fid}): ${p}`);
          return p;
        }
      } catch (e) {
        // 继续尝试下一个衍生
      }
    }

    // 2. nasstore 分片查找
    try {
      const { findNasOriginal } = require('../nasstore');
      const nasHit = findNasOriginal(config, fid);
      if (nasHit && fs.existsSync(nasHit)) {
        console.log(`[video-analysis] findNasOriginal 命中 (${fid}): ${nasHit}`);
        return nasHit;
      }
    } catch {}

    // 3. assets 表及 ensureOriginalFile
    const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
    if (asset) {
      try {
        const { ensureOriginalFile } = require('../originals');
        const p = await ensureOriginalFile(this.services, asset);
        if (p && fs.existsSync(p)) {
          console.log(`[video-analysis] ensureOriginalFile 命中 (${fid}): ${p}`);
          return p;
        }
      } catch {}

      if (asset.storage_ref) {
        const candidates = [
          path.isAbsolute(asset.storage_ref) ? asset.storage_ref : null,
          path.join(config.dataDir, 'originals', asset.storage_ref),
          path.join(config.dataDir, asset.storage_ref),
          path.join(config.dataDir, 'cache', asset.storage_ref),
          path.join(config.dataDir, 'uploads', asset.storage_ref)
        ].filter(Boolean);
        for (const c of candidates) {
          if (fs.existsSync(c)) {
            console.log(`[video-analysis] asset.storage_ref 命中 (${fid}): ${c}`);
            return c;
          }
        }
      }
    }

    // 4. 深度兜底：按文件名与 hash 在常用素材目录进行扫描匹配
    const fileName = asset?.file_name;
    const candidatesDirs = [
      process.platform === 'win32' ? '//wsl.localhost/smu/mnt/synology/material' : '/mnt/synology/material',
      process.platform === 'win32' ? '//wsl$/smu/mnt/synology/material' : null,
      path.join(config.dataDir, 'nas_material'),
      path.join(config.dataDir, 'cache', 'originals'),
      path.join(config.dataDir, 'originals'),
      path.join(config.dataDir, 'uploads'),
      path.join(config.dataDir, 'cache', 'temp_upload'),
      path.join(config.dataDir, 'cache', 'temp')
    ].filter(Boolean);

    if (fileName) {
      for (const d of candidatesDirs) {
        try {
          if (!fs.existsSync(d)) continue;
          const direct = path.join(d, fileName);
          if (fs.existsSync(direct)) return direct;
        } catch (_) {}
      }
    }

    // 5. 扫描年月目录兜底
    if (fileName && process.platform === 'win32') {
      try {
        const baseUnc = '//wsl.localhost/smu/mnt/synology/material';
        if (fs.existsSync(baseUnc)) {
          const years = fs.readdirSync(baseUnc);
          for (const y of years) {
            const yPath = path.join(baseUnc, y);
            if (!fs.statSync(yPath).isDirectory()) continue;
            const months = fs.readdirSync(yPath);
            for (const m of months) {
              const mPath = path.join(yPath, m);
              if (!fs.statSync(mPath).isDirectory()) continue;
              const target = path.join(mPath, fileName);
              if (fs.existsSync(target)) {
                console.log(`[video-analysis] 年月目录扫描命中 (${fid}): ${target}`);
                return target;
              }
            }
          }
        }
      } catch (_) {}
    }

    return null;
  }

  async _processNext() {
    if (this.activeFid || this.queue.length === 0) return;

    const fid = this.queue.shift();
    this.activeFid = fid;
    const db = this.getDb();
    const config = this.getConfig();

    db.prepare("UPDATE video_analyses SET status='running', progress='正在准备视频素材...', updated_at=? WHERE fid=?")
      .run(Date.now(), fid);

    let videoPath = null;
    try {
      videoPath = await this._resolveVideoFile(fid);
    } catch (e) {
      console.warn(`[video-analysis] 解析视频路径异常: ${e.message}`);
    }

    if (!videoPath || !fs.existsSync(videoPath)) {
      const errMsg = '未找到视频原始素材文件，可能尚未下载完成';
      db.prepare("UPDATE video_analyses SET status='error', error=?, progress='', updated_at=? WHERE fid=?")
        .run(errMsg, Date.now(), fid);
      this.activeFid = null;
      void this._processNext();
      return;
    }

    const finalDir = getReaDir(config, fid);
    const tmpDir = path.join(config.dataDir, 'rea', `${fid}_tmp_${Date.now()}`);
    fs.mkdirSync(path.dirname(tmpDir), { recursive: true });

    const env = { ...process.env };
    if (!env.REA_VLM_BASE_URL) {
      env.REA_VLM_BASE_URL = process.env.NEWAPI_BASE_URL || 'https://newapi.naite.cc/v1';
    }
    if (!env.REA_VLM_API_KEY && process.env.NEWAPI_API_KEY) {
      env.REA_VLM_API_KEY = process.env.NEWAPI_API_KEY;
    }
    if (!env.REA_VLM_MODEL) {
      env.REA_VLM_MODEL = 'gemini-4-argon,gemini-2.5-flash,gpt-4o-mini';
    }
    if (!env.REA_VLM_MEDIA) {
      env.REA_VLM_MEDIA = 'frames';
    }

    const args = ['decompose', videoPath, '-o', tmpDir, '--vlm', '--lang', 'zh'];
    console.log(`[video-analysis] 开始执行拆解: rea-video ${args.join(' ')}`);

    const updateProgress = (text) => {
      try {
        db.prepare('UPDATE video_analyses SET progress=?, updated_at=? WHERE fid=?')
          .run(text, Date.now(), fid);
      } catch (_) {}
    };

    let logTail = '';
    const child = spawn('rea-video', args, { env, shell: true });
    this.childProc = child;

    const handleOutput = (chunk) => {
      const str = chunk.toString();
      logTail = (logTail + str).slice(-2000);
      if (str.includes('detected')) {
        updateProgress('已检测到镜头分段，正在提取各镜画面...');
      } else if (str.includes('separating stems') || str.includes('UVR-MDX')) {
        updateProgress('正在提取并分离音频轨（人声与背景乐）...');
      } else if (str.includes('packaging layer')) {
        updateProgress('正在分析字幕、花字与包装贴纸...');
      } else if (str.includes('shot_')) {
        updateProgress('正在逐镜分析运镜运动与光影特征...');
      } else if (str.includes('VLM')) {
        updateProgress('正在调用视觉模型进行多模态研判...');
      }
    };

    child.stdout.on('data', handleOutput);
    child.stderr.on('data', handleOutput);

    child.on('close', (code) => {
      this.childProc = null;
      this.activeFid = null;

      const breakdownPath = path.join(tmpDir, 'breakdown.json');
      const hasBreakdown = fs.existsSync(breakdownPath);

      if (code === 0 && hasBreakdown) {
        try {
          if (fs.existsSync(finalDir)) {
            fs.rmSync(finalDir, { recursive: true, force: true });
          }
          fs.renameSync(tmpDir, finalDir);

          let summary = {};
          try {
            const raw = fs.readFileSync(path.join(finalDir, 'breakdown.json'), 'utf8');
            const bd = JSON.parse(raw);
            summary = bd.summary || {};
          } catch (_) {}

          db.prepare("UPDATE video_analyses SET status='success', error='', progress='拆解完成', summary_json=?, updated_at=? WHERE fid=?")
            .run(JSON.stringify(summary), Date.now(), fid);
          console.log(`[video-analysis] 拆解成功: fid=${fid}`);
        } catch (err) {
          console.error(`[video-analysis] 产物保存失败: ${err.message}`);
          db.prepare("UPDATE video_analyses SET status='error', error=?, progress='', updated_at=? WHERE fid=?")
            .run(`产物整理失败: ${err.message}`, Date.now(), fid);
        }
      } else {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
        const prevValid = fs.existsSync(path.join(finalDir, 'breakdown.json'));
        if (prevValid) {
          console.warn(`[video-analysis] 本次重新拆解未成功 (code=${code})，保留上一份有效报告`);
          db.prepare("UPDATE video_analyses SET status='success', error='重新拆解未成功，已保留上一份报告', progress='', updated_at=? WHERE fid=?")
            .run(Date.now(), fid);
        } else {
          const errDetail = logTail.split('\n').filter(Boolean).slice(-3).join(' ') || `进程退出码 ${code}`;
          console.error(`[video-analysis] 拆解失败: fid=${fid}, err=${errDetail}`);
          db.prepare("UPDATE video_analyses SET status='error', error=?, progress='', updated_at=? WHERE fid=?")
            .run(`拆解失败: ${errDetail}`, Date.now(), fid);
        }
      }

      void this._processNext();
    });

    child.on('error', (err) => {
      console.error(`[video-analysis] 启动子进程失败: ${err.message}`);
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
      this.childProc = null;
      this.activeFid = null;
      db.prepare("UPDATE video_analyses SET status='error', error=?, progress='', updated_at=? WHERE fid=?")
        .run(`启动拆解程序失败: ${err.message}`, Date.now(), fid);
      void this._processNext();
    });
  }

  serveAsset(fid, relPath, res) {
    const config = this.getConfig();
    const finalDir = path.resolve(getReaDir(config, fid));
    const targetFile = path.resolve(finalDir, relPath);

    if (!targetFile.startsWith(finalDir)) {
      res.writeHead(403);
      res.end('Forbidden');
      return;
    }
    if (!fs.existsSync(targetFile)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    const ext = path.extname(targetFile).toLowerCase();
    const mimeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
      '.mp4': 'video/mp4',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.html': 'text/html; charset=utf-8',
      '.json': 'application/json; charset=utf-8'
    };
    const mime = mimeMap[ext] || 'application/octet-stream';
    const stat = fs.statSync(targetFile);

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=3600'
    });
    fs.createReadStream(targetFile).pipe(res);
  }
}

let _instance = null;
function getVideoAnalysisService(services) {
  if (!_instance && services) {
    _instance = new VideoAnalysisService(services);
  }
  return _instance;
}

module.exports = {
  getVideoAnalysisService,
  VideoAnalysisService,
  synthesizeCameraMovement,
  getReaDir
};
