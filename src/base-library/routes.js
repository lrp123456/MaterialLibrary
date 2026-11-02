/**
 * 基础属性库 HTTP 路由处理模块 (/api/base-library/*)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

function dataUrlToBuffer(value) {
  const raw = String(value || '').trim();
  const comma = raw.indexOf(',');
  const b64 = raw.startsWith('data:') && comma >= 0 ? raw.slice(comma + 1) : raw;
  return Buffer.from(b64, 'base64');
}

async function loadSelectedCropBuffer(services, body) {
  const { resolveAssetBuffer } = require('../ai-tasks');
  const { cropSelectionInterior } = require('../handlers/image-ops');
  let source = null;
  if (body.fid || body.asset_fid) {
    source = await resolveAssetBuffer(services, String(body.fid || body.asset_fid));
    if (!source) return { error: '找不到这张库内图片' };
  } else if (body.image_base64) {
    source = dataUrlToBuffer(body.image_base64);
  } else {
    return { error: '请上传图片或选择库内图片' };
  }
  const buffer = body.selection ? await cropSelectionInterior(source, body.selection) : source;
  return { buffer };
}

async function dominantHex(buffer) {
  const sharp = require('sharp');
  const out = await sharp(buffer).resize(1, 1, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = out.data;
  return '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('');
}

async function handleBaseLibraryRoutes(services, req, res, pathname, urlObj, { sessionUser, isAdmin, isViewerOrAdmin, parseBody, sendJson }) {
  const db = services.db;

  if (pathname === '/base-library/items' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { listItems } = require('./items');
    return sendJson(res, 200, {
      success: true,
      data: listItems(db, {
        kind: urlObj.searchParams.get('kind') || '',
        kindKey: urlObj.searchParams.get('kind_key') || '',
        mount: urlObj.searchParams.get('mount') || urlObj.searchParams.get('surface') || '',
        role: urlObj.searchParams.get('role') || '',
        family: urlObj.searchParams.get('family') || '',
        hue: urlObj.searchParams.get('hue') || '',
        gloss: urlObj.searchParams.get('gloss') || '',
        pattern: urlObj.searchParams.get('pattern') || '',
        brand: urlObj.searchParams.get('brand') || '',
        brandSeries: urlObj.searchParams.get('brand_series') || '',
        woodSpecies: urlObj.searchParams.get('wood_species') || '',
        woodTone: urlObj.searchParams.get('wood_tone') || '',
        grainType: urlObj.searchParams.get('grain_type') || '',
        grainScale: urlObj.searchParams.get('grain_scale') || '',
        grainDirection: urlObj.searchParams.get('grain_direction') || '',
        woodLayout: urlObj.searchParams.get('wood_layout') || '',
        surfaceFinish: urlObj.searchParams.get('surface_finish') || '',
        woodOnly: urlObj.searchParams.get('wood_only') === '1',
        hasPreview: urlObj.searchParams.get('has_preview') === '1',
        pinned: urlObj.searchParams.get('pinned') === '1',
        sort: urlObj.searchParams.get('sort') || '',
        q: urlObj.searchParams.get('q') || ''
      })
    });
  }

  const mItemPatch = pathname.match(/^\/base-library\/items\/([^/]+)$/);
  if (mItemPatch && req.method === 'PATCH') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const itemId = decodeURIComponent(mItemPatch[1]);
    const { updateItem } = require('./items');
    const b = await parseBody(req);
    const updated = updateItem(db, itemId, b);
    if (!updated) return sendJson(res, 404, { error: '基础素材条目不存在' });
    return sendJson(res, 200, { success: true, data: updated });
  }

  if (pathname === '/base-library/schemes' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { listSchemes } = require('./items');
    return sendJson(res, 200, {
      success: true,
      data: listSchemes(db, { styleId: urlObj.searchParams.get('style_id') || '' })
    });
  }

  if (pathname === '/base-library/styles' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { listStyles } = require('./items');
    return sendJson(res, 200, { success: true, data: listStyles(db) });
  }

  if (pathname === '/base-library/styles' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可保存风格' });
    const b = await parseBody(req, 2 * 1024 * 1024);
    const { upsertStyle } = require('./items');
    try {
      return sendJson(res, 200, { success: true, data: upsertStyle(db, b) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/base-library/styles/analyze' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可分析风格' });
    const b = await parseBody(req, 12 * 1024 * 1024);
    try {
      const crop = await loadSelectedCropBuffer(services, b);
      if (crop.error) return sendJson(res, 400, { error: crop.error });
      const { analyzeStyle } = require('./style-analyze');
      const data = await analyzeStyle(services, crop.buffer.toString('base64'));
      return sendJson(res, 200, { success: true, data });
    } catch (err) {
      return sendJson(res, 502, { error: '风格分析失败', detail: err.message });
    }
  }

  const mStyle = pathname.match(/^\/base-library\/styles\/([^/]+)$/);
  if (mStyle && (req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可修改风格' });
    const { upsertStyle, softDeleteStyle } = require('./items');
    const id = decodeURIComponent(mStyle[1]);
    if (req.method === 'DELETE') return sendJson(res, 200, { success: true, data: softDeleteStyle(db, id) });
    const b = await parseBody(req, 2 * 1024 * 1024);
    return sendJson(res, 200, { success: true, data: upsertStyle(db, { ...b, id }) });
  }

  const schemeCompile = pathname.match(/^\/base-library\/schemes\/([^/]+)\/compile$/);
  if (schemeCompile && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { compileScheme } = require('./items');
    const data = compileScheme(db, decodeURIComponent(schemeCompile[1]), {
      spaceKey: urlObj.searchParams.get('space') || '',
      targetTag: urlObj.searchParams.get('target_tag') || '@图1',
      startRefIndex: Number(urlObj.searchParams.get('start_ref_index')) || 2
    });
    if (!data) return sendJson(res, 404, { error: '配套不存在' });
    return sendJson(res, 200, { success: true, data });
  }

  if (pathname === '/base-library/suggest' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { suggestItems } = require('./items');
    return sendJson(res, 200, {
      success: true,
      data: suggestItems(db, {
        surface: urlObj.searchParams.get('surface') || '',
        role: urlObj.searchParams.get('role') || '',
        schemeId: urlObj.searchParams.get('scheme_id') || '',
        space: urlObj.searchParams.get('space') || ''
      })
    });
  }

  if (pathname === '/base-library/space/extract' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req, 12 * 1024 * 1024);
    try {
      const crop = await loadSelectedCropBuffer(services, b);
      if (crop.error) return sendJson(res, 400, { error: crop.error });
      const { extractSpaceSurfaces, recommendSurfaceItems, SURFACE_SPECS } = require('./space-transfer');
      const surfaces = await extractSpaceSurfaces(services, crop.buffer);
      const recommendations = {};
      for (const spec of SURFACE_SPECS) {
        const s = surfaces[spec.key];
        recommendations[spec.key] = recommendSurfaceItems(db, spec.key, s.kind_key, s.hex);
      }
      return sendJson(res, 200, { success: true, data: { surfaces, recommendations, specs: SURFACE_SPECS } });
    } catch (err) {
      return sendJson(res, 500, { error: '空间结构读取失败', detail: err.message });
    }
  }

  if (pathname === '/base-library/space/recommend' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { recommendSurfaceItems } = require('./space-transfer');
    const surface = urlObj.searchParams.get('surface') || 'wall';
    const kindKey = urlObj.searchParams.get('kind_key') || '';
    const hex = urlObj.searchParams.get('hex') || '';
    const items = recommendSurfaceItems(db, surface, kindKey, hex);
    return sendJson(res, 200, { success: true, data: items });
  }
  const dataDir = services.config?.dataDir || process.env.ML_DATA_DIR || path.join(require('os').homedir(), '.dsh-material-library');

  const guideUserId = sessionUser?.id || sessionUser?.username || '';
  if (pathname === '/base-library/guides' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { listGuides } = require('./guides');
    return sendJson(res, 200, { success: true, data: listGuides(db, guideUserId) });
  }
  if (pathname === '/base-library/guides' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { createGuide } = require('./guides');
    const b = await parseBody(req);
    try {
      return sendJson(res, 200, { success: true, data: createGuide(db, guideUserId, b) });
    } catch (err) {
      return sendJson(res, err.status || 400, { success: false, error: err.message });
    }
  }
  const mGuide = pathname.match(/^\/base-library\/guides\/([^/]+)$/);
  if (mGuide && (req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { updateGuide, deleteGuide } = require('./guides');
    const guideId = decodeURIComponent(mGuide[1]);
    if (req.method === 'DELETE') {
      const removed = deleteGuide(db, guideUserId, guideId);
      if (!removed) return sendJson(res, 404, { success: false, error: '找不到这条指南' });
      return sendJson(res, 200, { success: true });
    }
    const b = await parseBody(req);
    try {
      const updated = updateGuide(db, guideUserId, guideId, b);
      if (!updated) return sendJson(res, 404, { success: false, error: '找不到这条指南' });
      return sendJson(res, 200, { success: true, data: updated });
    } catch (err) {
      return sendJson(res, err.status || 400, { success: false, error: err.message });
    }
  }

  // 1. 分类法 GET /api/base-library/taxonomy
  if (pathname === '/base-library/taxonomy' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    return sendJson(res, 200, { success: true, data: getTaxonomy() });
  }

  // ── Master 统一字典联动查询 GET /api/base-library/dictionary ──
  if (pathname === '/base-library/dictionary' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const part = urlObj.searchParams.get('part') || '';
    const dict = require('./dictionary-routes');
    return sendJson(res, 200, { success: true, data: dict.getDictionary(db, { part }) });
  }

  // ── 部位 CRUD ──
  if (pathname === '/base-library/parts' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可新增部位' });
    const b = await parseBody(req);
    const dict = require('./dictionary-routes');
    try {
      const data = dict.createPart(db, b);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }
  const mPart = pathname.match(/^\/base-library\/parts\/([^\/]+)$/);
  if (mPart && req.method === 'PATCH') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可修改部位' });
    const id = decodeURIComponent(mPart[1]);
    const b = await parseBody(req);
    const dict = require('./dictionary-routes');
    const data = dict.updatePart(db, id, b);
    if (!data) return sendJson(res, 404, { success: false, error: '部位不存在' });
    return sendJson(res, 200, { success: true, data });
  }
  if (mPart && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可删除部位' });
    const id = decodeURIComponent(mPart[1]);
    const dict = require('./dictionary-routes');
    const ok = dict.deletePart(db, id);
    return sendJson(res, 200, { success: ok });
  }

  // ── 基材品类 CRUD ──
  if (pathname === '/base-library/categories' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可新增基材品类' });
    const b = await parseBody(req);
    const dict = require('./dictionary-routes');
    try {
      const data = dict.createCategory(db, b);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }
  const mCat = pathname.match(/^\/base-library\/categories\/([^\/]+)$/);
  if (mCat && req.method === 'PATCH') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可修改基材品类' });
    const id = decodeURIComponent(mCat[1]);
    const b = await parseBody(req);
    const dict = require('./dictionary-routes');
    const data = dict.updateCategory(db, id, b);
    if (!data) return sendJson(res, 404, { success: false, error: '品类不存在' });
    return sendJson(res, 200, { success: true, data });
  }
  if (mCat && req.method === 'DELETE') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可删除基材品类' });
    const id = decodeURIComponent(mCat[1]);
    const dict = require('./dictionary-routes');
    const ok = dict.deleteCategory(db, id);
    return sendJson(res, 200, { success: ok });
  }

  // ── 专属色卡与花色资产 CRUD ──
  if (pathname === '/base-library/swatches' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const dict = require('./dictionary-routes');
    const data = dict.listSwatches(db, {
      category_id: urlObj.searchParams.get('category_id'),
      color_family: urlObj.searchParams.get('color_family'),
      item_type: urlObj.searchParams.get('item_type'),
      q: urlObj.searchParams.get('q'),
      pinned: urlObj.searchParams.get('pinned'),
      limit: urlObj.searchParams.get('limit'),
      offset: urlObj.searchParams.get('offset')
    });
    return sendJson(res, 200, { success: true, data });
  }
  if (pathname === '/base-library/swatches' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req, 16 * 1024 * 1024);
    const dict = require('./dictionary-routes');
    try {
      const data = dict.createSwatch(db, b);
      return sendJson(res, 200, { success: true, data });
    } catch (e) {
      return sendJson(res, 400, { success: false, error: e.message });
    }
  }
  const mSwatch = pathname.match(/^\/base-library\/swatches\/([^\/]+)$/);
  if (mSwatch && req.method === 'PATCH') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const id = decodeURIComponent(mSwatch[1]);
    const b = await parseBody(req);
    const dict = require('./dictionary-routes');
    const data = dict.updateSwatch(db, id, b);
    if (!data) return sendJson(res, 404, { success: false, error: '色卡不存在' });
    return sendJson(res, 200, { success: true, data });
  }
  if (mSwatch && req.method === 'DELETE') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const id = decodeURIComponent(mSwatch[1]);
    const dict = require('./dictionary-routes');
    const ok = dict.deleteSwatch(db, id);
    return sendJson(res, 200, { success: ok });
  }

  // ── 「物理测色 + ΔE00 品牌近邻 + VLM 智能美学赋名」POST /api/base-library/swatches/recognize-vlm ──
  if (pathname === '/base-library/swatches/recognize-vlm' && req.method === 'POST') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const b = await parseBody(req, 16 * 1024 * 1024);
    const dict = require('./dictionary-routes');
    try {
      const result = await dict.recognizeVlmSwatch(db, {
        hex: b.hex,
        cropDataUrl: b.cropDataUrl || b.image_base64 || b.crop_base64,
        partHint: b.partHint || b.part,
        config: services && services.config
      });
      return sendJson(res, 200, { success: true, data: result });
    } catch (err) {
      return sendJson(res, 500, { success: false, error: err.message });
    }
  }

  // 1.1 部位策略 GET /api/base-library/part-policy (单一事实来源)
  if (pathname === '/base-library/part-policy' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { PART_POLICIES, VALID_PARTS, VALID_MATERIAL_FAMILIES, SUBCLASS_COMPAT_MAP } = require('./part-policy');
    return sendJson(res, 200, {
      success: true,
      data: {
        parts: PART_POLICIES,
        valid_parts: VALID_PARTS,
        valid_families: VALID_MATERIAL_FAMILIES,
        subclass_compat_map: SUBCLASS_COMPAT_MAP || {}
      }
    });
  }

  // 2. 材质列表 GET /api/base-library/materials
  if (pathname === '/base-library/materials' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const surface = urlObj.searchParams.get('surface');
    const subclass = urlObj.searchParams.get('subclass');
    const source = urlObj.searchParams.get('source');
    const is_shell = urlObj.searchParams.get('is_shell');
    const q = urlObj.searchParams.get('q');
    const track = urlObj.searchParams.get('track');
    const tone = urlObj.searchParams.get('tone');
    const layout = urlObj.searchParams.get('layout');
    const limit = urlObj.searchParams.get('limit');
    const offset = urlObj.searchParams.get('offset');

    const data = listMaterials(db, {
      surface,
      subclass,
      source,
      is_shell,
      q,
      track: track !== null ? track : 'B',
      tone,
      layout,
      limit,
      offset
    });
    return sendJson(res, 200, { success: true, data });
  }

  const mMatPatch = pathname.match(/^\/base-library\/materials\/([^/]+)$/);
  if (mMatPatch && req.method === 'PATCH') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const matId = decodeURIComponent(mMatPatch[1]);
    const b = await parseBody(req);
    const existing = db.prepare('SELECT * FROM ba_materials WHERE id=? AND deleted_at IS NULL').get(matId);
    if (!existing) return sendJson(res, 404, { error: '材质不存在' });

    let isPinned = Number(existing.is_pinned || 0);
    if (b.is_pinned !== undefined) isPinned = b.is_pinned ? 1 : 0;
    let useCount = Number(existing.use_count || 0);
    if (b.action === 'use') useCount += 1;
    else if (b.use_count !== undefined) useCount = Math.max(0, Number(b.use_count) || 0);

    const now = Date.now();
    db.prepare('UPDATE ba_materials SET is_pinned=?, use_count=?, updated_at=? WHERE id=?')
      .run(isPinned, useCount, now, matId);
    return sendJson(res, 200, { success: true, data: { id: matId, is_pinned: isPinned, use_count: useCount } });
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

    const hexParam = urlObj.searchParams.get('hex');
    if (hexParam) {
      try {
        const { ensureTintedFile } = require('./pretint');
        const sourceBuffer = fs.readFileSync(fullPath);
        const { buffer } = await ensureTintedFile(dataDir, matId, hexParam, sourceBuffer);
        res.writeHead(200, {
          'Content-Type': 'image/jpeg',
          'Content-Length': buffer.length,
          'Cache-Control': 'public, max-age=86400'
        });
        if (req.method === 'HEAD') return res.end();
        return res.end(buffer);
      } catch (err) {}
    }

    const stat = fs.statSync(fullPath);
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400'
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(fullPath).pipe(res);
  }

  const mItemMedia = pathname.match(/^\/base-library\/items\/([^/]+)\/(preview|scene)$/);
  if (mItemMedia && (req.method === 'GET' || req.method === 'HEAD')) {
    // 材质切片与场景图作为公共素材支持公开只读访问
    const itemId = decodeURIComponent(mItemMedia[1]);
    const mediaType = mItemMedia[2]; // 'preview' | 'scene'
    const row = db.prepare('SELECT preview_rel, scene_rel FROM ba_items WHERE id = ?').get(itemId);
    if (!row) {
      return sendJson(res, 404, { error: '条目不存在' });
    }
    const targetRel = mediaType === 'scene' ? (row.scene_rel || row.preview_rel) : (row.preview_rel || row.scene_rel);
    if (!targetRel) {
      return sendJson(res, 404, { error: '媒体资源不存在' });
    }

    // 1. 外链图片处理
    if (/^https?:\/\//i.test(targetRel)) {
      // 统一外部图片中继与本地磁盘缓存，防盗链且保证内网高可用
      try {
        const cacheDir = path.join(dataDir, 'cache', 'base-library', 'proxy');
        const cacheFile = `${crypto.createHash('md5').update(targetRel).digest('hex')}.jpg`;
        const cachePath = path.join(cacheDir, cacheFile);

        if (fs.existsSync(cachePath)) {
          const stat = fs.statSync(cachePath);
          res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Content-Length': stat.size,
            'Cache-Control': 'public, max-age=86400'
          });
          if (req.method === 'HEAD') return res.end();
          return fs.createReadStream(cachePath).pipe(res);
        }

        const headers = {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };
        if (/newpearl\.com|cg1993\.com/i.test(targetRel)) {
          headers['Referer'] = 'https://www.cg1993.com/';
        }

        const upstreamRes = await fetch(targetRel, {
          headers,
          signal: AbortSignal.timeout(10000)
        });
        if (upstreamRes.ok) {
          const buf = Buffer.from(await upstreamRes.arrayBuffer());
          try {
            fs.mkdirSync(cacheDir, { recursive: true });
            fs.writeFileSync(cachePath, buf);
          } catch (writeErr) {
            console.warn('[base-library] 写入图片缓存失败:', writeErr.message);
          }
          const cType = upstreamRes.headers.get('content-type') || 'image/jpeg';
          res.writeHead(200, {
            'Content-Type': cType,
            'Content-Length': buf.length,
            'Cache-Control': 'public, max-age=86400'
          });
          if (req.method === 'HEAD') return res.end();
          return res.end(buf);
        }
      } catch (err) {
        console.warn(`[base-library] 中继外部图片失败，降级302: ${targetRel}`, err.message);
      }

      // 降级 302 重定向
      res.writeHead(302, { Location: targetRel });
      return res.end();
    }

    // 2. 本地相对路径 (如 cache/base-library/catalog/xxx.jpg)
    const rel = String(targetRel).replace(/\\/g, '/');
    if (rel.includes('..')) {
      return sendJson(res, 404, { error: '预览图路径非法' });
    }
    const fullPath = path.resolve(dataDir, rel);
    if (!fs.existsSync(fullPath)) {
      return sendJson(res, 404, { error: '预览图文件不存在' });
    }
    const lower = fullPath.toLowerCase();
    const contentType = lower.endsWith('.png') ? 'image/png' : (lower.endsWith('.webp') ? 'image/webp' : 'image/jpeg');
    const stat = fs.statSync(fullPath);
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Cache-Control': 'public, max-age=86400'
    });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(fullPath).pipe(res);
  }


  // 3.1 材质 3D 材质球预览图 GET /api/base-library/materials/:id/preview
  const mMatPreview = pathname.match(/^\/base-library\/materials\/([^\/]+)\/preview$/);
  if (mMatPreview && (req.method === 'GET' || req.method === 'HEAD')) {
    // 3D 材质球作为公共素材支持公开只读访问
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

  // 7. 色号列表 GET /api/base-library/paints (默认只查 curated=1 精选集)
  if (pathname === '/base-library/paints' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const brand = urlObj.searchParams.get('brand');
    const family = urlObj.searchParams.get('family');
    const family_key = urlObj.searchParams.get('family_key');
    const subclass = urlObj.searchParams.get('subclass');
    const q = urlObj.searchParams.get('q');
    const pinned = urlObj.searchParams.get('pinned');
    const curatedParam = urlObj.searchParams.get('curated');
    const min_lrv = urlObj.searchParams.get('min_lrv');
    const limit = urlObj.searchParams.get('limit');
    const offset = urlObj.searchParams.get('offset');

    let curated = 1;
    if (curatedParam === 'all') curated = 'all';
    else if (curatedParam === '0' || curatedParam === 'false') curated = 0;
    else if (curatedParam !== null) curated = 1;

    const data = listPaints(db, {
      brand,
      family,
      family_key,
      subclass,
      q,
      pinned,
      curated,
      min_lrv,
      limit,
      offset
    });
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

    const { checkClassifyRateLimit } = require('./classify');
    const { classifyRegionPart } = require('./classify-part');
    const { cropSelectionInterior } = require('../handlers/image-ops');
    const { resolveAssetBuffer } = require('../ai-tasks');
    const sharp = require('sharp');

    const userId = sessionUser?.id || sessionUser?.username || 'anon';
    if (!checkClassifyRateLimit(userId)) {
      return sendJson(res, 429, { success: false, error: 'classify_rate_limited' });
    }

    // 支持前端直接上传切片 JPEG Base64 (极速且杜绝跨源与大图网络开销)
    if (b.crop_base64) {
      try {
        let raw = String(b.crop_base64).trim();
        const comma = raw.indexOf(',');
        if (comma >= 0) raw = raw.slice(comma + 1);
        const cropJpeg = Buffer.from(raw, 'base64');
        const result = await classifyRegionPart(db, cropJpeg, { config: services && services.config });
        return sendJson(res, 200, { success: true, data: result });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: 'crop_classify_failed', detail: err.message });
      }
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
      const result = await classifyRegionPart(db, cropJpeg, { config: services && services.config });
      return sendJson(res, 200, { success: true, data: result });
    } catch (err) {
      return sendJson(res, 400, { success: false, error: 'image_processing_failed', detail: err.message });
    }
  }

  // 15.1 品牌适配器与图片提炼
  if (pathname === '/base-library/catalog/sources' && req.method === 'GET') {
    if (!isViewerOrAdmin) return sendJson(res, 401, { error: '未登录或会话已过期' });
    const { listAdapters } = require('./catalog-sources');
    return sendJson(res, 200, { success: true, data: listAdapters() });
  }

  if (pathname === '/base-library/catalog/pull' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可拉取品牌色卡' });
    const b = await parseBody(req);
    const { getAdapter, parseSwatches } = require('./catalog-sources');
    const { upsertCatalogItem } = require('./items');
    const adapter = getAdapter(String(b.adapter || ''));
    if (!adapter) return sendJson(res, 400, { error: '未知适配器' });
    let html = '';
    try {
      const response = await fetch(adapter.startUrl, { headers: { 'User-Agent': 'MaterialLibraryCatalog/1.0' } });
      if (!response.ok) return sendJson(res, 502, { error: `品牌页返回 ${response.status}` });
      html = await response.text();
    } catch (err) {
      return sendJson(res, 502, { error: '打不开品牌页', detail: err.message });
    }
    const swatches = parseSwatches(adapter, html);
    const saved = [];
    const dir = path.join(dataDir, 'cache', 'base-library', 'catalog');
    fs.mkdirSync(dir, { recursive: true });
    for (const row of swatches) {
      if (!row.image_url) continue;
      let previewRel = '';
      try {
        const imgRes = await fetch(row.image_url);
        if (!imgRes.ok) continue;
        const bytes = Buffer.from(await imgRes.arrayBuffer());
        const ext = path.extname(new URL(row.image_url, adapter.startUrl).pathname).slice(0, 8) || '.jpg';
        const file = `${require('crypto').createHash('sha1').update(String(row.external_id)).digest('hex').slice(0, 16)}${ext}`;
        fs.writeFileSync(path.join(dir, file), bytes);
        previewRel = `cache/base-library/catalog/${file}`;
      } catch {
        continue;
      }
      saved.push(upsertCatalogItem(db, {
        ...row,
        preview_rel: previewRel,
        origin: 'brand',
        name_status: 'page',
        kind_key: adapter.kindKey,
        brand: row.brand || adapter.brand
      }));
    }
    return sendJson(res, 200, {
      success: true,
      adapter: adapter.id,
      parsed: swatches.length,
      saved: saved.length,
      note: swatches.length ? '' : '这一页还没有解析出色卡。没有参考图的条目不会入库。'
    });
  }

  if (pathname === '/base-library/catalog/extract-preview' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可提取材质' });
    const b = await parseBody(req, 12 * 1024 * 1024);
    const { distillImage } = require('./distill');
    try {
      const crop = await loadSelectedCropBuffer(services, b);
      if (crop.error) return sendJson(res, 400, { error: crop.error });
      const buffer = crop.buffer;
      const hex = await dominantHex(buffer);
      const drafts = await distillImage(services, buffer.toString('base64'));
      return sendJson(res, 200, {
        success: true,
        preview_base64: `data:image/jpeg;base64,${buffer.toString('base64')}`,
        hex,
        drafts
      });
    } catch (err) {
      return sendJson(res, 502, { error: '材质识别失败', detail: err.message });
    }
  }

  if (pathname === '/base-library/catalog/extract' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可保存提取材质' });
    const b = await parseBody(req, 12 * 1024 * 1024);
    const { upsertCatalogItem, setItemMount } = require('./items');
    try {
      const crop = await loadSelectedCropBuffer(services, b);
      if (crop.error) return sendJson(res, 400, { error: crop.error });
      const buffer = crop.buffer;
      const hex = b.hex || await dominantHex(buffer);
      const kindKey = String(b.kind_key || 'fabric').trim();
      const dir = path.join(dataDir, 'cache', 'base-library', 'catalog');
      fs.mkdirSync(dir, { recursive: true });
      const hash = crypto.createHash('sha1').update(buffer).digest('hex').slice(0, 16);
      const file = `${hash}.jpg`;
      fs.writeFileSync(path.join(dir, file), buffer);
      const previewRel = `cache/base-library/catalog/${file}`;
      const saved = upsertCatalogItem(db, {
        id: b.id || undefined,
        kind: b.kind || (kindKey === 'latex' ? 'color' : 'texture'),
        kind_key: kindKey,
        name_zh: b.name_zh,
        prompt_name: b.prompt_name || b.name_zh,
        hex,
        brand: b.brand || (b.shared ? '公共材质' : ''),
        external_id: b.external_id || `extract_${hash}`,
        external_sku: b.external_sku || '',
        gloss: b.gloss || '',
        pattern: b.pattern || '',
        source_url: b.source_url || '',
        preview_rel: previewRel,
        origin: b.shared ? 'generic' : 'photo',
        name_status: 'manual',
        zone: b.shared ? 'shared' : (b.zone || 'any'),
        images_json: JSON.stringify({ source_fid: b.fid || b.asset_fid || '', selection: b.selection || null })
      });
      db.prepare(`
        UPDATE ba_items SET external_sku = ?, gloss = ?, pattern = ?, images_json = ?, zone = ?
        WHERE id = ?
      `).run(b.external_sku || '', b.gloss || '', b.pattern || '',
        JSON.stringify({ source_fid: b.fid || b.asset_fid || '', selection: b.selection || null }),
        b.shared ? 'shared' : (b.zone || 'any'), saved.id);
      const mounts = Array.isArray(b.mounts) ? b.mounts : (b.mount ? [b.mount] : []);
      for (const mount of mounts) setItemMount(db, saved.id, mount);
      return sendJson(res, 200, { success: true, data: { id: saved.id, preview_rel: previewRel } });
    } catch (err) {
      return sendJson(res, 502, { error: '材质保存失败', detail: err.message });
    }
  }

  if (pathname === '/base-library/catalog/distill-preview' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可从图片提炼' });
    const b = await parseBody(req, 12 * 1024 * 1024);
    const { distillImage } = require('./distill');
    const { resolveAssetBuffer } = require('../ai-tasks');
    let raw = '';
    try {
      if (b.fid) {
        const buf = await resolveAssetBuffer(services, String(b.fid));
        if (!buf) return sendJson(res, 400, { error: '找不到这张库内图片' });
        raw = buf.toString('base64');
      } else if (b.image_base64) {
        raw = String(b.image_base64);
      } else {
        return sendJson(res, 400, { error: '请上传图片或选择库内图片' });
      }
      const drafts = await distillImage(services, raw);
      return sendJson(res, 200, { success: true, drafts, inserted: 0 });
    } catch (err) {
      return sendJson(res, 502, { error: '照片提炼失败', detail: err.message });
    }
  }

  if (pathname === '/base-library/catalog/distill' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可从图片库提炼' });
    const b = await parseBody(req, 12 * 1024 * 1024);
    const rows = Array.isArray(b.swatches) ? b.swatches : [];
    const { upsertCatalogItem, setItemMount } = require('./items');
    const { normalizeDraftItem } = require('./distill');
    let sharedRel = String(b.preview_rel || '').trim();
    if (!sharedRel && (b.image_base64 || b.fid)) {
      let bytes = null;
      if (b.image_base64) {
        let raw = String(b.image_base64).trim();
        const comma = raw.indexOf(',');
        if (comma >= 0) raw = raw.slice(comma + 1);
        bytes = Buffer.from(raw, 'base64');
      } else {
        const { resolveAssetBuffer } = require('../ai-tasks');
        bytes = await resolveAssetBuffer(services, String(b.fid));
      }
      if (bytes && bytes.length > 32) {
        const dir = path.join(dataDir, 'cache', 'base-library', 'catalog');
        fs.mkdirSync(dir, { recursive: true });
        const file = `${crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16)}.jpg`;
        fs.writeFileSync(path.join(dir, file), bytes);
        sharedRel = `cache/base-library/catalog/${file}`;
      }
    }
    let merged = 0;
    let created = 0;
    let skipped = 0;
    for (const row of rows) {
      const draft = normalizeDraftItem(row);
      const previewRel = String((row && row.preview_rel) || sharedRel || '').trim();
      if (!draft || !previewRel) {
        skipped += 1;
        continue;
      }
      const result = upsertCatalogItem(db, {
        kind: draft.kind,
        kind_key: draft.kind_key,
        name_zh: draft.name_zh,
        hex: draft.hex,
        preview_rel: previewRel,
        source_url: row.source_url || '',
        external_id: '',
        origin: 'photo',
        name_status: 'page',
        brand: draft.brand || ''
      });
      if (draft.mount) setItemMount(db, result.id, draft.mount);
      if (result.merged) merged += 1;
      else if (!result.updated) created += 1;
    }
    return sendJson(res, 200, { success: true, created, merged, skipped, preview_rel: sharedRel });
  }

  if (pathname === '/base-library/schemes/draft' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可生成方案草稿' });
    const b = await parseBody(req);
    const { clusterSchemeDraft } = require('./items');
    const data = clusterSchemeDraft(db, b.item_ids || []);
    return sendJson(res, 200, { success: true, ...data });
  }

  if (pathname === '/base-library/schemes' && req.method === 'POST') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可保存方案' });
    const b = await parseBody(req, 8 * 1024 * 1024);
    const { upsertScheme } = require('./items');
    try {
      const data = upsertScheme(db, b);
      return sendJson(res, 200, { success: true, data });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  const mSchemeSlots = pathname.match(/^\/base-library\/schemes\/([^/]+)\/slots$/);
  if (mSchemeSlots && req.method === 'PUT') {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可修改方案槽位' });
    const b = await parseBody(req, 8 * 1024 * 1024);
    const { replaceSchemeSlots } = require('./items');
    return sendJson(res, 200, {
      success: true,
      data: replaceSchemeSlots(db, decodeURIComponent(mSchemeSlots[1]), b.slots || [])
    });
  }

  const mScheme = pathname.match(/^\/base-library\/schemes\/([^/]+)$/);
  if (mScheme && (req.method === 'PATCH' || req.method === 'DELETE')) {
    if (!isAdmin) return sendJson(res, 403, { error: '仅管理员可修改方案' });
    const { upsertScheme, softDeleteScheme } = require('./items');
    const id = decodeURIComponent(mScheme[1]);
    if (req.method === 'DELETE') {
      return sendJson(res, 200, { success: true, data: softDeleteScheme(db, id) });
    }
    const b = await parseBody(req, 8 * 1024 * 1024);
    try {
      return sendJson(res, 200, { success: true, data: upsertScheme(db, { ...b, id }) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
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
      maxRefs: typeof b.maxRefs === 'number' ? b.maxRefs : 4,
      baseImageTag: b.baseImageTag || '图1',
      firstRefIndex: Number.isInteger(b.firstRefIndex) ? b.firstRefIndex : 2,
      dataDir
    });
    return sendJson(res, 200, result);
  }

  return false;
}

module.exports = {
  handleBaseLibraryRoutes
};
