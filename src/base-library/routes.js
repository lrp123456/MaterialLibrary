/**
 * 基础属性库 HTTP 路由处理模块 (/api/base-library/*)
 */

const fs = require('fs');
const path = require('path');
const { getTaxonomy, isValidSurface, isValidSubclass, VALID_SUBCLASS_KEYS } = require('./taxonomy');
const {
  getFlag,
  setFlag,
  getAllFlags,
  listMaterials,
  listPaints,
  listLights,
  listPresetSlots
} = require('./list');
const { ensurePaintSwatchFile } = require('./swatch');
const { searchPolyHaven, resolvePolyHavenDownloadUrl } = require('./sources/polyhaven');
const { searchAmbientCG, extractFileFromZip, ALLOWED_CATEGORIES } = require('./sources/ambientcg');
const { createMaterialDraft, confirmMaterialDraft } = require('./drafts');
const { cleanupDeadMirrorRuns, upsertPaintDbPage } = require('./sources/paintdb');

async function handleBaseLibraryRoutes(services, req, res, pathname, urlObj, { sessionUser, isAdmin, isViewerOrAdmin, parseBody, sendJson }) {
  const db = services.db;
  const dataDir = services.config?.dataDir || process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library');

  // 1. 分类法 GET /api/base-library/taxonomy
  if (pathname === '/base-library/taxonomy' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    return sendJson(res, 200, { success: true, data: getTaxonomy() });
  }

  // 2. 材质列表 GET /api/base-library/materials
  if (pathname === '/base-library/materials' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const surface = urlObj.searchParams.get('surface');
    const subclass = urlObj.searchParams.get('subclass');
    const source = urlObj.searchParams.get('source');
    const is_shell = urlObj.searchParams.get('is_shell');
    const q = urlObj.searchParams.get('q');
    const limit = urlObj.searchParams.get('limit');
    const offset = urlObj.searchParams.get('offset');

    const data = listMaterials(db, { surface, subclass, source, is_shell, q, limit, offset });
    return sendJson(res, 200, { success: true, data });
  }

  // 3. 材质底色大图 GET /api/base-library/materials/:id/basecolor
  const mMatBasecolor = pathname.match(/^\/base-library\/materials\/([^\/]+)\/basecolor$/);
  if (mMatBasecolor && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const matId = decodeURIComponent(mMatBasecolor[1]);
    const row = db.prepare('SELECT * FROM ba_materials WHERE id=? AND deleted_at IS NULL').get(matId);
    if (!row) return sendJson(res, 404, { error: '材质不存在' });

    const fullPath = path.resolve(dataDir, row.basecolor_rel);
    if (!fs.existsSync(fullPath)) return sendJson(res, 404, { error: '贴图文件不存在' });

    const stat = fs.statSync(fullPath);
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400'
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(fullPath).pipe(res);
  }

  // 3.1 材质 3D 材质球预览图 GET /api/base-library/materials/:id/preview
  const mMatPreview = pathname.match(/^\/base-library\/materials\/([^\/]+)\/preview$/);
  if (mMatPreview && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const matId = decodeURIComponent(mMatPreview[1]);
    const row = db.prepare('SELECT * FROM ba_materials WHERE id=? AND deleted_at IS NULL').get(matId);
    if (!row) return sendJson(res, 404, { error: '材质不存在' });

    const relPath = row.preview_rel || row.basecolor_rel;
    const fullPath = path.resolve(dataDir, relPath);
    if (!fs.existsSync(fullPath)) return sendJson(res, 404, { error: '预览图文件不存在' });

    const stat = fs.statSync(fullPath);
    const contentType = fullPath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400'
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(fullPath).pipe(res);
  }

  // 4. 材质远程搜索 POST /api/base-library/materials/search (管理员)
  if (pathname === '/base-library/materials/search' && (req.method === 'POST' || req.method === 'GET')) {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可搜索收录外部材质' });

    let b = {};
    if (req.method === 'POST') {
      b = await parseBody(req);
    } else {
      b = {
        source: urlObj.searchParams.get('source'),
        q: urlObj.searchParams.get('q'),
        category: urlObj.searchParams.get('category'),
        limit: urlObj.searchParams.get('limit')
      };
    }

    const source = (b.source || '').trim();
    if (source !== 'polyhaven' && source !== 'ambientcg') {
      return sendJson(res, 400, { error: 'source 仅支持 polyhaven 或 ambientcg' });
    }

    const cat = (b.category || '').trim();
    // 约束：不能把分类法子类键当成来源 category
    if (cat && VALID_SUBCLASS_KEYS.has(cat)) {
      return sendJson(res, 400, { error: 'category_not_allowed: 不得使用内部子类键，请使用来源站原始分类' });
    }

    if (source === 'ambientcg' && cat) {
      if (!ALLOWED_CATEGORIES.has(cat.toLowerCase())) {
        return sendJson(res, 400, { error: 'category_not_allowed: 类别不在 ambientCG 允许列表中' });
      }
    }

    let results = [];
    if (source === 'polyhaven') {
      results = await searchPolyHaven(b.q || '');
    } else {
      results = await searchAmbientCG(b.q || '');
    }

    return sendJson(res, 200, { success: true, data: results });
  }

  // 5. 材质草稿 POST /api/base-library/materials/draft (管理员)
  if (pathname === '/base-library/materials/draft' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可创建材质草稿' });

    const contentType = req.headers['content-type'] || '';
    let buffer = null;
    let source = 'manual';
    let sourceId = null;
    let licenseNote = '';
    let isManual = false;
    let attestSwatch = false;

    if (contentType.includes('multipart/form-data')) {
      const { readRequestBuffer, parseMultipart } = require('../ingest');
      const rawBuf = await readRequestBuffer(req, 8 * 1024 * 1024);
      const parsed = parseMultipart(rawBuf, contentType);
      const filePart = parsed.files?.[0];
      if (!filePart || !filePart.data) {
        return sendJson(res, 400, { error: '缺少上传图片文件 file' });
      }
      buffer = filePart.data;
      source = 'manual';
      isManual = true;
      licenseNote = (parsed.fields?.license_note || '').trim();
      attestSwatch = parsed.fields?.attest_swatch === 'true' || parsed.fields?.attest_swatch === '1';
    } else {
      const b = await parseBody(req);
      source = (b.source || '').trim();
      sourceId = (b.source_id || b.sourceId || '').trim();
      if (!source || !sourceId) {
        return sendJson(res, 400, { error: '缺少 source 或 source_id' });
      }
      const { fetch } = require('undici');
      if (source === 'polyhaven') {
        const downloadUrl = await resolvePolyHavenDownloadUrl(sourceId);
        const imgRes = await fetch(downloadUrl);
        if (!imgRes.ok) return sendJson(res, 502, { error: '下载 Poly Haven 贴图失败' });
        buffer = Buffer.from(await imgRes.arrayBuffer());
        licenseNote = 'Poly Haven, CC0';
      } else if (source === 'ambientcg') {
        const zipUrl = `https://ambientcg.com/get?file=${encodeURIComponent(sourceId)}_1K-JPG.zip`;
        const zipRes = await fetch(zipUrl);
        if (!zipRes.ok) return sendJson(res, 502, { error: '下载 ambientCG 贴图 zip 失败' });
        const zipBuf = Buffer.from(await zipRes.arrayBuffer());
        buffer = extractFileFromZip(zipBuf, '_Color.jpg');
        if (!buffer) return sendJson(res, 422, { error: 'zip 中未找到 1K _Color.jpg 贴图' });
        licenseNote = 'ambientCG, CC0';
      } else {
        return sendJson(res, 400, { error: '不支持的材质来源' });
      }
    }

    try {
      const draftRes = await createMaterialDraft(services, {
        source,
        sourceId,
        title: sourceId || '',
        licenseNote,
        buffer,
        isManual,
        attestSwatch
      });
      return sendJson(res, 200, {
        success: true,
        draft_id: draftRes.draft_id,
        prefill: draftRes.prefill,
        fields_empty: !draftRes.prefill.name_cn
      });
    } catch (e) {
      const status = e.status || 500;
      return sendJson(res, status, { error: e.message, code: e.code });
    }
  }

  // 6. 材质确认入库 POST /api/base-library/materials/confirm (管理员)
  if (pathname === '/base-library/materials/confirm' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可确认材质入库' });

    const b = await parseBody(req);
    const draftId = b.draft_id || b.draftId;
    if (!draftId) return sendJson(res, 400, { error: 'draft_id 必填' });

    try {
      const confirmed = await confirmMaterialDraft(services, {
        draftId,
        nameCn: b.name_cn || b.nameCn,
        tags: b.tags || [],
        isShell: b.is_shell || b.isShell || 0
      });
      console.log(`[base-library] action=confirm source=${confirmed.source} source_id=${confirmed.source_id || ''} material_id=${confirmed.id}`);
      return sendJson(res, 200, { success: true, data: confirmed });
    } catch (e) {
      return sendJson(res, e.status || 500, { error: e.message });
    }
  }

  // 7. 色号列表 GET /api/base-library/paints
  if (pathname === '/base-library/paints' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const brand = urlObj.searchParams.get('brand');
    const family = urlObj.searchParams.get('family');
    const subclass = urlObj.searchParams.get('subclass');
    const q = urlObj.searchParams.get('q');
    const pinned = urlObj.searchParams.get('pinned');
    const limit = urlObj.searchParams.get('limit');
    const offset = urlObj.searchParams.get('offset');

    const data = listPaints(db, { brand, family, subclass, q, pinned, limit, offset });
    return sendJson(res, 200, { success: true, data });
  }

  // 8. 色号色块 GET /api/base-library/paints/:id/swatch
  const mPaintSwatch = pathname.match(/^\/base-library\/paints\/([^\/]+)\/swatch$/);
  if (mPaintSwatch && (req.method === 'GET' || req.method === 'HEAD')) {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (getFlag(db, 'base_library_paints', 1) === 0) {
      return sendJson(res, 404, { error: '色号库未启用' });
    }

    const paintId = decodeURIComponent(mPaintSwatch[1]);
    const row = db.prepare('SELECT * FROM ba_paints WHERE id=?').get(paintId);
    if (!row) return sendJson(res, 404, { error: '色号不存在' });

    try {
      const { buffer } = await ensurePaintSwatchFile(dataDir, row.id, row.hex);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': buffer.length,
        'Cache-Control': 'public, max-age=86400'
      });
      if (req.method === 'HEAD') return res.end();
      return res.end(buffer);
    } catch (e) {
      return sendJson(res, 500, { error: '生成色块失败: ' + e.message });
    }
  }

  // 9. 色号修改 PATCH /api/base-library/paints/:id (管理员)
  const mPatchPaint = pathname.match(/^\/base-library\/paints\/([^\/]+)$/);
  if (mPatchPaint && req.method === 'PATCH') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可修改色号配置' });

    const paintId = decodeURIComponent(mPatchPaint[1]);
    const existing = db.prepare('SELECT * FROM ba_paints WHERE id=?').get(paintId);
    if (!existing) return sendJson(res, 404, { error: '色号不存在' });

    const b = await parseBody(req);
    let shellId = existing.shell_material_id;
    if (b.shell_material_id !== undefined) {
      if (b.shell_material_id === null || b.shell_material_id === '') {
        shellId = null;
      } else {
        const mat = db.prepare('SELECT * FROM ba_materials WHERE id=? AND deleted_at IS NULL').get(b.shell_material_id);
        if (!mat || !mat.is_shell) {
          return sendJson(res, 400, { error: 'shell_material_id 必须指向未删除且 is_shell=1 的材质' });
        }
        shellId = b.shell_material_id;
      }
    }

    const newAliasZh = b.alias_zh !== undefined ? (b.alias_zh ? String(b.alias_zh).trim() : null) : existing.alias_zh;
    const newAltCode = b.alt_code !== undefined ? (b.alt_code ? String(b.alt_code).trim() : null) : existing.alt_code;
    const newPinned = b.pinned !== undefined ? (Number(b.pinned) ? 1 : 0) : existing.pinned;
    const now = Date.now();

    db.prepare(`
      UPDATE ba_paints
      SET alias_zh=?, alt_code=?, pinned=?, shell_material_id=?, updated_at=?
      WHERE id=?
    `).run(newAliasZh, newAltCode, newPinned, shellId, now, paintId);

    // 标签更新
    if (Array.isArray(b.tags)) {
      db.prepare("DELETE FROM ba_asset_tags WHERE asset_kind='paint' AND asset_id=?").run(paintId);
      const insTag = db.prepare("INSERT OR IGNORE INTO ba_asset_tags (asset_kind, asset_id, surface, subclass) VALUES ('paint', ?, ?, ?)");
      for (const t of b.tags) {
        if (t && isValidSurface(t.surface) && isValidSubclass(t.subclass)) {
          insTag.run(paintId, t.surface, t.subclass);
        }
      }
    }

    return sendJson(res, 200, {
      success: true,
      data: {
        id: paintId,
        alias_zh: newAliasZh,
        alt_code: newAltCode,
        pinned: Boolean(newPinned),
        shell_material_id: shellId,
        updated_at: now
      }
    });
  }

  // 10. 色号镜像 POST & GET /api/base-library/paints/mirror
  if (pathname === '/base-library/paints/mirror') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (req.method === 'GET') {
      const runs = db.prepare('SELECT * FROM ba_mirror_runs ORDER BY brand ASC').all();
      return sendJson(res, 200, { success: true, runs });
    }
    if (req.method === 'POST') {
      if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可触发色号镜像' });
      if (getFlag(db, 'base_library_paints', 1) === 0) {
        return sendJson(res, 409, { error: '色号库功能未开启，拒绝启动镜像' });
      }

      cleanupDeadMirrorRuns(db);

      const active = db.prepare("SELECT * FROM ba_mirror_runs WHERE state='running'").get();
      if (active) {
        return sendJson(res, 409, { error: '已有色号镜像任务正在运行中' });
      }

      const b = await parseBody(req);
      const brands = Array.isArray(b.brands) && b.brands.length ? b.brands : ['nippon-paint', 'dulux'];
      const now = Date.now();

      for (const brand of brands) {
        db.prepare(`
          INSERT INTO ba_mirror_runs (brand, offset, written, state, error, updated_at)
          VALUES (?, 0, 0, 'running', NULL, ?)
          ON CONFLICT(brand) DO UPDATE SET state='running', error=NULL, updated_at=excluded.updated_at
        `).run(brand, now);
      }

      return sendJson(res, 200, {
        success: true,
        message: '镜像任务已启动',
        brands
      });
    }
  }

  // 11. 灯具预设 GET /api/base-library/lights
  if (pathname === '/base-library/lights' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    return sendJson(res, 200, { success: true, data: listLights(db) });
  }

  // 12. 模型仓库 GET /api/base-library/models & POST (409)
  if (pathname === '/base-library/models') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (req.method === 'GET') {
      return sendJson(res, 200, { success: true, data: [], notice: '这一版不替换模型' });
    }
    if (req.method === 'POST') {
      return sendJson(res, 409, { success: false, error: '这一版不替换模型', notice: '这一版不替换模型' });
    }
  }

  // 13. 芯片预设插槽 GET /api/base-library/preset-slots
  if (pathname === '/base-library/preset-slots' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    return sendJson(res, 200, { success: true, data: listPresetSlots(db) });
  }

  // 14. 控制标志开关 GET /api/base-library/flags & PUT /api/base-library/flags/:key
  if (pathname === '/base-library/flags' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    return sendJson(res, 200, { success: true, data: getAllFlags(db) });
  }

  if (pathname === '/base-library/flags' && req.method === 'PUT') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可修改配置标志' });
    const b = await parseBody(req);
    const flagKeys = ['creation_tpl_incremental', 'base_library', 'base_library_jev', 'base_library_compile', 'base_library_paints'];
    for (const f of flagKeys) {
      if (f in b) {
        const val = (b[f] === 1 || b[f] === '1' || b[f] === true) ? 1 : 0;
        setFlag(db, f, val);
      }
    }
    return sendJson(res, 200, { success: true, data: getAllFlags(db) });
  }

  const mFlag = pathname.match(/^\/base-library\/flags\/([^\/]+)$/);
  if (mFlag && req.method === 'PUT') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可修改配置标志' });
    const key = decodeURIComponent(mFlag[1]);
    const b = await parseBody(req);
    const val = (b.value === 1 || b.value === '1' || b.value === true) ? 1 : 0;
    setFlag(db, key, val);
    return sendJson(res, 200, { success: true, data: { key, value: val } });
  }

  // 15. 选区分类代理 POST /api/base-library/classify-region
  if (pathname === '/base-library/classify-region' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });

    const b = await parseBody(req, 16 * 1024 * 1024);
    if (b && b.__bodyTooLarge) {
      return sendJson(res, 413, { success: false, error: 'payload_too_large' });
    }

    const { checkClassifyRateLimit, classifyRegionSurface } = require('./classify');
    const { cropSelectionInterior } = require('../handlers/image-ops');
    const { resolveAssetBuffer } = require('../ai-tasks');
    const sharp = require('sharp');

    const userId = sessionUser?.id || sessionUser?.username || 'anon';
    if (!checkClassifyRateLimit(userId)) {
      return sendJson(res, 429, { success: false, error: 'classify_rate_limited' });
    }

    let imgBuffer = null;
    if (b.asset_fid) {
      imgBuffer = await resolveAssetBuffer(services, b.asset_fid);
      if (!imgBuffer) return sendJson(res, 400, { success: false, error: 'asset_not_found' });
    } else if (b.image_base64) {
      let raw = String(b.image_base64).trim();
      const comma = raw.indexOf(',');
      if (comma >= 0) raw = raw.slice(comma + 1);
      imgBuffer = Buffer.from(raw, 'base64');
    } else {
      return sendJson(res, 400, { success: false, error: 'image_required' });
    }

    if (!b.selection) {
      return sendJson(res, 400, { success: false, error: 'selection_required' });
    }

    try {
      const meta = await sharp(imgBuffer).metadata();
      if ((meta.width && meta.width > 8192) || (meta.height && meta.height > 8192)) {
        return sendJson(res, 400, { success: false, error: 'image_dimension_too_large' });
      }
      const cropJpeg = await cropSelectionInterior(imgBuffer, b.selection);
      const result = await classifyRegionSurface(db, cropJpeg);
      return sendJson(res, 200, result);
    } catch (err) {
      return sendJson(res, 400, { success: false, error: 'image_processing_failed', detail: err.message });
    }
  }

  // 16. 底图价签查询 GET /api/base-library/bindings?image_key=...
  if (pathname === '/base-library/bindings' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const imageKey = urlObj.searchParams.get('image_key');
    if (!imageKey) return sendJson(res, 400, { success: false, error: 'image_key_required' });

    const { getImageBindings, isValidImageKey } = require('./bindings');
    if (!isValidImageKey(imageKey)) {
      return sendJson(res, 400, { success: false, error: 'invalid_image_key' });
    }
    const data = getImageBindings(db, imageKey);
    return sendJson(res, 200, { success: true, data });
  }

  // 17. 底图价签保存 PUT /api/base-library/bindings/:imageKey
  const mBinding = pathname.match(/^\/base-library\/bindings\/([^\/]+)$/);
  if (mBinding && req.method === 'PUT') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const imageKey = decodeURIComponent(mBinding[1]);

    const { putImageBindings, isValidImageKey } = require('./bindings');
    if (!isValidImageKey(imageKey)) {
      return sendJson(res, 400, { success: false, error: 'invalid_image_key' });
    }

    const b = await parseBody(req);
    try {
      const data = putImageBindings(db, imageKey, {
        regions: b.regions || [],
        light_mode: b.light_mode || null,
        kelvin: typeof b.kelvin === 'number' ? b.kelvin : null
      });
      return sendJson(res, 200, { success: true, data });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: err.message });
    }
  }

  // 18. 基础属性编译器 POST /api/base-library/compile
  if (pathname === '/base-library/compile' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req);
    const { compileBaseAttributes } = require('./compile');
    const result = compileBaseAttributes(db, {
      regions: b.regions || [],
      light_mode: b.light_mode || null,
      kelvin: b.kelvin || null,
      maxRefs: typeof b.maxRefs === 'number' ? b.maxRefs : 4
    });
    return sendJson(res, 200, result);
  }

  return false;
}

module.exports = {
  handleBaseLibraryRoutes
};
