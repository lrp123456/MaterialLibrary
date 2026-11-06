/**
 * 产线标准节点实现表 (Pipeline Node Implementations)
 * 节点纯函数 (services, nodeConfig, asset, runCtx) -> { success, skipped, nonFatal, output, flags, error }
 */
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Quark } = require('../quark');
const { chatVision } = require('../vlm');
const { resolveActiveVlmConfig } = require('../providers');
const { inspect, hamming } = require('../qc');
const { calculateOriginOrientation, classifyOrientation, HARD_MATERIALS, SOFT_MATERIALS } = require('../tags-seed');
const { createDerivative, setMainDerivative, markKindRecast, getDerivatives } = require('../derivatives');
const gen = require('../gen');
function executeAdapter(svc, ...args) {
  if (svc && typeof svc.executeAdapter === 'function') return svc.executeAdapter(svc, ...args);
  return gen.executeAdapter(svc, ...args);
}
const { getAssetTags } = require('../cluster');
const { ensureOriginalFile } = require('../originals');
const { calibrateGeneratedImage, pixelSizeFor, agnesSizeForPreset, kindForRatio, restagePromptForRatio, restageNegativePrompt } = require('../ratio');
const { backupAsset } = require('../ingest');
const { findQualifiedKind, isQueueFullError, nextRestageBackoff } = require('../restage');
const { embedCaption, storeVector } = require('../vector');

const PHASH_THRESHOLD = 8;

function isVideoAsset(asset, filePath) {
  const k = String(asset?.kind || '').toLowerCase();
  const n = String(asset?.file_name || filePath || '').toLowerCase();
  return k === 'video' || /\.(mp4|mov|webm|mkv|m4v)$/i.test(n);
}

async function visionImagesForAsset(services, asset, { origPath = null, thumbDataUrl = '' } = {}) {
  const { config } = services;
  if (!isVideoAsset(asset, origPath)) return [];
  try {
    const { extractVideoFrames, isVideoFile } = require('../video-frames');
    let src = origPath;
    if (!src || !fs.existsSync(src) || !isVideoFile(src)) {
      src = await ensureOriginalFile(services, asset);
    }
    if (!src || !fs.existsSync(src) || !isVideoFile(src)) return [];
    const destDir = path.join(config.dataDir, 'cache', 'temp');
    const frames = await extractVideoFrames(src, destDir, { prefix: `tag_${asset.fid}` });
    return frames.map((f) => f.dataUrl);
  } catch (_) {
    return thumbDataUrl ? [thumbDataUrl] : [];
  }
}

function enumOptions(db, dim) {
  return db.prepare('SELECT dir, label, criteria, aliases FROM tag_dict WHERE dimension=? AND deprecated=0 ORDER BY id').all(dim)
    .map(r => {
      const aliases = (() => {
        if (!r.aliases) return '';
        try {
          const a = JSON.parse(r.aliases);
          return Array.isArray(a) && a.length ? `(${a.join('/')})` : '';
        } catch { return ''; }
      })();
      const base = `${r.dir}(${r.label}${aliases})`;
      return r.criteria ? `${base}｜${r.criteria}` : base;
    })
    .join(', ');
}

function enumMaterials(db, group) {
  const set = group === 'hard' ? HARD_MATERIALS : SOFT_MATERIALS;
  return db.prepare("SELECT dir, label, criteria, aliases FROM tag_dict WHERE dimension='material_kind' AND deprecated=0 ORDER BY id").all()
    .filter(r => set.has(r.dir))
    .map(r => {
      const aliases = (() => {
        if (!r.aliases) return '';
        try {
          const a = JSON.parse(r.aliases);
          return Array.isArray(a) && a.length ? `(${a.join('/')})` : '';
        } catch { return ''; }
      })();
      const base = `${r.dir}(${r.label}${aliases})`;
      return r.criteria ? `${base}｜${r.criteria}` : base;
    })
    .join(', ');
}

function gatePrompt() {
  return require('../gate-route').GATE_PROMPT;
}

function tagSpacePrompt(db, onlyDimensions = null) {
  const only = onlyDimensions && onlyDimensions.length ? new Set(onlyDimensions) : null;
  const want = (k) => !only || only.has(k);
  const schema = {};
  if (want('space')) schema.space = `场景空间，严格单选 [${enumOptions(db, 'space')}]。门外未进户为 porch(门外门廊)，进门过渡区为 foyer(门内门厅)。`;
  if (want('style_atom')) {
    schema.style_main = `风格流派与木系风格。输出字符串数组，1-3 个 dir，从枚举中选 [${enumOptions(db, 'style_atom')}]。
判定要点：法式=护墙板/线脚/人字拼/对称；意式=大理石皮革低矮雕塑感；托斯卡纳=赤陶木梁锻铁陶罐乡土；地中海=白墙蓝白花砖拱廊；奶油风=无法式符号的浅暖软融；中古风=1945-75柚木细锥腿有机弧线；现代极简=冷感几何留白；工业=裸砖水泥管道；现代美式=当代舒适；美式乡村=农舍壁炉格纹旧木；南洋=藤编柚木绿植百叶；宋式美学=雅素文人；古典中式=明清红木繁雕对称；新中式=传统符号+现代转译；侘寂=斑驳枯寂；自然原木风=浅色松/白橡/原色自然表面；深色原木风=胡桃/深橡/烟熏深木表面；自然复古原木风=浅色做旧/磨损/锯痕；深色复古原木风=深色做旧/历史斑驳感；other=不在以上体系内。
【禁止】混搭、欧式轻奢、原木日式、日式、北欧、英式、民宿风。画面有多风格时输出具体各风格，不可输出混搭；无法归类才给 other，数组不得为空。`;
    schema.style_confidence = '0到1之间的小数，表示风格判定置信度';
  }
  if (want('material_kind')) {
    schema.materials_hard = `硬装主材：地面/墙面/木作/五金/玻璃隔断等大面积主材，最多2个。【禁止】普通大白墙/顶面标 paint；普通透明门窗玻璃标 glass_clear，只有特色玻璃隔断/家具才标。只能选 [${enumMaterials(db, 'hard')}]`;
    schema.materials_soft = `软装主材：织物/皮革/藤编，最多2个。只能选 [${enumMaterials(db, 'soft')}]`;
  }
  if (!only) {
    schema.has_watermark = false;
    schema.watermark_note = '';
  }

  const header = only
    ? `【本次只需输出这些维度：${[...only].join(', ')}。其余字段不要输出。】`
    : '';
  return `你是室内设计空间素材标注器。只输出 JSON，不要 markdown。
规则：空间 1 个；风格 style_main 为数组（1-3 个，多标签共存检索，严禁为空）；硬装≤2、软装≤2。不要输出色系、地域、调性、构图、机位、光线、AI生成、装修实拍。
dir 只能从枚举中选；空间拿不准给 other；若画面融合多种风格（如现代极简与原木风并存），必须输出所有对应的风格标签（最多3个）；严禁输出混搭；只有完全不属于任何已知风格时才输出 other。
${header}
${JSON.stringify(schema, null, 2)}`;
}

function tagFurniturePrompt(db, onlyDimensions = null) {
  const only = onlyDimensions && onlyDimensions.length ? new Set(onlyDimensions) : null;
  const want = (k) => !only || only.has(k);
  const schema = {};
  if (want('furniture_category')) schema.furniture_category = `家具大类，单选 [${enumOptions(db, 'furniture_category')}]`;
  if (want('furniture_item')) schema.furniture_item = `细分单品品类，单选 [${enumOptions(db, 'furniture_item')}]`;
  if (want('material_kind')) {
    schema.materials_hard = `单品主体核心材质（如木/皮/石/微水泥），最多2个 [${enumMaterials(db, 'hard')}]`;
    schema.materials_soft = `单品饰面/五金配件材质（如黄铜/黑钢/藤编），最多2个 [${enumMaterials(db, 'soft')}]`;
  }
  if (want('dominant_color')) {
    schema.dominant_color = `该家具单品的唯一主体视觉颜色，严格单选 [${enumOptions(db, 'dominant_color')}]`;
  }
  if (want('furniture_craft')) schema.furniture_craft = `表面工艺与质感，最多3个 [${enumOptions(db, 'furniture_craft')}]`;
  if (want('furniture_form')) schema.furniture_form = `造型结构特征，单选 [${enumOptions(db, 'furniture_form')}]`;
  if (want('style_atom')) schema.style_main = `设计流派/风格（含四种木色），可多选数组（1-3个）[${enumOptions(db, 'style_atom')}]。严禁混搭、欧式轻奢、原木日式、日式、北欧、英式。拿不准给 other。`;
  if (want('classic_design')) schema.classic_design = `若为经典名品款名选一项，非名款给 other_classic 或 null [${enumOptions(db, 'classic_design')}]`;
  if (want('space')) schema.recommended_spaces = `推荐适用的室内空间，最多2个 [${enumOptions(db, 'space')}]`;
  if (want('flags')) schema.ai_generated = false;
  if (!only) {
    schema.has_watermark = false;
    schema.watermark_note = '';
  }
  const header = only
    ? `【本次只需输出这些维度：${[...only].join(', ')}。其余字段不要输出。】`
    : '';
  return `你是高端家具与软装单品设计师/买手鉴定器。只输出 JSON，不要 markdown。
本图为独立单品/家具设计参考。请识别其核心品类、材质、表面工艺、造型特征及风格流派，若为经典名品款名请识别。
dir 只能从枚举中选，拿不准给 null 或 0。
${header}
${JSON.stringify(schema, null, 2)}`;
}

const tagPrompt = tagSpacePrompt;

// 颜色提取：4bit/通道量化直方图 top3 -> 最近色板名
const COLOR_NAMES = [
  ['鼠尾草绿', 0x9c, 0xaF, 0x92], ['暖白', 0xF4, 0xF0, 0xE6], ['米杏', 0xE3, 0xD5, 0xC0],
  ['黄铜', 0xC5, 0xA0, 0x62], ['胡桃棕', 0x5C, 0x40, 0x33], ['橡木色', 0xC4, 0xA0, 0x76],
  ['微水泥灰', 0xB0, 0xAE, 0xA8], ['炭黑', 0x2A, 0x2C, 0x30], ['纯白', 0xFA, 0xFA, 0xF8],
  ['赤陶橙', 0xC0, 0x6A, 0x4E], ['洞石灰', 0xD8, 0xCF, 0xC0], ['黑色金属', 0x33, 0x35, 0x38],
  ['亚麻米', 0xD9, 0xCE, 0xB8], ['橄榄绿', 0x6B, 0x73, 0x55], ['大理石白', 0xEC, 0xEA, 0xE4],
  ['焦糖棕', 0x8B, 0x5A, 0x3C], ['深蓝灰', 0x3E, 0x4C, 0x5E], ['莫兰迪粉', 0xC9, 0xA9, 0xA3]
];
function nearestColorName(r, g, b) {
  let best = COLOR_NAMES[0], bd = Infinity;
  for (const [n, cr, cg, cb] of COLOR_NAMES) {
    const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
    if (d < bd) { bd = d; best = [n]; }
  }
  return best[0];
}

async function extractColors(buffer) {
  const { data, info } = await sharp(buffer).rotate().resize(128, 128, { fit: 'fill' })
    .raw().toBuffer({ resolveWithObject: true });
  const buckets = new Map();
  let valid = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    if (lum < 32 || lum > 248) continue;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    const e = buckets.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += r; e.g += g; e.b += b;
    buckets.set(key, e);
    valid++;
  }
  const total = valid || 1;
  return [...buckets.values()].sort((a, b) => b.n - a.n).slice(0, 3).map((e, i) => ({
    hex: '#' + [e.r / e.n, e.g / e.n, e.b / e.n].map(v => Math.round(v).toString(16).padStart(2, '0')).join(''),
    weight: +(e.n / total).toFixed(3),
    name: nearestColorName(e.r / e.n, e.g / e.n, e.b / e.n),
    role: ['main', 'secondary', 'accent'][i]
  }));
}

async function executeMaterialize(services, nodeConfig, asset) {
  const origPath = await ensureOriginalFile(services, asset);
  return {
    success: true,
    output: { originalPath: origPath, source: asset.source || 'quark' }
  };
}

async function persistQc(services, asset, origPath, runCtx = {}) {
  const isSandbox = Boolean(runCtx && runCtx.sandbox);
  const { db } = services;
  const origBuf = fs.readFileSync(origPath);
  const qc = await inspect(origBuf);
  const originOrientation = calculateOriginOrientation(qc.width, qc.height);
  let colors = [];
  let dominantColor = '灰';
  try {
    const { extractColorRoles } = require('../colors');
    if (!origBuf) throw new Error('skip_colors');
    const cr = await extractColorRoles(origBuf);
    if (cr && cr.colors && cr.colors.length) {
      colors = cr.colors;
      dominantColor = cr.dominantColor || '灰';
      if (!isSandbox) {
        const insColor = db.prepare('INSERT OR REPLACE INTO asset_colors (asset_fid, hex, role, weight, name, basic_color) VALUES (?, ?, ?, ?, ?, ?)');
        colors.forEach(c => insColor.run(asset.fid, c.hex, c.role, c.weight, c.name, c.basic || ''));
      }
    }
  } catch (e) {}

  if (!isSandbox) {
    db.prepare(`
      UPDATE assets SET width=?, height=?, orientation=?, origin_orientation=?, phash=?, dominant_color=?, updated_at=?
      WHERE fid=?
    `).run(qc.width, qc.height, qc.orientation, originOrientation, qc.phash, dominantColor, Date.now(), asset.fid);
  }

  const classified = classifyOrientation(qc.width, qc.height);
  return { origBuf, qc, originOrientation, colors, classified, originalPath: origPath };
}

async function executeQc(services, nodeConfig, asset, runCtx = {}) {
  const origPath = runCtx.lastOutput?.originalPath || await ensureOriginalFile(services, asset);
  const r = await persistQc(services, asset, origPath, runCtx);
  if (!runCtx?.sandbox) dbStatusQc(services.db, asset.fid);
  return {
    success: true,
    output: {
      originalPath: origPath,
      width: r.qc.width,
      height: r.qc.height,
      phash: r.qc.phash,
      originOrientation: r.originOrientation,
      aspectDisplay: r.classified.display,
      colors: r.colors
    }
  };
}

function dbStatusQc(db, fid) {
  // QC 通过 → 进入后续流水线环节，仍是中间态（2026-10-03 状态收敛：
  // 原先写 'qc'，而它也在列表白名单里，会让半成品被当成可用素材）
  db.prepare("UPDATE assets SET status=CASE WHEN status IN ('discovered','processing') THEN 'processing' ELSE status END, updated_at=? WHERE fid=?")
    .run(Date.now(), fid);
}

const INDUSTRIAL_NEGATIVE_PROMPT =
  'watermark, text, logo, words, branding, stamp, signature, username, timestamp, caption, typography, ui, bad quality, blurry, artifacts, noise, distorted, letterbox, pillarbox, black bars, white bars, blurred padding, empty borders, solid color borders';

/**
 * 画幅重构的负面提示词：**由参数生成，不写死在代码里**。
 *
 * 治理台可在 restage_dual 节点 config 里覆盖：
 *   negativeTokens   —— 覆盖负面 token 列表
 *   extraNegative    —— 追加额外负面词
 *   useBarConstraintInPrompt=false —— 关掉 prompt 里的强约束句（只靠 negative 通道）
 * 这样不同模型可以各自调参，不必改代码。
 */
function buildRestageNegative(nodeConfig) {
  const base = restageNegativePrompt({
    negativeTokens: nodeConfig.negativeTokens,
    extraNegative: nodeConfig.extraNegative,
  });
  // 节点配置里直接给了 negativePrompt 就用它
  const explicit = String(nodeConfig.negativePrompt || '').trim();
  if (explicit) return explicit;
  // 否则用参数化生成的 + 工业场景英文补充（两者都是 token 列表，模型友好）
  return `${base}, ${INDUSTRIAL_NEGATIVE_PROMPT}`;
}

async function resolveRestageRef(services, asset, runCtx) {
  const { db, config } = services;
  const hasWatermark = asset.has_watermark === 1 || !!runCtx?.lastOutput?.hasWatermark;

  // 1. 若资产带有水印，强制优先使用已生成的 clean 去水印衍生图，杜绝大模型临摹水印
  if (hasWatermark) {
    const cleanDeriv = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind='clean' ORDER BY id DESC LIMIT 1").get(asset.fid);
    if (cleanDeriv) {
      const { resolveDerivativeFile } = require('../derivatives');
      const p = await resolveDerivativeFile(services, cleanDeriv);
      if (p && fs.existsSync(p)) return p;
    }
  }

  // 2. 尝试从流水线上下文或缓存原图读取
  const fromOrig = runCtx?.lastOutput?.originalPath;
  if (fromOrig && fs.existsSync(fromOrig)) return fromOrig;
  try {
    const orig = await ensureOriginalFile(services, asset);
    if (orig && fs.existsSync(orig)) return orig;
  } catch { /* fall through */ }

  // 3. 兜底尝试 clean 衍生图
  const fallbackClean = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind='clean' ORDER BY id DESC LIMIT 1").get(asset.fid);
  if (fallbackClean) {
    const { resolveDerivativeFile } = require('../derivatives');
    const p = await resolveDerivativeFile(services, fallbackClean);
    if (p && fs.existsSync(p)) return p;
  }

  const origDir = path.join(config.dataDir, 'cache', 'originals');
  const ext = path.extname(asset.file_name || '.jpg') || '.jpg';
  const fallback = path.join(origDir, `${asset.fid}${ext}`);
  if (fs.existsSync(fallback)) return fallback;
  return null;
}

// ---------------- 1. GateNode ----------------
async function executeGate(services, nodeConfig = {}, asset = {}, runCtx = {}) {
  const { db, config, logger } = services;
  const isSandbox = Boolean(runCtx && runCtx.sandbox);

  // 预置防御 1：黑名单素材拦截（宽容入库后由工作流判定移入垃圾站）
  try {
    const { isBlacklisted, itemKeyOf } = require('../assets-delete');
    if (isBlacklisted(db, { sha256: asset.sha256, itemKey: itemKeyOf(asset.file_name, asset.size), clientAssetId: asset.client_asset_id })) {
      logger?.info?.(`[gate] 资产命中黑名单，移入垃圾站: fid=${asset.fid}`);
      if (!isSandbox) {
        try {
          const gw = require('../gateway');
          gw.markRejected(services, asset.fid, {
            reason: 'blacklisted',
            fileName: asset.file_name,
            detail: { message: '该素材已被删除并加入黑名单', model: 'gate_blacklist' }
          });
        } catch (_) {}
      }
      return {
        success: true,
        excluded: true,
        category: 'none',
        reason: '该素材已被删除并加入黑名单',
        rejectReason: 'blacklisted',
        output: { excluded: true, category: 'none', reason: '该素材已被删除并加入黑名单', rejectReason: 'blacklisted' }
      };
    }
  } catch (_) {}

  // 预置防御 2：检测截图/UI与调试文件（仅打标预警，绝不移入垃圾站，确保全量直存且立即可见）
  const fn = String(asset.file_name || '');
  if (/^(screen[_-]|current_screen|install_ui|ml_debug|screencap_test)/i.test(fn) || /^Screenshot_/i.test(fn) || /_emu\.png$/i.test(fn)) {
    logger?.info?.(`[gate] 资产检测为截图/UI，保留在库并打标预警: fid=${asset.fid} name=${fn}`);
    if (!isSandbox) {
      try {
        db.prepare("UPDATE assets SET status='ready', category='interior', error_note='检测为截图/UI素材(保留在库)', updated_at=? WHERE fid=?")
          .run(Date.now(), asset.fid);
      } catch (_) {}
    }
    return {
      success: true,
      excluded: false,
      category: 'interior',
      flags: ['screenshot_ui'],
      output: { passed: true, category: 'interior', is_screenshot: true }
    };
  }

  const thumbPath = path.join(config.dataDir, 'cache', 'thumbs', `${asset.fid}.jpg`);

  let dataUrl = '';
  if (fs.existsSync(thumbPath)) {
    const buf = fs.readFileSync(thumbPath);
    dataUrl = `data:image/jpeg;base64,${buf.toString('base64')}`;
  } else {
    let thumbBuf = null;

    // 1. 尝试使用网盘原始 thumb_url
    if (asset.thumb_url) {
      try {
        const res = await fetch(asset.thumb_url, { signal: AbortSignal.timeout(10000) });
        if (res.ok) {
          thumbBuf = Buffer.from(await res.arrayBuffer());
        }
      } catch (e) {
        // 缩略图签名过期 403 或网络波动，平滑回退
      }
    }

    // 2. 若 thumb_url 403 过期失效，优先取本地 NAS 或 cache/originals 已有原图生成缩略图
    if (!thumbBuf) {
      const { findCachedOriginal } = require('../originals');
      const localOrig = findCachedOriginal(config, asset.fid);
      if (localOrig && fs.existsSync(localOrig)) {
        try {
          thumbBuf = await sharp(localOrig).rotate().resize(512, 512, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
        } catch (e) {
          // sharp 缩图失败记录
        }
      }
    }

    // 严禁 Gate 现场同步调用夸克拉取超大原图：避免子进程风暴与超时雪崩
    if (!thumbBuf) {
      return {
        success: false,
        requeue: true,
        backoffMs: 30000,
        error: '缩略图链接失效(HTTP 403)且本地暂无原图，挂起等待原图落盘',
        output: { skipped: true, reason: 'thumb_missing_and_no_local_orig' }
      };
    }

    fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
    fs.writeFileSync(thumbPath, thumbBuf);
    dataUrl = `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;
  }

  const vlmCfg = resolveActiveVlmConfig(db, config, nodeConfig.model);

  let gateImages = [dataUrl];
  if (isVideoAsset(asset)) {
    const origDir = path.join(config.dataDir, 'cache', 'originals');
    const origGuess = ['.mp4', '.mov', '.webm', '.mkv'].map((ext) => path.join(origDir, `${asset.fid}${ext}`)).find((p) => fs.existsSync(p));
    const videoFrames = await visionImagesForAsset(services, asset, { origPath: origGuess, thumbDataUrl: dataUrl });
    if (videoFrames.length) gateImages = videoFrames;
  }

  // 统一从提示词编译引擎获取门禁提示词（消除旧 gateway_config 表静默覆盖 Bug）
  const { compileNodePrompt } = require('../prompt-compiler');
  const compiledGate = compileNodePrompt(db, {
    mountPointId: 'ingest_pre_gate',
    nodeType: 'gate',
    promptId: nodeConfig.promptId || 'gate_interior',
    promptTemplate: nodeConfig.promptTemplate || null,
    modelId: nodeConfig.model,
  });

  const gate = await chatVisionWithRetry({
    ...vlmCfg,
    prompt: compiledGate.prompt || gatePrompt(),
    images: gateImages
  }, nodeConfig, logger);

  const { routeGate } = require('../gate-route');
  const decision = routeGate(gate);
  if (!decision.keep) {
    // 宽容直存：AI 判定非素材时，仅打上建议标记，绝不自动移入垃圾站、绝不置为 rejected！
    const reasonText = decision.reason;
    const categoryText = decision.category;
    const verdictText = reasonText || categoryText || 'AI 闸门判定该图非典型室内素材（已保留在「室内外设计」）';
    logger?.info?.(`[gate] 资产建议非核心素材，保留在「室内外设计」: fid=${asset.fid} reason=${verdictText}`);
    if (!isSandbox) {
      try {
        db.prepare("UPDATE assets SET status='ready', category=COALESCE(NULLIF(category, ''), 'interior'), error_note=?, updated_at=? WHERE fid=?")
          .run(verdictText, Date.now(), asset.fid);
      } catch (_) {}
    }
    return {
      success: true,
      excluded: false,
      category: 'interior',
      flags: ['gate_suggest_non_material'],
      output: { passed: true, category: 'interior', reason: verdictText, non_material_suggested: true }
    };
  }

  const validCategory = decision.category;
  let categoryLocked = false;
  try {
    const cols = db.prepare('PRAGMA table_info(assets)').all();
    if (!cols.some((c) => c.name === 'category_locked')) {
      db.exec('ALTER TABLE assets ADD COLUMN category_locked INTEGER DEFAULT 0');
    }
    categoryLocked = !!db.prepare('SELECT category_locked FROM assets WHERE fid=?').get(asset.fid)?.category_locked;
  } catch (_) {}
  if (!isSandbox) {
    const finalCategory = (validCategory && validCategory !== 'none') ? validCategory : 'interior';
    if (categoryLocked) {
      db.prepare("UPDATE assets SET status='ready', updated_at=? WHERE fid=?").run(Date.now(), asset.fid);
    } else {
      db.prepare("UPDATE assets SET status='ready', category=?, updated_at=? WHERE fid=?")
        .run(finalCategory, Date.now(), asset.fid);
    }
  }

  return {
    success: true,
    excluded: false,
    output: { passed: true, category: validCategory }
  };
}

// ---------------- 2. TagNode ----------------
async function executeTagSpace(services, nodeConfig, asset, runCtx = {}) {
  const { db, config, logger } = services;

  let origPath = runCtx.lastOutput?.originalPath;
  let qc = null;
  let origBuf = null;
  let colors = runCtx.lastOutput?.colors || null;
  let originOrientation = runCtx.lastOutput?.originOrientation;

  if (!origPath || !fs.existsSync(origPath) || !runCtx.lastOutput?.phash) {
    origPath = await ensureOriginalFile(services, asset);
    if (!isVideoAsset(asset, origPath)) {
      const persisted = await persistQc(services, asset, origPath);
      qc = persisted.qc;
      colors = persisted.colors;
      originOrientation = persisted.originOrientation;
    } else {
      qc = { width: asset.width, height: asset.height, phash: asset.phash };
    }
  } else {
    qc = {
      width: runCtx.lastOutput.width || asset.width,
      height: runCtx.lastOutput.height || asset.height,
      phash: runCtx.lastOutput.phash || asset.phash
    };
  }

  let tagImages = [];
  if (isVideoAsset(asset, origPath)) {
    tagImages = await visionImagesForAsset(services, asset, { origPath });
    if (tagImages[0]) {
      const firstPath = path.join(config.dataDir, 'cache', 'temp', `ref1024_${asset.fid}.jpg`);
      const m = String(tagImages[0]).match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        fs.mkdirSync(path.dirname(firstPath), { recursive: true });
        fs.writeFileSync(firstPath, Buffer.from(m[2], 'base64'));
      }
    }
  } else {
    origBuf = fs.readFileSync(origPath);
    const tagBuf = await sharp(origBuf).rotate().resize(1024, 1024, { fit: 'inside' })
      .jpeg({ quality: 85 }).toBuffer();
    const temp1024Path = path.join(config.dataDir, 'cache', 'temp', `ref1024_${asset.fid}.jpg`);
    fs.mkdirSync(path.dirname(temp1024Path), { recursive: true });
    fs.writeFileSync(temp1024Path, tagBuf);
    tagImages = [`data:image/jpeg;base64,${tagBuf.toString('base64')}`];
  }
  if (!tagImages.length) {
    throw new Error('打标缺少可用画面（图片或视频帧）');
  }

  // 6. VLM 打标（通过 compileNodePrompt 实时展开 {{@dict.xxx}} 动态标签词典芯片）
  const { compileNodePrompt, expandDictMacros } = require('../prompt-compiler');
  const videoTags = require('../video-tags');
  const videoAsset = isVideoAsset(asset, origPath);
  const keepParentScene = videoAsset && videoTags.parentHasSceneTags(db, asset.parent_fid);
  let onlyDims = runCtx.dictRetag?.dimensions || nodeConfig.onlyDimensions || require('../library-schema').dimensionsFor('interior_design', 'primary');
  if (videoAsset && !runCtx.dictRetag?.dimensions && !nodeConfig.onlyDimensions) {
    onlyDims = keepParentScene ? [] : videoTags.sceneDimsForCategory(asset.category);
  }
  const noteLine = videoTags.sourceNoteLine(db, asset.fid);
  let resolvedSpacePrompt = '';
  if (runCtx.dictRetag?.dimensions) {
    resolvedSpacePrompt = tagSpacePrompt(db, onlyDims);
  } else if (!videoAsset || onlyDims.length) {
    const compiledTag = compileNodePrompt(db, {
      mountPointId: 'ingest_post_process',
      nodeType: 'tag',
      category: 'interior',
      promptId: nodeConfig.promptId || 'tag_space_interior',
      promptTemplate: nodeConfig.promptTemplate ? expandDictMacros(db, nodeConfig.promptTemplate) : null,
      modelId: nodeConfig.model,
    });
    // 若自定义模板未包含枚举词典且长度过短（历史残缺模板），自动回退至完整动态词典拼装
    if (!videoAsset && compiledTag.prompt && (compiledTag.prompt.includes('living_room') || compiledTag.prompt.length > 400 || nodeConfig.forceCustomPrompt)) {
      resolvedSpacePrompt = compiledTag.prompt;
    } else {
      resolvedSpacePrompt = tagSpacePrompt(db, onlyDims);
    }
  }
  if (noteLine) resolvedSpacePrompt += noteLine;
  const vlmCfg = resolveActiveVlmConfig(db, config, nodeConfig.model);
  let tags = {};
  if (videoAsset && !keepParentScene && onlyDims.length) {
    const frameTags = [];
    for (const img of tagImages) {
      try {
        frameTags.push(await chatVisionWithRetry({
          ...vlmCfg,
          prompt: resolvedSpacePrompt,
          images: [img],
        }, nodeConfig, logger));
      } catch (err) {
        logger?.warn?.(`[tag] 视频帧打标失败 ${asset.fid}: ${err.message}`);
      }
    }
    const voted = videoTags.voteSceneTags(frameTags);
    tags = {
      space: voted.space,
      style_main: voted.style_main.length ? voted.style_main : ['other'],
      style_confidence: frameTags.length ? 0.7 : 0.4,
    };
    if (onlyDims.includes('material_kind')) {
      const hard = [];
      const soft = [];
      for (const frame of frameTags) {
        for (const item of frame?.materials_hard || []) if (!hard.includes(item)) hard.push(item);
        for (const item of frame?.materials_soft || []) if (!soft.includes(item)) soft.push(item);
      }
      tags.materials_hard = hard.slice(0, 2);
      tags.materials_soft = soft.slice(0, 2);
    }
  } else if (!videoAsset) {
    tags = await chatVisionWithRetry({
      ...vlmCfg,
      prompt: resolvedSpacePrompt,
      images: tagImages
    }, nodeConfig, logger);
  }
  if (videoAsset && !videoTags.purposeLocked(db, asset.fid)) {
    try {
      const purpose = await chatVisionWithRetry({
        ...vlmCfg,
        prompt: videoTags.purposePrompt(),
        images: tagImages.slice(0, 4),
      }, nodeConfig, logger);
      if (purpose?.video_purpose) videoTags.applyVideoPurpose(db, asset.fid, purpose.video_purpose, 'ai');
    } catch (err) {
      logger?.warn?.(`[tag] 视频用途打标失败 ${asset.fid}: ${err.message}`);
    }
  }

  // 7. 写入 asset_tags (遵守 source=human 保护 + 维度范围替换)
  const { logAssetTagHistory } = require('../tag-governance');
  const histRows = [];
  const resolveTag = (dim, val) => {
    if (!val || typeof val !== 'string') return null;
    const direct = db.prepare('SELECT id, dir, label FROM tag_dict WHERE dimension=? AND (dir=? OR label=?)').get(dim, val, val);
    if (direct) return direct;
    // 别名匹配
    const rows = db.prepare('SELECT id, dir, label, aliases FROM tag_dict WHERE dimension=? AND deprecated=0').all(dim);
    for (const r of rows) {
      let aliases = [];
      try { aliases = r.aliases ? JSON.parse(r.aliases) : []; } catch { aliases = []; }
      if (aliases.includes(val)) return { id: r.id, dir: r.dir, label: r.label };
    }
    return null;
  };

  const clearAiTagsOnDim = (dim) => {
    const existing = db.prepare(`
      SELECT at.tag_id, at.role, at.source, t.dir, t.label
      FROM asset_tags at JOIN tag_dict t ON t.id = at.tag_id
      WHERE at.asset_fid=? AND t.dimension=? AND (at.source IS NULL OR at.source NOT IN ('human', 'manual'))
    `).all(asset.fid, dim);
    if (!existing.length) return;
    for (const e of existing) {
      histRows.push({
        asset_fid: asset.fid, tag_id: e.tag_id, dimension: dim, dir: e.dir, label: e.label,
        action: 'remove', old_value: e.dir, source: 'ai', run_id: runCtx.runId || null
      });
      db.prepare('DELETE FROM asset_tags WHERE asset_fid=? AND tag_id=?')
        .run(asset.fid, e.tag_id);
    }
  };

  const applyTag = (dim, val, confidence = 0.85, source = 'ai', role = null) => {
    const t = resolveTag(dim, val);
    if (!t) return;
    const human = db.prepare(`
      SELECT 1 FROM asset_tags at JOIN tag_dict td ON td.id = at.tag_id
      WHERE at.asset_fid=? AND td.dimension=? AND at.source IN ('human', 'manual') LIMIT 1
    `).get(asset.fid, dim);
    if (human) return;
    const prev = db.prepare(`
      SELECT t2.dir FROM asset_tags at JOIN tag_dict t2 ON t2.id=at.tag_id
      WHERE at.asset_fid=? AND at.tag_id=? AND (at.role IS ? OR (at.role IS NULL AND ? IS NULL))
    `).get(asset.fid, t.id, role, role);
    db.prepare(`
      INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_fid, tag_id, role) DO UPDATE SET confidence=excluded.confidence, source=excluded.source, updated_at=excluded.updated_at
    `).run(asset.fid, t.id, role, source, confidence, Date.now());
    histRows.push({
      asset_fid: asset.fid, tag_id: t.id, dimension: dim, dir: t.dir, label: t.label,
      action: prev ? 'update' : 'add',
      old_value: prev?.dir || null,
      new_value: t.dir,
      source,
      run_id: runCtx.runId || null
    });
  };

  const conf = typeof tags.style_confidence === 'number' ? tags.style_confidence : 0.85;
  const dimTouched = (d) => !onlyDims || onlyDims.includes(d);

  if (dimTouched('space')) {
    clearAiTagsOnDim('space');
    if (tags.space) applyTag('space', tags.space, conf);
  }
  if (dimTouched('style_atom') || dimTouched('wood_style')) {
    clearAiTagsOnDim('style_atom');
    clearAiTagsOnDim('wood_style');
    const rawStyles = Array.isArray(tags.style_main) ? tags.style_main
      : (tags.style_main ? [tags.style_main] : []);
    if (tags.wood_style && !rawStyles.includes(tags.wood_style)) {
      rawStyles.push(tags.wood_style);
    }
    const styles = rawStyles
      .map((v) => {
        let t = resolveTag('style_atom', v);
        if (!t && (v === 'natural_wood' || v === 'dark_wood' || v === 'natural_vintage_wood' || v === 'dark_vintage_wood')) {
          t = resolveTag('style_atom', v);
        }
        return t ? t.dir : null;
      })
      .filter(Boolean)
      .filter((v) => v !== 'eclectic_other'); // 彻底剔除混搭

    const uniqueStyles = [...new Set(styles)].slice(0, 4);
    // 风格字段严禁为空！有明确叶子采用，无任何有效匹配则落入 other (其他风格)
    if (!uniqueStyles.length) {
      applyTag('style_atom', 'other', conf);
    } else {
      for (const dir of uniqueStyles) applyTag('style_atom', dir, conf);
    }
  }

  if (dimTouched('material_kind')) {
    const hardMats = Array.isArray(tags.materials_hard) ? [...tags.materials_hard] : [];
    const softMats = Array.isArray(tags.materials_soft) ? [...tags.materials_soft] : [];
    if (Array.isArray(tags.materials) && !hardMats.length && !softMats.length) {
      for (const m of tags.materials) {
        if (HARD_MATERIALS.has(m)) hardMats.push(m);
        else if (SOFT_MATERIALS.has(m)) softMats.push(m);
      }
    }
    const toDir = (v) => {
      const t = resolveTag('material_kind', v);
      return t ? t.dir : null;
    };
    clearAiTagsOnDim('material_kind');
    hardMats.map(toDir).filter(d => d && HARD_MATERIALS.has(d)).slice(0, 2)
      .forEach(v => applyTag('material_kind', v, conf, 'ai', 'main'));
    softMats.map(toDir).filter(d => d && SOFT_MATERIALS.has(d)).slice(0, 2)
      .forEach(v => applyTag('material_kind', v, conf, 'ai', 'accent'));
  }

  // 主色只保留质检色板，不写 VLM / 色系标签
  let dominantColor = null;
  try {
    const { extractColorRoles } = require('../colors');
    if (!origBuf) throw new Error('skip_colors');
    const cr = await extractColorRoles(origBuf);
    if (cr && cr.colors && cr.colors.length) {
      dominantColor = cr.dominantColor || null;
      const existingColors = db.prepare('SELECT 1 FROM asset_colors WHERE asset_fid=? LIMIT 1').get(asset.fid);
      if (!existingColors) {
        const insC = db.prepare('INSERT OR REPLACE INTO asset_colors (asset_fid, hex, role, weight, name, basic_color) VALUES (?, ?, ?, ?, ?, ?)');
        for (const c of cr.colors) {
          const basic = (c.role === 'main' && dominantColor) ? dominantColor : (c.basic || '');
          insC.run(asset.fid, c.hex, c.role, c.weight, c.name || '', basic);
        }
      } else if (!dominantColor) {
        const row = db.prepare("SELECT basic_color FROM asset_colors WHERE asset_fid=? AND role='main' LIMIT 1").get(asset.fid);
        dominantColor = row?.basic_color || null;
      }
      colors = cr.colors;
    }
  } catch (e) { /* colors optional */ }

  if (dominantColor) {
    const cur = db.prepare('SELECT dominant_color FROM assets WHERE fid=?').get(asset.fid);
    if (!cur || !cur.dominant_color) {
      db.prepare('UPDATE assets SET dominant_color=? WHERE fid=?').run(dominantColor, asset.fid);
    }
  }

  if (histRows.length) {
    try { logAssetTagHistory(db, histRows); } catch (e) { console.warn('[tag] history write fail', e.message); }
  }

  // 更新水印状态；资产仍处流水线中间态（原 'tagging_done' 是零数据僵尸状态，
  // 流程末尾会统一置为 ready，这里只需标记处理中）
  if (!onlyDims) {
    db.prepare(`
      UPDATE assets SET has_watermark=?, watermark_note=?, status='processing', updated_at=?
      WHERE fid=?
    `).run(tags.has_watermark ? 1 : 0, tags.watermark_note || '', Date.now(), asset.fid);
  } else {
    db.prepare('UPDATE assets SET updated_at=? WHERE fid=?').run(Date.now(), asset.fid);
  }

  let clusterOut = null;
  if (!nodeConfig.skipCluster) {
    clusterOut = executeClusterLogic(services, nodeConfig, asset, {
      phash: qc.phash,
      width: qc.width,
      height: qc.height,
      colors
    });
  }

  try {
    const domColor = Array.isArray(colors) ? colors[0] : (colors || null);
    db.prepare('UPDATE assets SET dominant_color = COALESCE(?, dominant_color), status = ? WHERE fid = ?')
      .run(domColor, 'processing', asset.fid);
  } catch (_) {}

  return {
    success: true,
    output: {
      tags,
      hasWatermark: !!tags.has_watermark,
      watermarkNote: tags.watermark_note,
      originalPath: origPath,
      originOrientation,
      width: qc.width,
      height: qc.height,
      phash: qc.phash,
      dupGroupId: clusterOut?.dupGroupId || null,
      matchReason: clusterOut?.matchReason || null
    }
  };
}

async function executeTagFurniture(services, nodeConfig, asset, runCtx = {}) {
  const { db, config, logger } = services;

  let origPath = runCtx.lastOutput?.originalPath;
  let qc = null;
  let origBuf = null;
  let colors = runCtx.lastOutput?.colors || null;
  let originOrientation = runCtx.lastOutput?.originOrientation;

  if (!origPath || !fs.existsSync(origPath) || !runCtx.lastOutput?.phash) {
    origPath = await ensureOriginalFile(services, asset);
    if (!isVideoAsset(asset, origPath)) {
      const persisted = await persistQc(services, asset, origPath);
      qc = persisted.qc;
      colors = persisted.colors;
      originOrientation = persisted.originOrientation;
    } else {
      qc = { width: asset.width, height: asset.height, phash: asset.phash };
    }
  } else {
    qc = {
      width: runCtx.lastOutput.width || asset.width,
      height: runCtx.lastOutput.height || asset.height,
      phash: runCtx.lastOutput.phash || asset.phash
    };
  }

  let tagImages = [];
  if (isVideoAsset(asset, origPath)) {
    tagImages = await visionImagesForAsset(services, asset, { origPath });
  } else {
    origBuf = fs.readFileSync(origPath);
    const tagBuf = await sharp(origBuf).rotate().resize(1024, 1024, { fit: 'inside' })
      .jpeg({ quality: 85 }).toBuffer();
    const temp1024Path = path.join(config.dataDir, 'cache', 'temp', `ref1024_furn_${asset.fid}.jpg`);
    fs.mkdirSync(path.dirname(temp1024Path), { recursive: true });
    fs.writeFileSync(temp1024Path, tagBuf);
    tagImages = [`data:image/jpeg;base64,${tagBuf.toString('base64')}`];
  }
  if (!tagImages.length) {
    throw new Error('家具打标缺少可用画面（图片或视频帧）');
  }

  const { compileNodePrompt } = require('../prompt-compiler');
  const compiledFurn = compileNodePrompt(db, {
    mountPointId: 'ingest_post_process',
    nodeType: 'tag_furniture',
    category: 'furniture',
    promptId: 'tag_furniture',
    promptTemplate: nodeConfig.tagType === 'furniture' ? nodeConfig.promptTemplate : null,
    modelId: nodeConfig.model,
  });
  const furnPrompt = (compiledFurn.prompt && compiledFurn.prompt.length > 200)
    ? compiledFurn.prompt
    : tagFurniturePrompt(db, require('../library-schema').dimensionsFor('furniture', 'all'));
  const vlmCfg = resolveActiveVlmConfig(db, config, compiledFurn.modelId || nodeConfig.model);
  const tags = await chatVisionWithRetry({
    ...vlmCfg,
    prompt: furnPrompt,
    images: tagImages
  }, nodeConfig, logger);

  const resolveTag = (dim, val) => {
    if (!val || typeof val !== 'string') return null;
    return db.prepare('SELECT id, dir FROM tag_dict WHERE dimension=? AND (dir=? OR label=?)').get(dim, val, val);
  };
  const applyTag = (dim, val, confidence = 0.85, source = 'ai', role = null) => {
    const t = resolveTag(dim, val);
    if (!t) return;
    const human = db.prepare(`
      SELECT 1 FROM asset_tags at JOIN tag_dict td ON td.id = at.tag_id
      WHERE at.asset_fid=? AND td.dimension=? AND at.source IN ('human', 'manual') LIMIT 1
    `).get(asset.fid, dim);
    if (human) return;
    db.prepare(`
      INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_fid, tag_id, role) DO UPDATE SET confidence=excluded.confidence, source=excluded.source, updated_at=excluded.updated_at
    `).run(asset.fid, t.id, role, source, confidence, Date.now());
  };

  if (tags.furniture_category) applyTag('furniture_category', tags.furniture_category, 0.9);
  if (tags.furniture_item) applyTag('furniture_item', tags.furniture_item, 0.9);

  // 单品材质双轨：主体材质 role='main'，配件/五金 role='accent'
  const hardMatsFurn = Array.isArray(tags.materials_hard) ? [...tags.materials_hard] : [];
  const softMatsFurn = Array.isArray(tags.materials_soft) ? [...tags.materials_soft] : [];
  if (Array.isArray(tags.materials) && !hardMatsFurn.length && !softMatsFurn.length) {
    for (const m of tags.materials) {
      if (HARD_MATERIALS.has(m)) hardMatsFurn.push(m);
      else softMatsFurn.push(m);
    }
  }
  hardMatsFurn.forEach(v => applyTag('material_kind', v, 0.85, 'ai', 'main'));
  softMatsFurn.forEach(v => applyTag('material_kind', v, 0.85, 'ai', 'accent'));

  (Array.isArray(tags.furniture_craft) ? tags.furniture_craft : []).forEach(v => applyTag('furniture_craft', v, 0.85));
  if (tags.furniture_form) applyTag('furniture_form', tags.furniture_form, 0.85);
  const furnStyles = (Array.isArray(tags.style_main) ? tags.style_main : (tags.style_main ? [tags.style_main] : []))
    .concat(tags.wood_style ? [tags.wood_style] : [])
    .filter((v) => v !== 'eclectic_other');
  const resolvedFurnStyles = [...new Set(furnStyles.map((v) => resolveTag('style_atom', v)?.dir).filter(Boolean))].slice(0, 4);
  if (!resolvedFurnStyles.length) {
    applyTag('style_atom', 'other', 0.85);
  } else {
    resolvedFurnStyles.forEach((v) => applyTag('style_atom', v, 0.85));
  }
  if (tags.classic_design && tags.classic_design !== 'other_classic') {
    applyTag('classic_design', tags.classic_design, 0.9);
  }
  (Array.isArray(tags.recommended_spaces) ? tags.recommended_spaces : []).forEach(v => applyTag('recommended_space', v, 0.75));
  if (tags.ai_generated === true) applyTag('flags', 'ai_generated', 0.9, 'derived');

  const VALID_DOMINANT = ['白', '米/奶油', '原木/木色', '灰', '黑', '红', '粉', '橙', '黄', '绿', '蓝', '紫'];
  let dominantColor = (tags.dominant_color && VALID_DOMINANT.includes(String(tags.dominant_color).trim())) ? String(tags.dominant_color).trim() : null;

  try {
    const { extractColorRoles } = require('../colors');
    if (!origBuf) throw new Error('skip_colors');
    const cr = await extractColorRoles(origBuf);
    if (cr && cr.colors && cr.colors.length) {
      if (!dominantColor) dominantColor = cr.dominantColor;
      db.prepare('DELETE FROM asset_colors WHERE asset_fid=?').run(asset.fid);
      const insC = db.prepare('INSERT OR REPLACE INTO asset_colors (asset_fid, hex, role, weight, name, basic_color) VALUES (?, ?, ?, ?, ?, ?)');
      for (const c of cr.colors) {
        const basic = (c.role === 'main' && dominantColor) ? dominantColor : (c.basic || '');
        insC.run(asset.fid, c.hex, c.role, c.weight, c.name || '', basic);
      }
      const map = {
        '黑白灰极简': 'mono_minimal', '原木日系': 'wood_japandi', '大地侘寂': 'earth_wabi',
        '莫兰迪低饱和': 'morandi', '奶油马卡龙': 'cream_macaron', '暖色调': 'warm_tone',
        '冷色调': 'cool_tone', '高饱和撞色': 'high_sat_clash',
      };
      for (const st of cr.colorStyles || []) {
        if (map[st]) applyTag('color_style', map[st], 0.9, 'derived');
      }
      colors = cr.colors;
    }
  } catch (e) {}

  if (!dominantColor) dominantColor = '灰';
  db.prepare('UPDATE assets SET dominant_color=? WHERE fid=?').run(dominantColor, asset.fid);

  db.prepare(`
    UPDATE assets SET has_watermark=?, watermark_note=?, status='processing', updated_at=?
    WHERE fid=?
  `).run(tags.has_watermark ? 1 : 0, tags.watermark_note || '', Date.now(), asset.fid);

  let clusterOut = null;
  if (!nodeConfig.skipCluster) {
    clusterOut = executeClusterLogic(services, nodeConfig, asset, {
      phash: qc.phash,
      width: qc.width,
      height: qc.height,
      colors
    });
  }

  return {
    success: true,
    output: {
      tags,
      isFurniture: true,
      hasWatermark: !!tags.has_watermark,
      watermarkNote: tags.watermark_note,
      originalPath: origPath,
      originOrientation,
      width: qc.width,
      height: qc.height,
      phash: qc.phash,
      dupGroupId: clusterOut?.dupGroupId || null,
      matchReason: clusterOut?.matchReason || null
    }
  };
}

function tagPortraitPrompt(db) {
  const schema = {
    gender: `性别，单选 [${enumOptions(db, 'gender')}]`,
    person_style: `人物气质风格，可多选字符串数组，最多2个 [${enumOptions(db, 'person_style')}]`,
    shot_type: `景别构图，单选 [${enumOptions(db, 'shot_type')}]`,
  };
  return `你是人像摄影与虚拟数字人素材标注器。只输出 JSON，不要 markdown。
本图为人物肖像/人像素材，请识别其性别、人物气质风格（温婉、大方、干练、知性、甜美、酷飒、国风）和景别。不要打主色。
dir 只能从枚举中选，拿不准给 null。
${JSON.stringify(schema, null, 2)}`;
}

function tagClothingPrompt(db) {
  const schema = {
    clothing_category: `服装大类/细分，单选 [${enumOptions(db, 'clothing_category')}]`,
    clothing_style: `穿搭风格，可多选字符串数组，最多2个 [${enumOptions(db, 'clothing_style')}]`,
    season: `适穿季节，单选 [${enumOptions(db, 'season')}]`,
    dominant_color: `服装主体视觉主色，单选 [${enumOptions(db, 'dominant_color')}]`
  };
  return `你是时尚穿搭与服装单品买手标注器。只输出 JSON，不要 markdown。
本图为服装单品或模特穿搭展示，请识别其服装品类、风格、季节与主色。
dir 只能从枚举中选，拿不准给 null。
${JSON.stringify(schema, null, 2)}`;
}

async function executeTagPortrait(services, nodeConfig, asset, runCtx = {}) {
  const { db, config, logger } = services;
  let origPath = runCtx.lastOutput?.originalPath;
  let qc = null;
  let colors = runCtx.lastOutput?.colors || null;
  let originOrientation = runCtx.lastOutput?.originOrientation;

  if (!origPath || !fs.existsSync(origPath) || !runCtx.lastOutput?.phash) {
    origPath = await ensureOriginalFile(services, asset);
    const persisted = await persistQc(services, asset, origPath);
    qc = persisted.qc;
    colors = persisted.colors;
    originOrientation = persisted.originOrientation;
  } else {
    qc = {
      width: runCtx.lastOutput.width || asset.width,
      height: runCtx.lastOutput.height || asset.height,
      phash: runCtx.lastOutput.phash || asset.phash
    };
  }

  const origBuf = fs.readFileSync(origPath);
  const tagBuf = await sharp(origBuf).rotate().resize(1024, 1024, { fit: 'inside' })
    .jpeg({ quality: 85 }).toBuffer();
  const tagImages = [`data:image/jpeg;base64,${tagBuf.toString('base64')}`];

  const { compileNodePrompt } = require('../prompt-compiler');
  const compiledPort = compileNodePrompt(db, {
    mountPointId: 'ingest_post_process',
    nodeType: 'tag_portrait',
    category: 'portrait',
    promptId: 'tag_portrait',
    promptTemplate: nodeConfig.tagType === 'portrait' ? nodeConfig.promptTemplate : null,
    modelId: nodeConfig.model,
  });
  const portPrompt = (compiledPort.prompt && compiledPort.prompt.includes('gender'))
    ? compiledPort.prompt
    : tagPortraitPrompt(db);
  const vlmCfg = resolveActiveVlmConfig(db, config, compiledPort.modelId || nodeConfig.model);
  const tags = await chatVisionWithRetry({
    ...vlmCfg,
    prompt: portPrompt,
    images: tagImages
  }, nodeConfig, logger);

  const { logAssetTagHistory } = require('../tag-governance');
  const histRows = [];
  const resolveTag = (dim, val) => {
    if (!val || typeof val !== 'string') return null;
    const direct = db.prepare('SELECT id, dir, label FROM tag_dict WHERE dimension=? AND (dir=? OR label=?)').get(dim, val, val);
    if (direct) return direct;
    const rows = db.prepare('SELECT id, dir, label, aliases FROM tag_dict WHERE dimension=? AND deprecated=0').all(dim);
    for (const r of rows) {
      let aliases = [];
      try { aliases = r.aliases ? JSON.parse(r.aliases) : []; } catch { aliases = []; }
      if (aliases.includes(val)) return { id: r.id, dir: r.dir, label: r.label };
    }
    return null;
  };

  const applyTag = (dim, val, confidence = 0.85, source = 'ai', role = null) => {
    const t = resolveTag(dim, val);
    if (!t) return;
    const human = db.prepare(`
      SELECT 1 FROM asset_tags at JOIN tag_dict td ON td.id = at.tag_id
      WHERE at.asset_fid=? AND td.dimension=? AND at.source IN ('human', 'manual') LIMIT 1
    `).get(asset.fid, dim);
    if (human) return;
    db.prepare(`
      INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_fid, tag_id, role) DO UPDATE SET confidence=excluded.confidence, source=excluded.source, updated_at=excluded.updated_at
    `).run(asset.fid, t.id, role, source, confidence, Date.now());
    histRows.push({
      asset_fid: asset.fid, tag_id: t.id, dimension: dim, dir: t.dir, label: t.label,
      action: 'add', new_value: t.dir, source, run_id: runCtx.runId || null
    });
  };

  if (tags.gender) applyTag('gender', tags.gender, 0.9);
  if (Array.isArray(tags.person_style)) {
    for (const s of tags.person_style) applyTag('person_style', s, 0.85);
  } else if (tags.person_style) {
    applyTag('person_style', tags.person_style, 0.85);
  }
  if (tags.shot_type) applyTag('shot_type', tags.shot_type, 0.85);
  if (tags.dominant_color) applyTag('dominant_color', tags.dominant_color, 0.85);
  if (originOrientation) applyTag('orientation', originOrientation, 1.0, 'rule');

  logAssetTagHistory(db, histRows);

  let clusterOut = null;
  try {
    clusterOut = executeClusterLogic(services, nodeConfig, asset, {
      phash: qc.phash,
      width: qc.width,
      height: qc.height,
      colors
    });
  } catch (err) {
    logger.warn(`[tag_portrait] 聚类判定失败: ${err.message}`);
  }

  return {
    success: true,
    output: {
      tags,
      width: qc.width,
      height: qc.height,
      phash: qc.phash,
      dupGroupId: clusterOut?.dupGroupId || null,
      matchReason: clusterOut?.matchReason || null
    }
  };
}

async function executeTagClothing(services, nodeConfig, asset, runCtx = {}) {
  const { db, config, logger } = services;
  let origPath = runCtx.lastOutput?.originalPath;
  let qc = null;
  let colors = runCtx.lastOutput?.colors || null;
  let originOrientation = runCtx.lastOutput?.originOrientation;

  if (!origPath || !fs.existsSync(origPath) || !runCtx.lastOutput?.phash) {
    origPath = await ensureOriginalFile(services, asset);
    const persisted = await persistQc(services, asset, origPath);
    qc = persisted.qc;
    colors = persisted.colors;
    originOrientation = persisted.originOrientation;
  } else {
    qc = {
      width: runCtx.lastOutput.width || asset.width,
      height: runCtx.lastOutput.height || asset.height,
      phash: runCtx.lastOutput.phash || asset.phash
    };
  }

  const origBuf = fs.readFileSync(origPath);
  const tagBuf = await sharp(origBuf).rotate().resize(1024, 1024, { fit: 'inside' })
    .jpeg({ quality: 85 }).toBuffer();
  const tagImages = [`data:image/jpeg;base64,${tagBuf.toString('base64')}`];

  const { compileNodePrompt } = require('../prompt-compiler');
  const compiledCloth = compileNodePrompt(db, {
    mountPointId: 'ingest_post_process',
    nodeType: 'tag_clothing',
    category: 'clothing',
    promptId: 'tag_clothing',
    promptTemplate: nodeConfig.tagType === 'clothing' ? nodeConfig.promptTemplate : null,
    modelId: nodeConfig.model,
  });
  const clothPrompt = (compiledCloth.prompt && compiledCloth.prompt.includes('clothing_category'))
    ? compiledCloth.prompt
    : tagClothingPrompt(db);
  const vlmCfg = resolveActiveVlmConfig(db, config, compiledCloth.modelId || nodeConfig.model);
  const tags = await chatVisionWithRetry({
    ...vlmCfg,
    prompt: clothPrompt,
    images: tagImages
  }, nodeConfig, logger);

  const { logAssetTagHistory } = require('../tag-governance');
  const histRows = [];
  const resolveTag = (dim, val) => {
    if (!val || typeof val !== 'string') return null;
    const direct = db.prepare('SELECT id, dir, label FROM tag_dict WHERE dimension=? AND (dir=? OR label=?)').get(dim, val, val);
    if (direct) return direct;
    const rows = db.prepare('SELECT id, dir, label, aliases FROM tag_dict WHERE dimension=? AND deprecated=0').all(dim);
    for (const r of rows) {
      let aliases = [];
      try { aliases = r.aliases ? JSON.parse(r.aliases) : []; } catch { aliases = []; }
      if (aliases.includes(val)) return { id: r.id, dir: r.dir, label: r.label };
    }
    return null;
  };

  const applyTag = (dim, val, confidence = 0.85, source = 'ai', role = null) => {
    const t = resolveTag(dim, val);
    if (!t) return;
    const human = db.prepare(`
      SELECT 1 FROM asset_tags at JOIN tag_dict td ON td.id = at.tag_id
      WHERE at.asset_fid=? AND td.dimension=? AND at.source IN ('human', 'manual') LIMIT 1
    `).get(asset.fid, dim);
    if (human) return;
    db.prepare(`
      INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(asset_fid, tag_id, role) DO UPDATE SET confidence=excluded.confidence, source=excluded.source, updated_at=excluded.updated_at
    `).run(asset.fid, t.id, role, source, confidence, Date.now());
    histRows.push({
      asset_fid: asset.fid, tag_id: t.id, dimension: dim, dir: t.dir, label: t.label,
      action: 'add', new_value: t.dir, source, run_id: runCtx.runId || null
    });
  };

  if (tags.clothing_category) applyTag('clothing_category', tags.clothing_category, 0.9);
  if (Array.isArray(tags.clothing_style)) {
    for (const s of tags.clothing_style) applyTag('clothing_style', s, 0.85);
  } else if (tags.clothing_style) {
    applyTag('clothing_style', tags.clothing_style, 0.85);
  }
  if (tags.season) applyTag('season', tags.season, 0.85);
  if (tags.dominant_color) applyTag('dominant_color', tags.dominant_color, 0.85);
  if (originOrientation) applyTag('orientation', originOrientation, 1.0, 'rule');

  logAssetTagHistory(db, histRows);

  let clusterOut = null;
  try {
    clusterOut = executeClusterLogic(services, nodeConfig, asset, {
      phash: qc.phash,
      width: qc.width,
      height: qc.height,
      colors
    });
  } catch (err) {
    logger.warn(`[tag_clothing] 聚类判定失败: ${err.message}`);
  }

  return {
    success: true,
    output: {
      tags,
      width: qc.width,
      height: qc.height,
      phash: qc.phash,
      dupGroupId: clusterOut?.dupGroupId || null,
      matchReason: clusterOut?.matchReason || null
    }
  };
}

async function executeTag(services, nodeConfig, asset, runCtx = {}) {
  const currentCategory = asset.category || runCtx.lastOutput?.category || 'interior';
  if (currentCategory === 'finished' || currentCategory === 'music') {
    return { success: true, skipped: true, output: { skipped: true, reason: 'no_auto_tag' } };
  }
  if (String(runCtx.trigger || '').endsWith(':manual')) {
    return { success: true, skipped: true, output: { skipped: true, reason: 'manual_upload' } };
  }
  if (currentCategory === 'portrait') {
    return executeTagPortrait(services, nodeConfig, asset, runCtx);
  }
  if (currentCategory === 'clothing') {
    return executeTagClothing(services, nodeConfig, asset, runCtx);
  }
  if (currentCategory === 'furniture' || nodeConfig.tagType === 'furniture') {
    return executeTagFurniture(services, nodeConfig, asset, runCtx);
  }
  return executeTagSpace(services, nodeConfig, asset, runCtx);
}

function executeClusterLogic(services, nodeConfig, asset, extras = {}) {
  // CONFLICT-002：重复组概念已退役。cluster 工作流节点退化为空操作，
  // 保持输出形状兼容（dupGroupId/matchReason 恒空），流水线不再归组。
  return { dupGroupId: null, matchReason: null };
}

async function executeCluster(services, nodeConfig, asset, runCtx = {}) {
  // CONFLICT-002：重复组退役，cluster 节点恒为空操作，memberCount/members 恒空以兼容旧客户端
  const out = executeClusterLogic(services, nodeConfig, asset, {
    phash: runCtx.lastOutput?.phash,
    width: runCtx.lastOutput?.width,
    height: runCtx.lastOutput?.height,
    colors: runCtx.lastOutput?.colors
  });
  return {
    success: true,
    output: {
      ...out,
      memberCount: 0,
      members: []
    }
  };
}

async function executeBackup(services, nodeConfig, asset) {
  if (nodeConfig.enabled === false) {
    return { success: true, skipped: true, output: { skipped: true, reason: 'node_disabled' } };
  }
  try {
    const r = await backupAsset(services, asset);
    return { success: true, skipped: !!r.skipped, output: r };
  } catch (e) {
    return {
      success: true,
      nonFatal: true,
      flags: ['backup_failed'],
      error: e.message,
      output: { backup: false, error: e.message }
    };
  }
}

// ---------------- 3. CleanNode ----------------
async function executeClean(services, nodeConfig, asset, runCtx) {
  const { db, config, logger } = services;
  const { shouldAutoRestage } = require('../gate-route');
  if (!shouldAutoRestage(asset.category || runCtx?.lastOutput?.category)) {
    return { success: true, skipped: true, reason: 'clean_only_interior', output: { clean: false, skipped: true } };
  }
  // 若无水印，直接跳过
  if (!asset.has_watermark && !runCtx.lastOutput?.hasWatermark) {
    return { success: true, skipped: true, reason: 'no_watermark' };
  }

  const adapterId = nodeConfig.adapterId === 'builtin_none' ? 'unified_gateway' : nodeConfig.adapterId;
  if (!adapterId || adapterId === 'builtin_clean_stub') {
    return {
      success: true,
      nonFatal: true,
      flags: ['clean_skipped_no_adapter'],
      output: { clean: false, reason: '未配置去水印适配器' }
    };
  }

  const adapter = db.prepare('SELECT * FROM gen_adapters WHERE id=? AND enabled=1').get(adapterId);
  if (!adapter) {
    return {
      success: true,
      nonFatal: true,
      flags: ['clean_failed'],
      error: `去水印适配器 ${adapterId} 不可用`
    };
  }

  // 统一网关未配置真实 URL 时明确降级
  if (adapter.protocol === 'unified_gateway') {
    const { isGatewayConfigured } = require('../process');
    if (!isGatewayConfigured(adapter)) {
      return {
        success: true,
        nonFatal: true,
        flags: ['clean_skipped_no_adapter'],
        output: { clean: false, reason: '统一处理网关未配置' }
      };
    }
  }

  try {
    const origDir = path.join(config.dataDir, 'cache', 'originals');
    const ext = path.extname(asset.file_name || '.jpg') || '.jpg';
    const localCached = path.join(origDir, `${asset.fid}${ext}`);

    const res = await executeAdapter(services, adapter, {
      kind: 'image',
      gpuPriority: 'low',
      imageLocalPaths: [localCached],
      prompt: 'remove watermark from interior design photo',
      extras: adapter.protocol === 'unified_gateway'
        ? { action: 'watermark_remove', params: {}, fid: asset.fid, file_name: asset.file_name }
        : {}
    });

    if (res.ok && res.files?.[0]?.localPath) {
      const deriv = await createDerivative(services, {
        assetFid: asset.fid,
        kind: 'clean',
        srcPath: res.files[0].localPath,
        fileName: `clean_${asset.file_name || 'image.jpg'}`,
        mime: res.files[0].mime || 'image/jpeg',
        params: { adapterId }
      });
      return { success: true, derivative: deriv, output: { clean: true, derivativeId: deriv.id } };
    }
    throw new Error('去水印服务未返回产物文件');
  } catch (e) {
    logger?.warn?.(`[clean] 资产 ${asset.fid} 去水印异常，降级回退原图: ${e.message}`);
    return {
      success: true,
      nonFatal: true,
      flags: ['clean_failed'],
      error: e.message,
      output: { clean: false, fallback: 'origin' }
    };
  }
}

// ---------------- 4. Restage9x16Node ----------------
async function executeRestage9x16(services, nodeConfig, asset, runCtx) {
  const { db, config, logger } = services;
  const { shouldAutoRestage } = require('../gate-route');
  if (!shouldAutoRestage(asset.category || runCtx?.lastOutput?.category)) {
    return {
      success: true,
      skipped: true,
      reason: 'manual_library',
      output: { skipped: true, reason: '只有室内和室外自动画幅重构' }
    };
  }

  // 0. 视频素材无需进行图片画幅重构，安全跳过
  if (isVideoAsset(asset)) {
    return {
      success: true,
      skipped: true,
      reason: 'video_skip_restage',
      output: { skipped: true, reason: '视频素材无需执行图片画幅重构' }
    };
  }

  // 1. 检查画幅跳过规则 (height / width >= 1.70)
  if (asset.width > 0 && asset.height > 0) {
    const classified = classifyOrientation(asset.width, asset.height);
    if (classified.bucket === '9:16' && nodeConfig.skipIfVertical !== false) {
      return {
        success: true,
        skipped: true,
        reason: 'already_9_16_vertical',
        output: { skipped: true, ratio: classified.ratio, bucket: classified.bucket }
      };
    }
  }

  // 2. 检查适配器 (若指定适配器未启用或未配置，安全跳过构图回退原图)
  //    ★ 级联多组模型回退：挂载点里勾选的模型链优先，备用本地 Qwen，以及所有启用的 image 适配器全量兜底
  const adapterId = nodeConfig.adapterId;
  const imageAdapters = db.prepare("SELECT * FROM gen_adapters WHERE kind='image' AND enabled=1").all();
  const fallback = imageAdapters.find(a => a.id === 'qwenimage_local') || db.prepare("SELECT * FROM gen_adapters WHERE id=? AND enabled=1").get('qwenimage_local');
  const primary = adapterId ? imageAdapters.find(a => a.id === adapterId) : null;
  const modelChain = buildModelChain(nodeModelIds(nodeConfig), imageAdapters);
  let chain = modelChain.map((c) => ({ adapter: c.adapter, model: c.model }));
  if (!chain.length) {
    if (primary) chain.push({ adapter: primary, model: cfgDefaultModel(primary) });
    if (fallback && !chain.some(c => c.adapter.id === fallback.id)) chain.push({ adapter: fallback, model: cfgDefaultModel(fallback) });
  }
  for (const a of imageAdapters) {
    if (!chain.some(c => c.adapter.id === a.id)) {
      chain.push({ adapter: a, model: cfgDefaultModel(a) });
    }
  }
  if (!chain.length) {
    logger?.info?.(`[restage_9_16] 无可用生图适配器，跳过重构图回退原图`);
    return {
      success: true,
      nonFatal: true,
      flags: ['restage_skipped_no_adapter'],
      output: { restaged: false, fallback: 'origin' }
    };
  }

  const refPath = await resolveRestageRef(services, asset, runCtx);
  if (!refPath) {
    return {
      success: true,
      nonFatal: true,
      flags: ['restage_failed_no_ref'],
      error: '缺少参考图本地文件',
      output: { restaged: false }
    };
  }

  const prompt = restagePromptForRatio('9:16', nodeConfig.promptTemplate, asset.category || 'interior', {
    negativeTokens: nodeConfig.negativeTokens,
    extraNegative: nodeConfig.extraNegative,
    useBarConstraintInPrompt: nodeConfig.useBarConstraintInPrompt,
  });
  const negativePrompt = buildRestageNegative(nodeConfig);

  try {
    // 级联多组模型回退：逐条通道尝试，某条失败自动切下一条通道
    let genFile = null;
    let usedAdapterId = chain[0] ? chain[0].adapter.id : '';
    let lastErr = null;
    for (const cand of chain) {
      if (!cand || !cand.adapter) continue;
      const candAdapter = cand.adapter;
      const candModel = cand.model || nodeConfig.model || cfgDefaultModel(candAdapter);
      try {
        const res = await executeAdapter(services, candAdapter, {
          kind: 'image',
          mode: 'ref',
          gpuPriority: 'low',
          prompt,
          negativePrompt,
          model: candModel,
          ratio: '9:16',
          size: agnesSizeForPreset(nodeConfig.sizePreset || '1080p'),
          imageLocalPaths: [refPath]
        });
        if (res.ok && res.files?.[0]?.localPath) {
          genFile = res.files[0];
          usedAdapterId = candAdapter.id;
          break;
        }
        lastErr = new Error((res && res.error) || '生图服务未返回产物文件');
      } catch (e) {
        lastErr = e;
      }
      logger?.info?.(`[restage_9_16] 资产 ${asset.fid} 通道 ${candAdapter.id} 未能产出(${lastErr?.message || ''})，切换下一通道`);
    }
    if (!genFile) throw lastErr || new Error('生图服务未返回产物文件');

    {
      const file = genFile;
      const sizePreset = nodeConfig.sizePreset || '1080p';
      // ★ 出图后直接复制字节落盘，禁止旋转重编码、禁止缩放、禁止裁切
      let outMeta = { width: null, height: null };
      try { outMeta = await sharp(file.localPath, { failOn: 'none' }).metadata(); } catch (_) {}
      const deriv = await createDerivative(services, {
        assetFid: asset.fid,
        kind: 'restage_9_16',
        srcPath: file.localPath,
        fileName: `restage_9_16_${asset.file_name || 'image.jpg'}`,
        width: outMeta.width,
        height: outMeta.height,
        mime: 'image/jpeg',
        params: { adapterId: usedAdapterId, model: nodeConfig.model, prompt, generated: true, calibrated: false, strategy: 'raw_byte_copy', ratio: '9:16', sizePreset }
      });

      // 设为主图
      setMainDerivative(db, asset.fid, deriv.id);

      return {
        success: true,
        derivative: deriv,
        output: { restaged: true, derivativeId: deriv.id }
      };
    }
  } catch (e) {
    logger?.warn?.(`[restage_9_16] 资产 ${asset.fid} 生图失败，降级回退原图: ${e.message}`);
    return {
      success: true,
      nonFatal: true,
      flags: ['restage_failed'],
      error: e.message,
      output: { restaged: false, fallback: 'origin' }
    };
  }
}

// ---------------- 4. RestageDualNode (AI 双画幅 3:4 & 9:16 无水印重构) ----------------

/** 休眠等待（可被 SIGINT 打断） */
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * 偶发性错误判定 —— 这类错误退避后重试通常能恢复，不该把任务留在异常态。
 *
 * 血泪教训一：Agnes 的 401「无效令牌」和 429「速率限制」其实都是
 * 上游网关异常（TLS 握手失败）的**伪装**。按字面语义处理会得出
 * 「令牌失效/额度耗尽」的错误结论，实际退避重试就能恢复。
 *
 * 血泪教训二：LiteLLM 的 `No deployments available` **不是**「模型没部署」。
 * 实测 litellm :4000 上 workflow_vision 有 17 个 deployment、workflow_vision_low 有 7 个，
 * 配置齐全。报这个错只是那一瞬间 17 个全被并发占满（LiteLLM 的 RPM/TPM 冷却），
 * 等几十秒就恢复。vlm.chatVision 本身已有「高优先池满 → 打低优先池」的降级。
 * 把它划进确定性错误会导致治理台把可恢复的任务当成死局，反而催人反复重试。
 */
function isTransientErrorText(text) {
  const s = String(text || '');
  if (!s) return false;
  // 池满/无配额是典型瞬时，必须放行（且要在确定性短路之前）
  if (poolFullErrorText(s)) return true;
  // 语义确定性的「假瞬时」在这里短路。逃生舱只给「网关伪装」这一类：
  // 带 free_tier 字样但根因是网络抖动 —— 这类要放行给偶发规则。
  const gatewayMasquerade = /free_tier/i.test(s)
    && /401|429|无效的令牌|Invalid token|速率限制|rate_limit/i.test(s);
  if (isDeterministicErrorText(s) && !gatewayMasquerade) return false;
  return /fetch failed|ECONNRESET|ECONNREFUSED|socket disconnected|other side closed|aborted due to timeout|超时|timeout|ETIMEDOUT|EAI_AGAIN|429|401|无效的令牌|Invalid token|速率限制|rate.?limit|500|502|503|504|InternalServerError|队列已满|queue is full|network|Bad Gateway|Service Unavailable/i.test(s);
}

/** 池满 / 无可用配额 —— 与 vlm.js 的 poolFullError 同义，治理台与流水线必须同一把尺子 */
function poolFullErrorText(s) {
  return /No deployments available|no available deployment|queue is full|image queue|队列已满|HTTP 429|HTTP 503|HTTP 403|leaked|free[_ ]?tier/i.test(String(s || ''));
}

/**
 * 确定性错误：重试多少次都是同样结果，只能靠改配置/改数据解决。
 * 注意：free_tier / 403 等已移至可回退范畴，不列为直接终止的确定性死锁
 */
function isDeterministicErrorText(text) {
  const s = String(text || '');
  if (!s) return false;
  // 带请求号或 JSON error 的 401「无效的令牌」是钥匙被拒，重试整批不会变。没有这段正文的 401 仍按瞬时处理。
  if (/HTTP\s*401\b/.test(s) && /无效的令牌|Invalid token/i.test(s) && (/request[_ ]?id/i.test(s) || /AgnesAI_error/i.test(s) || /"error"\s*:/.test(s))) return true;
  if (/file size limit|文件超出?大小限制|超过大小限制|payload too large|413\b/i.test(s)) return true;
  if (/缺少可用画面|无有效画面|缺少画面/i.test(s)) return true;
  // 代码级 ReferenceError / TypeError：重一万次也是同样报错，只能改代码
  if (/is not defined|ReferenceError|TypeError|Cannot read propert/i.test(s)) return true;
  return /对应资产记录不存在|文件找不到|未配置|无适配器|unsupported|参数错误|400\b|资产已删除|已拉黑/i.test(s);
}

/** 本地通道自带重试价值更高（不受云端限流约束），多给几次机会 */
function isTransientAdapterError(adapterId) {
  return String(adapterId || '') === 'qwenimage_local';
}

/** 退避时长：1s → 4s → 12s（上限 30s），带抖动避免同批任务同时重试 */
function transientBackoffMs(attempt) {
  const base = Math.min(30000, 1000 * (4 ** Math.max(0, attempt - 1)));
  return base + Math.floor(Math.random() * Math.min(2000, base * 0.3));
}

/**
 * VLM 调用统一退避重试。
 *
 * 为什么必须有：workflow_vision 是 17 个 deployment 轮转的共享池，
 * 跑批并发一上来就可能一瞬间全被占满，LiteLLM 直接回
 * `429 No deployments available`。这不是「模型没部署」，等几十秒就好。
 * vlm.chatVision 内部已有「高优先池满 → 打低优先池（7 个）」的单次降级，
 * 但低优先池也可能同时满 —— 没有外层退避，任务就永久停在 failed，
 * 只能靠人点重试。实测 10-02 一夜之间因此积压了 200+ 条 tag 失败。
 */
/**
 * VLM 调用的统一退避重试。
 *
 * 与 chatVision 内部降级链的分工（两者叠加，不是重复）：
 *   chatVision      —— 单次尝试内「换模型组」（主 → agnes → low → image_input）
 *   chatVisionWithRetry —— 跨尝试「等配额恢复后再打」（指数退避 + 抖动）
 *
 * 重试次数必须收紧：降级链已有 4 组，外层若仍重试 3 次，
 * 最坏情况 = 4 组 × 3 次 × 90s 超时 ≈ 18 分钟，远超流水线可接受范围。
 * 因此默认只重试 2 次（配合降级链共 3 轮），并对单组超时收紧。
 */
async function chatVisionWithRetry(opts, nodeConfig = {}, logger = null) {
  // 降级链已提供 4 组候选，外层只需 2 次重试即覆盖「等配额恢复」场景
  const maxTry = Math.max(1, Math.min(3, Number(nodeConfig.retryTimes) || 2));
  const baseTimeout = Number(opts && opts.timeoutMs) || 90000;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxTry; attempt++) {
    try {
      // 第 2 轮起适度放宽超时：配额恢复后首个请求常偏慢
      return await chatVision(attempt === 1 ? opts : { ...opts, timeoutMs: Math.round(baseTimeout * 1.2) });
    } catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e || '');
      const transient = isTransientErrorText(msg) || poolFullErrorText(msg);
      if (!transient || attempt >= maxTry) break;
      const waitMs = transientBackoffMs(attempt);
      try {
        logger?.warn?.(`[vlm] 第 ${attempt}/${maxTry} 次失败(${msg.slice(0, 80)})，${Math.round(waitMs / 1000)}s 后重试`);
      } catch (_) {}
      await sleep(waitMs);
    }
  }
  throw lastErr || new Error('VLM 调用失败');
}

/** 适配器配置里的默认模型（qwenimage 本地无「模型」概念，留空即可） */
function cfgDefaultModel(adapter) {
  try {
    const cfg = typeof adapter.config_json === 'string'
      ? JSON.parse(adapter.config_json) : (adapter.config_json || {});
    return cfg.defaultModel || adapter.default_model || '';
  } catch {
    return adapter.default_model || '';
  }
}

/**
 * ★ 多模型挂载 → 生图通道候选链
 *
 * 挂载点里可以一次挂多个模型（主模型 + 降级备选）。这里把每个模型**反查**到自己的适配器，
 * 组成「主 → 备1 → 备2」的候选链；某条通道失败（确定性错误）就切下一条。
 *
 * 铁律：每条候选必须携带**自己的** model，绝不拿 A 模型的请求打到 B 适配器上
 * （Qwen 的 model_code 打到 Agnes 端点必 404）。
 *
 * @param {Array} modelIds 有序模型 id 列表（契约 id 或 model_code 均可）
 * @param {Array} imageAdapters 已启用的生图适配器行
 * @returns {Array<{adapter:object, model:string}>}
 */
function buildModelChain(modelIds, imageAdapters) {
  const out = [];
  const seen = new Set();
  let pickAdapterId = null;
  let resolveModelCode = null;
  try { ({ pickAdapterId } = require('../adapter-match')); } catch (_) {}
  try { ({ resolveModelCode } = require('../studio-catalog')); } catch (_) {}
  if (!pickAdapterId) return out;

  const adapters = Array.isArray(imageAdapters) ? imageAdapters : [];
  for (const raw of modelIds || []) {
    const modelId = String(raw || '').trim();
    if (!modelId) continue;
    const code = (resolveModelCode && resolveModelCode(modelId)) || modelId;
    const adapterId = pickAdapterId('image', code, adapters);
    if (!adapterId) continue;
    const adapter = adapters.find((a) => a && a.id === adapterId);
    if (!adapter) continue;
    const key = `${adapterId}::${code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ adapter, model: code });
  }
  return out;
}

/** 从 nodeConfig 里取出挂载的模型链（多选；老配置只有单值 model） */
function nodeModelIds(nodeConfig) {
  const ids = Array.isArray(nodeConfig?.modelIds) ? nodeConfig.modelIds : [];
  const out = ids.map((x) => String(x || '').trim()).filter(Boolean);
  if (!out.length && nodeConfig?.model) out.push(String(nodeConfig.model).trim());
  return out;
}

async function executeRestageDual(services, nodeConfig, asset, runCtx) {
  const { db, config, logger } = services;
  const { shouldAutoRestage } = require('../gate-route');
  // 自动灌入仍然只处理室内/室外，避免给服装、人像、家具库平白增加生图成本。
  // 但素材选择器里点「9:16 待生成」属于用户显式单次请求，这类请求必须放行到任何类目，
  // 否则插槽点了只会拿到 409（manual_library）。api.js 的 POST /assets/:fid/restage 会写死 forceMember=true。
  const manualRequest = nodeConfig?.forceMember === true;
  if (!manualRequest && !shouldAutoRestage(asset.category || runCtx?.lastOutput?.category)) {
    return {
      success: true,
      skipped: true,
      reason: 'manual_library',
      output: { restaged: false, skipped: true, reason: '只有室内和室外自动画幅重构' }
    };
  }

  // 0. 视频素材无需进行图片画幅重构，安全跳过
  if (isVideoAsset(asset)) {
    return {
      success: true,
      skipped: true,
      reason: 'video_skip_restage',
      output: { restaged: false, skipped: true, reason: '视频素材无需执行图片画幅重构' }
    };
  }

  // ── 决策 3（方案 A）：若与近 7 天同品类有效素材存在 1 <= pHash <= 6 的高相似连拍图，暂缓双画幅重构 ──
  const forceRestage = Boolean(nodeConfig?.forceRestage || runCtx?.forceRestage);
  if (!forceRestage && asset.phash && asset.phash.length >= 16) {
    const { hamming: hammingDistanceHex } = require('../qc');
    const { isVideoExtractStill } = require('../cluster');
    if (!isVideoExtractStill(asset)) {
      const currentCategory = asset.category || runCtx?.lastOutput?.category || 'interior';
      const sevenDaysAgo = (asset.created_at || Date.now()) - 7 * 86400 * 1000;
      const peers = db.prepare(`
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
      `).all(asset.fid, currentCategory, sevenDaysAgo);

      let ignoredSet = new Set();
      try {
        const rows = db.prepare(`
          SELECT fid_a, fid_b FROM similarity_ignored_pairs WHERE fid_a = ? OR fid_b = ?
        `).all(asset.fid, asset.fid);
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
        logger?.info?.(`[restage_dual] 疑似连拍暂缓生图 fid=${asset.fid} 与 ${hitPeerFid} 距离=${hitDist}`);
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

  // 2. 检查适配器 —— 区分「批量自动化免费重构」与「用户手动付费重构 (seedream5.0flash)」
  const imageAdapters = db.prepare("SELECT * FROM gen_adapters WHERE kind='image' AND enabled=1").all();
  const isManualRun = Boolean(
    runCtx?.isManual ||
    runCtx?.trigger?.includes('manual') ||
    runCtx?.trigger?.includes('retry') ||
    runCtx?.prevError ||
    nodeConfig?.isManual
  );

  const chain = [];
  const arkSeedream = imageAdapters.find(a => a.id === 'ark_seedream');
  const agnes = imageAdapters.find(a => a.id === 'agnes_image');
  const ms = imageAdapters.find(a => a.id === 'qwenimage_modelscope' || a.id === 'modelscope_image');
  const local = imageAdapters.find(a => a.id === 'qwenimage_local');

  if (isManualRun && arkSeedream) {
    // ★ 手动模式：用户在 AI 治理中心重试或手动点击重构，启用高质付费模型 Seedream 5.0 Flash
    logger?.info?.(`[restage_dual] 资产 ${asset.fid} 手动重构模式，优先启用付费高质 Seedream 5.0 Flash`);
    chain.push({ adapter: arkSeedream, model: 'doubao-seedream-5-0-flash-260915' });
  }

  // ★ 批量/自动入库模式：坚决不接入 NewAPI 高成本模型，严格走免费通道链
  if (agnes) chain.push({ adapter: agnes, model: cfgDefaultModel(agnes) });
  if (ms) chain.push({ adapter: ms, model: cfgDefaultModel(ms) });
  if (local) chain.push({ adapter: local, model: cfgDefaultModel(local) });

  // 若手动模式且尚未追加 Ark，则保底追加
  if (isManualRun && arkSeedream && !chain.some(c => c.adapter.id === arkSeedream.id)) {
    chain.push({ adapter: arkSeedream, model: 'doubao-seedream-5-0-flash-260915' });
  }
  const adapter = chain.find(Boolean) ? chain[0].adapter : null;
  if (!adapter) {
    logger?.info?.(`[restage_dual] 无可用生图适配器，跳过重构回退原图`);
    return {
      success: true,
      nonFatal: true,
      flags: ['restage_skipped_no_adapter'],
      output: { restaged: false, fallback: 'origin' }
    };
  }
  if (chain.length > 1) {
    logger?.info?.(`[restage_dual] 资产 ${asset.fid} 生图通道链: ${chain.map(c => `${c.adapter.id}(${c.model || '默认模型'})`).join(' → ')}`);
  }

  const refPath = await resolveRestageRef(services, asset, runCtx);
  if (!refPath) {
    return {
      success: true,
      nonFatal: true,
      flags: ['restage_failed_no_ref'],
      error: '缺少参考图本地文件',
      output: { restaged: false }
    };
  }

  const extraPrompt = String(nodeConfig.extraPrompt || '').trim();
  const { compileNodePrompt } = require('../prompt-compiler');
  const assetCat = asset.category || runCtx?.lastOutput?.category || 'interior';
  const compiledRestage = compileNodePrompt(db, {
    mountPointId: 'ingest_post_process',
    nodeType: 'restage_dual',
    category: assetCat,
    promptId: nodeConfig.promptId || (assetCat === 'furniture' ? 'restage_furniture_dual' : 'style_restage_dual'),
    promptTemplate: nodeConfig.promptTemplate || null,
    snippetIds: nodeConfig.snippetIds || (assetCat === 'furniture' ? ['snippet_furniture_studio', 'snippet_clean_border'] : ['snippet_interior_realism', 'snippet_clean_border']),
    modelId: nodeConfig.model || cfgDefaultModel(adapter),
    vars: {
      asset,
      extraNegative: nodeConfig.extraNegative || '',
    },
  });
  const promptBase = compiledRestage.prompt ||
    '以参考图为基准进行图生图净画重构，严格保持原有硬装几何结构、挑高层高、主体家具比例与整体色调光影不变，彻底消除边缘水印杂质。';
  const negativePrompt = compiledRestage.negativePrompt
    ? `${compiledRestage.negativePrompt}, ${buildRestageNegative(nodeConfig)}`
    : buildRestageNegative(nodeConfig);

  const ratios = Array.isArray(nodeConfig.ratios) && nodeConfig.ratios.length
    ? nodeConfig.ratios
    : ['9:16', '3:4'];
  const sizePreset = nodeConfig.sizePreset || '1080p';
  const skipExact = nodeConfig.skipIfAlreadyExact === true;
  const replaceExisting = nodeConfig.replaceExisting === true;
  const classified = classifyOrientation(asset.width, asset.height);
  const existing = getDerivatives(db, asset.fid);
  const results = {};
  const skipped = [];
  const genErrors = [];
  let requeue = false;
  let requeueError = null;
  const prevErr = runCtx?.prevError || null;

  for (const ratio of ratios) {
    const kind = kindForRatio(ratio);
    const already = findQualifiedKind(existing, kind);
    if (already && !replaceExisting) {
      skipped.push({ ratio, reason: 'already_generated' });
      results[kind] = { id: already.id, width: already.width, height: already.height, ratio, kind, reused: true };
      continue;
    }
    if (skipExact && classified.bucket === ratio && !asset.has_watermark) {
      skipped.push({ ratio, reason: 'already_exact' });
      continue;
    }
    let prompt = restagePromptForRatio(ratio, promptBase, assetCat, {
      negativeTokens: nodeConfig.negativeTokens,
      extraNegative: nodeConfig.extraNegative,
      useBarConstraintInPrompt: false,
    });
    if (extraPrompt) prompt = `${prompt} ${extraPrompt}`;
    const calDir = path.join(config.dataDir, 'cache', 'temp');
    fs.mkdirSync(calDir, { recursive: true });
    // ★ 核心修复：净画重构直接传清晰原图 refPath 做图生图，彻底砍掉 高斯模糊垫边画布函数 的 blur(28) 高斯模糊垫边！
    const composedPath = refPath;
    let genPath = null;
    let usedAdapterId = (chain[0] && chain[0].adapter.id) || adapter.id;
    let usedModel = '';
    let lastErrText = '';
    let hadQueueFull = false;
    let lastQueueFullError = null;
    try {
      // 级联多组通道尝试：每个通道内部对偶发错误做退避重试，
      // 当通道遇到 429/503 限流或故障时，记录后继续级联尝试下一个通道，绝不提前掐断回退链！
      for (const cand of chain) {
        if (!cand || !cand.adapter) continue;
        const candAdapter = cand.adapter;
        const candModel = cand.model || nodeConfig.model || cfgDefaultModel(candAdapter);
        const maxTry = isTransientAdapterError(candAdapter.id) ? (Number(nodeConfig.retryTimes) || 3) : 1;
        for (let attempt = 1; attempt <= maxTry; attempt++) {
          if (genPath) break;
          try {
            const res = await executeAdapter(services, candAdapter, {
              kind: 'image',
              mode: 'ref',
              gpuPriority: nodeConfig.gpuPriority || 'low',
              prompt,
              negativePrompt,
              model: candModel,
              ratio,
              width: pixelSizeFor(ratio, sizePreset).width,
              height: pixelSizeFor(ratio, sizePreset).height,
              size: agnesSizeForPreset(sizePreset),
              imageLocalPaths: [composedPath]
            });
            if (res.ok && res.files?.[0]?.localPath) {
              genPath = res.files[0].localPath;
              usedAdapterId = candAdapter.id;
              usedModel = candModel;
              if (attempt > 1) logger?.info?.(`[restage_dual] 资产 ${asset.fid} ${ratio} 经 ${candAdapter.id} 第 ${attempt} 次重试恢复`);
              break;
            }
            const errText = (res && res.error) || '生图服务未返回产物';
            lastErrText = errText;
            if (isQueueFullError(errText)) {
              hadQueueFull = true;
              lastQueueFullError = errText;
            }
            if (isTransientErrorText(errText) && attempt < maxTry) {
              const waitMs = transientBackoffMs(attempt);
              logger?.warn?.(`[restage_dual] 资产 ${asset.fid} ${ratio} ${candAdapter.id} 偶发失败(${attempt}/${maxTry})，${waitMs}ms 后重试: ${errText}`);
              await sleep(waitMs);
              continue;
            }
            genErrors.push(`${ratio}@${candAdapter.id}:${errText}`);
            break;
          } catch (e) {
            lastErrText = e.message;
            if (isQueueFullError(e)) {
              hadQueueFull = true;
              lastQueueFullError = e.message;
              logger?.warn?.(`[restage_dual] 资产 ${asset.fid} ${ratio} 通道 ${candAdapter.id} 队列满/限流(${e.message})，级联回退下一通道`);
              break;
            }
            if (isTransientErrorText(e.message) && attempt < maxTry) {
              const waitMs = transientBackoffMs(attempt);
              logger?.warn?.(`[restage_dual] 资产 ${asset.fid} ${ratio} ${candAdapter.id} 偶发异常(${attempt}/${maxTry})，${waitMs}ms 后重试: ${e.message}`);
              await sleep(waitMs);
              continue;
            }
            logger?.warn?.(`[restage_dual] 资产 ${asset.fid} 生成 ${ratio} 失败(${candAdapter.id}): ${e.message}`);
            genErrors.push(`${ratio}@${candAdapter.id}:${e.message}`);
            break;
          }
        }
        if (genPath) {
          logger?.info?.(`[restage_dual] 资产 ${asset.fid} ${ratio} 成功通过通道 ${candAdapter.id}(${candModel || 'default'}) 产出`);
          break;
        }
        logger?.info?.(`[restage_dual] 资产 ${asset.fid} ${ratio} 通道 ${candAdapter.id} 未能产出，级联切换下一通道`);
      }
      // 只有在所有通道遍历完毕后仍未产出，且遇到过 429/503 排队满时，才触发整体 requeue
      if (!genPath && hadQueueFull) {
        requeue = true;
        requeueError = lastQueueFullError || lastErrText;
      }
    } catch (e) {
      logger?.warn?.(`[restage_dual] 资产 ${asset.fid} 生成 ${ratio} 异常: ${e.message}`);
      genErrors.push(`${ratio}:${e.message}`);
      if (isQueueFullError(e)) {
        requeue = true;
        requeueError = e.message;
      }
    }
    if (!genPath) {
      genErrors.push(`${ratio}:未返回产物文件`);
      continue;
    }
    try {
      // ★ 核心修复：生图模型返回的图直接原样字节复制保存为衍生图，不做任何 sharp 重编码、旋转、缩放或裁切！
      let outMeta = { width: null, height: null };
      try { outMeta = await sharp(genPath, { failOn: 'none' }).metadata(); } catch (_) {}
      const pixels = pixelSizeFor(ratio, sizePreset);
      const deriv = await createDerivative(services, {
        assetFid: asset.fid,
        kind,
        srcPath: genPath,
        fileName: `${kind}_${asset.file_name || 'image.jpg'}`,
        width: outMeta.width || pixels.width,
        height: outMeta.height || pixels.height,
        mime: 'image/jpeg',
        params: {
          adapterId: usedAdapterId,
          // 记实际用的模型而不是节点配置：多模型挂载时两者可能不同
          model: usedModel || nodeConfig.model || '',
          prompt,
          negativePrompt,
          ratio,
          sizePreset,
          generated: true,
          recast: false,
          composed: false,
          calibrated: false,
          strategy: 'raw_byte_copy'
        }
      });
      if (replaceExisting) {
        try { markKindRecast(db, asset.fid, kind, deriv.id); } catch (_) {}
      }
      results[kind] = {
        id: deriv.id,
        width: deriv.width,
        height: deriv.height,
        ratio,
        kind,
        adapterId: usedAdapterId,
        model: usedModel || '',
      };
      existing.push(deriv);
    } catch (e) {
      logger?.warn?.(`[restage_dual] 资产 ${asset.fid} 写入 ${ratio} 衍生图失败: ${e.message}`);
      genErrors.push(`写入${ratio}:${e.message}`);
    }
  }

  const d916 = results.restage_9_16;
  const d34 = results.restage_3_4;
  const currentMain = asset.main_derivative_id
    ? existing.find(d => Number(d.id) === Number(asset.main_derivative_id))
    : null;
  if (d916?.id && !d916.reused && (!replaceExisting || !currentMain || currentMain.kind !== 'restage_3_4')) {
    setMainDerivative(db, asset.fid, d916.id);
  } else if (d34?.id && !d34.reused && currentMain && currentMain.kind === 'restage_3_4') {
    setMainDerivative(db, asset.fid, d34.id);
  }

  if (requeue) {
    const { attempt, ms, exhausted } = nextRestageBackoff(prevErr);
    if (exhausted) {
      return {
        success: false,
        error: `自动重试 ${attempt} 次仍失败，已停止排队：${requeueError || '生图队列持续不可用'}`.slice(0, 300),
        output: { restaged: Object.keys(results).some(k => !results[k].reused), derivatives: results, skipped, exhausted: true }
      };
    }
    return {
      success: false,
      requeue: true,
      backoffMs: ms,
      error: `requeue:503 attempt=${attempt} ${requeueError || ''}`.trim(),
      output: { restaged: Object.keys(results).some(k => !results[k].reused), derivatives: results, skipped, requeue: true }
    };
  }

  const produced = Object.values(results).filter(r => !r.reused);
  if (!produced.length && !skipped.length) {
    const detail = genErrors.length ? `; ${genErrors.slice(0, 4).join(' | ')}` : '';
    if (!isManualRun) {
      // 批量自动化入库时，免费通道若暂时限流或故障，不阻断入库、不报红异常，平滑回退原图待手动重构
      logger?.warn?.(`[restage_dual] 资产 ${asset.fid} 批量免费通道暂时未出图，平滑回退原图待手动重构: ${detail}`);
      return {
        success: true,
        nonFatal: true,
        flags: ['restage_free_exhausted'],
        output: { restaged: false, fallback: 'origin', free_tier_exhausted: true, genErrors }
      };
    }
    return {
      success: false,
      error: `未能生成任何画幅${detail}`.slice(0, 500),
      output: { restaged: false, derivatives: results, skipped, sizePreset, ratios, genErrors }
    };
  }

  const channels = {};
  for (const [kind, r] of Object.entries(results)) {
    if (r?.adapterId) channels[kind] = { adapterId: r.adapterId, model: r.model || '' };
  }
  if (!Object.keys(channels).length && usedAdapterId) {
    channels.default = { adapterId: usedAdapterId, model: usedModel || '' };
  }

  return {
    success: true,
    derivative: d916 && !d916.reused ? { id: d916.id } : null,
    output: {
      restaged: produced.length > 0,
      derivatives: results,
      mainDerivativeId: d916?.id || null,
      skipped,
      sizePreset,
      ratios,
      // 每一档实际走的通道与模型：手动请求要靠它确认没被降级到本机免费模型
      channels,
      refPath
    }
  };
}

// ---------------- 5. IndexNode ----------------
async function executeIndex(services, nodeConfig, asset, runCtx) {
  const { db, config, logger } = services;

  // 1. 组装富语义描述特征文本
  const tags = db.prepare(`
    SELECT t.dimension, t.label FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid = ?
  `).all(asset.fid);

  const tagMap = {};
  tags.forEach(t => {
    if (!tagMap[t.dimension]) tagMap[t.dimension] = [];
    tagMap[t.dimension].push(t.label);
  });

  const parts = [];
  const currentCategory = asset.category || 'interior';
  if (currentCategory === 'clothing') {
    parts.push('类别:服装');
    if (tagMap.clothing_category) parts.push(`类目:${tagMap.clothing_category.join(',')}`);
    if (tagMap.clothing_silhouette) parts.push(`版型:${tagMap.clothing_silhouette.join(',')}`);
    if (tagMap.clothing_fabric) parts.push(`面料:${tagMap.clothing_fabric.join(',')}`);
    if (tagMap.clothing_scene) parts.push(`场景:${tagMap.clothing_scene.join(',')}`);
    if (asset.dominant_color) parts.push(`主色:${asset.dominant_color}`);
  } else if (currentCategory === 'portrait') {
    parts.push('类别:人像');
    if (tagMap.pose) parts.push(`姿态:${tagMap.pose.join(',')}`);
    if (tagMap.character) parts.push(`角色:${tagMap.character.join(',')}`);
    if (tagMap.shot_type) parts.push(`景别:${tagMap.shot_type.join(',')}`);
    if (asset.dominant_color) parts.push(`主色:${asset.dominant_color}`);
  } else if (currentCategory === 'material') {
    parts.push('类别:材质纹理');
  } else if (currentCategory === 'exterior') {
    parts.push('类别:室外建筑');
  } else if (currentCategory === 'furniture') {
    parts.push('类别:独立家具单品');
    if (tagMap.furniture_category) parts.push(`大类:${tagMap.furniture_category.join(',')}`);
    if (tagMap.furniture_item) parts.push(`品类:${tagMap.furniture_item.join(',')}`);
    if (tagMap.classic_design) parts.push(`名款:${tagMap.classic_design.join(',')}`);
    if (tagMap.furniture_craft) parts.push(`工艺:${tagMap.furniture_craft.join(',')}`);
    if (tagMap.furniture_form) parts.push(`造型:${tagMap.furniture_form.join(',')}`);
    if (tagMap.space) parts.push(`推荐空间:${tagMap.space.join(',')}`);
  } else {
    parts.push('类别:室内设计空间');
    if (tagMap.space) parts.push(`空间:${tagMap.space.join(',')}`);
    if (tagMap.region) parts.push(`地域:${tagMap.region.join(',')}`);
    if (tagMap.tone) parts.push(`调性:${tagMap.tone.join(',')}`);
    if (tagMap.lighting) parts.push(`光线:${tagMap.lighting.join(',')}`);
    if (tagMap.view_composition) parts.push(`景别:${tagMap.view_composition.join(',')}`);
    if (tagMap.view_angle) parts.push(`视角:${tagMap.view_angle.join(',')}`);
  }
  if (tagMap.style_atom) parts.push(`风格:${tagMap.style_atom.join(',')}`);
  if (tagMap.material_kind) parts.push(`材质:${tagMap.material_kind.join(',')}`);
  if (tagMap.color_style) parts.push(`色系:${tagMap.color_style.join(',')}`);
  if (tagMap.flags) parts.push(`标记:${tagMap.flags.join(',')}`);
  if (asset.file_name) parts.push(`文件:${asset.file_name}`);

  const caption = parts.join(' ') || (currentCategory === 'furniture' ? '独立家具软装单品设计素材' : '室内设计现代空间素材');

  const configuredModel = nodeConfig.embeddingModel || 'text-embedding-3-small';
  const embed = await embedCaption(services, caption, {
    provider: nodeConfig.embeddingProvider || 'litellm',
    model: configuredModel
  });
  storeVector(db, asset.fid, embed.vec, embed.model);
  const embeddingStored = true;
  if (embed.fallback && !embed.quiet) {
    logger?.warn?.(`[index] 资产 ${asset.fid} 使用 ${embed.model}（非配置模型 ${configuredModel}）: ${embed.error || '网关无 embedding'}`);
  }

  // 3. 流水线收尾：状态统一置为 ready，警告标记写进 ready_flags 字段
  //
  // 2026-10-03 状态收敛：原先这里会写 'ready_with_flags'（有警告时），
  // 而 'ready_with_flags' 同时在列表白名单里 —— 结果是「带警告的半成品」
  // 和「完全干净的成品」在客户端完全无法区分，列表判据形同虚设。
  // 现在两者都是 ready，客户端用 readyFlags 字段决定是否显示警告角标。
  const currentAsset = db.prepare('SELECT ready_flags FROM assets WHERE fid=?').get(asset.fid);
  let existingFlags = [];
  try { existingFlags = JSON.parse(currentAsset?.ready_flags || '[]'); } catch {}

  const allFlags = [...new Set([...existingFlags, ...(runCtx.accumulatedFlags || []), ...(embeddingStored ? [] : ['index_failed'])])];

  // 2026-10-03 修：原先此处写 status='ready_with_flags'，且 output.finalStatus 引用了一个
  // 已被删除的变量 `finalStatus`（状态收敛时删了赋值却漏删引用），
  // 导致 index 节点每次跑到收尾就抛 ReferenceError: finalStatus is not defined，
  // 资产永远停在 processing，且被治理台误判为「其他类」异常。状态已统一为 ready。
  db.prepare('UPDATE assets SET status=?, ready_flags=?, updated_at=? WHERE fid=?')
    .run('ready', allFlags.length > 0 ? JSON.stringify(allFlags) : null, Date.now(), asset.fid);

  return {
    success: true,
    flags: embeddingStored ? [] : ['index_failed'],
    output: {
      status: 'ready',
      flags: allFlags,
      indexed: embeddingStored,
      embeddingModel: embed.model,
      embeddingDim: embed.vec?.length || 0,
      embeddingFallback: !!embed.fallback
    }
  };
}

async function executeDefect(services, arg2 = {}, arg3 = {}, runCtx = {}) {
  const { db, config, logger } = services;
  // 兼容 (services, nodeConfig, asset, runCtx) 标准节点签名 与 (services, asset, nodeConfig, runCtx) 旧调用签名
  const isAssetFirst = Boolean(arg2 && typeof arg2 === 'object' && arg2.fid && (!arg3 || !arg3.fid));
  const asset = isAssetFirst ? arg2 : arg3;
  const nodeConfig = (isAssetFirst ? arg3 : arg2) || {};
  const isSandbox = Boolean(runCtx && runCtx.sandbox);

  if (!asset || !asset.fid) {
    throw new Error('defect 节点缺少有效的 asset 对象');
  }

  const candidateThumbs = [
    path.join(config.dataDir, 'cache', 'thumbs', `${asset.fid}.jpg`),
    path.join(config.dataDir, 'cache', 'thumbnails', `${asset.fid}.jpg`),
  ];
  let dataUrl = null;
  for (const p of candidateThumbs) {
    if (fs.existsSync(p)) {
      const thumbBuf = fs.readFileSync(p);
      dataUrl = `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;
      break;
    }
  }
  if (!dataUrl) {
    try {
      const { findCachedOriginal } = require('../originals');
      const localOrig = findCachedOriginal(config, asset.fid);
      if (localOrig && fs.existsSync(localOrig)) {
        const thumbBuf = await sharp(localOrig).rotate().resize(512, 512, { fit: 'inside' }).jpeg({ quality: 80 }).toBuffer();
        dataUrl = `data:image/jpeg;base64,${thumbBuf.toString('base64')}`;
      }
    } catch (_) {}
  }
  if (!dataUrl) {
    return { success: true, skipped: true, reason: '缩略图不存在，跳过AI缺陷质检', output: { pass: true, skipped: true } };
  }

  const { compileNodePrompt } = require('../prompt-compiler');
  const compiledDefect = compileNodePrompt(db, {
    mountPointId: 'ingest_pre_gate',
    nodeType: 'defect',
    promptId: nodeConfig.promptId || 'defect_inspection',
    promptTemplate: nodeConfig.promptTemplate || null,
    modelId: nodeConfig.model,
    vars: {
      $node: runCtx.$node || {},
      nodes: runCtx.nodes || {},
      asset: {
        fid: asset.fid,
        file_name: asset.file_name,
        width: asset.width,
        height: asset.height,
        category: asset.category,
      },
    },
  });

  const vlmCfg = resolveActiveVlmConfig(db, config, compiledDefect.modelId || nodeConfig.model);
  const resolvedPrompt = compiledDefect.prompt || '你是素材库 AI 视觉缺陷质检员，输出 JSON: {"pass":true,"defect_type":"none","reason":"正常"}';

  const res = await chatVisionWithRetry({
    ...vlmCfg,
    prompt: resolvedPrompt,
    images: [dataUrl]
  }, nodeConfig, logger);

  const pass = res && (res.pass === true || String(res.pass).toLowerCase() === 'true');
  const defectType = res?.defect_type || (pass ? 'none' : 'unspecified');
  const reason = res?.reason || (pass ? '质检通过' : '检测到画面缺陷');

  if (!pass && (nodeConfig.fallbackStrategy === 'reject' || nodeConfig.fallbackStrategy === 'manual_review')) {
    if (!isSandbox) {
      try {
        const gw = require('../gateway');
        gw.markRejected(services, asset.fid, {
          reason: 'ai_defect',
          fileName: asset.file_name,
          detail: { message: reason, defectType, model: 'defect' }
        });
      } catch (e) {
        db.prepare("UPDATE assets SET status='rejected', reject_reason='ai_defect', error_note=?, rejected_at=?, updated_at=? WHERE fid=?")
          .run(`AI缺陷拦截: ${reason}`, Date.now(), Date.now(), asset.fid);
      }
    }
    return {
      success: true,
      excluded: true,
      defectType,
      reason,
      output: { pass: false, defectType, reason, excluded: true }
    };
  }

  return {
    success: true,
    defectType,
    reason,
    output: { pass: true, defectType, reason }
  };
}

async function executeVideoSlice(services, nodeConfig, asset, runCtx = {}) {
  const { config } = services;
  const origPath = runCtx.lastOutput?.originalPath || await ensureOriginalFile(services, asset);
  const { sliceVideoScenes } = require('../media-tools');
  const destDir = path.join(config.dataDir, 'cache', 'temp', `slices_${asset.fid}`);
  const out = await sliceVideoScenes({
    videoPath: origPath,
    destDir,
    sliceMode: nodeConfig.sliceMode || 'scene_detect',
    sceneThreshold: Number(nodeConfig.sceneThreshold) || 0.3,
    clipDurationSec: Number(nodeConfig.clipDurationSec) || 5,
    maxClips: Number(nodeConfig.maxClips) || 12,
  });
  return {
    success: true,
    output: { ...out, originalPath: origPath },
  };
}

async function executeVideoExtractFrames(services, nodeConfig, asset, runCtx = {}) {
  const { config } = services;
  const origPath = runCtx.lastOutput?.originalPath || await ensureOriginalFile(services, asset);
  const { extractFrames } = require('../media-tools');
  const destDir = path.join(config.dataDir, 'cache', 'temp', `frames_${asset.fid}`);
  const out = await extractFrames({
    videoPath: origPath,
    destDir,
    mode: nodeConfig.mode || 'keyframe',
    intervalSeconds: Number(nodeConfig.intervalSeconds) || 2,
    maxFrames: Number(nodeConfig.maxFrames) || 12,
  });
  return {
    success: true,
    output: {
      frameCount: out.frameCount,
      videoDuration: out.videoDuration,
      frames: (out.frames || []).map((f) => ({ name: f.name, path: f.path, timestamp: f.timestamp, size: f.size })),
      originalPath: origPath,
    },
  };
}

async function executeVideoTranscode(services, nodeConfig, asset, runCtx = {}) {
  const { config } = services;
  const origPath = runCtx.lastOutput?.originalPath || await ensureOriginalFile(services, asset);
  const { convertVideo } = require('../media-tools');
  const destDir = path.join(config.dataDir, 'cache', 'temp', `transcode_${asset.fid}`);
  const out = await convertVideo({
    videoPath: origPath,
    destDir,
    targetFormat: nodeConfig.targetFormat || 'mp4',
    crf: Number(nodeConfig.crf) || 23,
    extractAudio: Boolean(nodeConfig.extractAudio),
  });
  return {
    success: true,
    output: out,
  };
}

async function executeSaveDerivative(services, nodeConfig, asset, runCtx = {}) {
  const frames = runCtx.lastOutput?.frames || [];
  const savedIds = [];
  for (const f of frames.slice(0, 12)) {
    if (f.path && fs.existsSync(f.path)) {
      const deriv = await createDerivative(services, {
        assetFid: asset.fid,
        kind: nodeConfig.derivativeKind || 'video_frame',
        srcPath: f.path,
        fileName: f.name || `frame_${Date.now()}.jpg`,
        mime: 'image/jpeg',
        params: { timestamp: f.timestamp },
      });
      if (deriv?.id) savedIds.push(deriv.id);
    }
  }
  return {
    success: true,
    output: { savedIds, count: savedIds.length },
  };
}

async function executeAlgoCutout(services, nodeConfig = {}, asset = {}, runCtx = {}) {
  const origPath = runCtx.lastOutput?.originalPath || await ensureOriginalFile(services, asset);
  if (!origPath || !fs.existsSync(origPath)) {
    throw new Error('算子 algo_cutout 缺少可用的源图本地文件');
  }
  const { floodFillCutout } = require('../handlers/image-ops');
  const srcBuf = fs.readFileSync(origPath);
  const cut = await floodFillCutout(srcBuf, Number(nodeConfig.tolerance) || 36);
  const pngBuf = cut.cutoutBuffer;
  return {
    success: true,
    output: {
      width: cut.width,
      height: cut.height,
      bytes: pngBuf.length,
      format: 'png',
    },
  };
}

async function executeAlgoCropWatermark(services, nodeConfig = {}, asset = {}, runCtx = {}) {
  const origPath = runCtx.lastOutput?.originalPath || await ensureOriginalFile(services, asset);
  if (!origPath || !fs.existsSync(origPath)) {
    throw new Error('算子 algo_crop_watermark 缺少可用的源图本地文件');
  }
  const meta = await sharp(origPath, { failOn: 'none' }).metadata();
  const trimRatio = Math.min(0.15, Math.max(0.01, Number(nodeConfig.maxTrimRatio) || 0.06));
  const trimPx = Math.max(1, Math.round((meta.height || 100) * trimRatio));
  const newHeight = Math.max(16, (meta.height || 100) - trimPx);
  const outDir = path.join(services.config.dataDir, 'cache', 'temp');
  fs.mkdirSync(outDir, { recursive: true });
  const croppedPath = path.join(outDir, `crop_${asset.fid || Date.now()}.jpg`);
  await sharp(origPath, { failOn: 'none' })
    .extract({ left: 0, top: 0, width: meta.width || 100, height: newHeight })
    .toFile(croppedPath);
  return {
    success: true,
    output: { croppedPath, width: meta.width, height: newHeight },
  };
}

async function executeChatOptimize(services, nodeConfig = {}, asset = {}, runCtx = {}) {
  const { db } = services;
  const { compileNodePrompt } = require('../prompt-compiler');
  const compiled = compileNodePrompt(db, {
    nodeType: 'chat_optimize',
    modelId: nodeConfig.model || 'agnes-3.0-flash',
    promptTemplate: nodeConfig.promptTemplate || runCtx.prompt || '现代极简客厅，自然采光',
    snippetIds: nodeConfig.snippetIds || ['snippet_interior_realism'],
    vars: { asset },
  });
  return {
    success: true,
    output: {
      optimizedPrompt: compiled.prompt,
      negativePrompt: compiled.negativePrompt,
      snippetsUsed: compiled.snippetsUsed,
      warnings: [],
    },
  };
}

function makeInteractiveOperatorHandler(opType, requirementDesc) {
  return async function executeInteractiveOperator(services, nodeConfig = {}, asset = {}, runCtx = {}) {
    throw new Error(`算子 ${opType} 为交互式/多模态算子，当前单步执行缺少必要交互入参或上游服务（需要：${requirementDesc}）`);
  };
}

const NODE_REGISTRY = {
  materialize: executeMaterialize,
  gate: executeGate,
  qc: executeQc,
  script_qc: executeQc,
  defect: executeDefect,
  tag: executeTag,
  tag_space: executeTagSpace,
  tag_furniture: executeTagFurniture,
  tag_clothing: executeTagClothing,
  tag_portrait: executeTagPortrait,
  cluster: executeCluster,
  clean: executeClean,
  edit_clean: executeClean,
  restage_9_16: executeRestage9x16,
  restage_dual: executeRestageDual,
  index: executeIndex,
  backup: executeBackup,
  video_slice: executeVideoSlice,
  video_extract_frames: executeVideoExtractFrames,
  video_transcode: executeVideoTranscode,
  save_derivative: executeSaveDerivative,
  algo_cutout: executeAlgoCutout,
  algo_crop_watermark: executeAlgoCropWatermark,
  chat_optimize: executeChatOptimize,
  region_vlm: makeInteractiveOperatorHandler('region_vlm', '画布选区坐标框 region (x1,y1,x2,y2)'),
  vlm_topology: makeInteractiveOperatorHandler('vlm_topology', '2~6 张空间实拍照片列表 photos'),
  vlm_aesthetic_score: executeDefect,
  vlm_ocr_caption: executeDefect,
  edit_replace: makeInteractiveOperatorHandler('edit_replace', '画布选区 region 与替换单品参考图 refImageBuffer (/api/edit/run?op=replace)'),
  edit_insert: makeInteractiveOperatorHandler('edit_insert', '四点透视贴合坐标与 2D 软装单品图 productImageBuffer (/api/edit/run?op=insert)'),
  edit_insert_relit: makeInteractiveOperatorHandler('edit_insert_relit', '抠底单品图与安装环境特写图 (/api/edit/run?op=insert&mode=C)'),
  edit_add: makeInteractiveOperatorHandler('edit_add', '空地选区 region 与新增单品参考图 refImageBuffer (/api/edit/run?op=add)'),
  edit_remove: makeInteractiveOperatorHandler('edit_remove', '待消除物体的画布选区 region (/api/edit/run?op=remove)'),
  edit_space: makeInteractiveOperatorHandler('edit_space', '待平移通道的画布选区 region (/api/edit/run?op=space)'),
  edit_style_transfer: makeInteractiveOperatorHandler('edit_style_transfer', '目标重塑风格 targetStyle 与源场景图 (/api/edit/run?op=style_transfer)'),
  edit_expand: makeInteractiveOperatorHandler('edit_expand', '四向外扩比例参数 top/bottom/left/right 与火山 veImageX 通道 (/api/ai/expand-jimeng)'),
  edit_upscale: makeInteractiveOperatorHandler('edit_upscale', '超分倍率 scale 与超分模型通道 (/api/edit/run?op=clarity)'),
  img_white_bg: makeInteractiveOperatorHandler('img_white_bg', '单品主体参考图与生图网关'),
  img_relight: makeInteractiveOperatorHandler('img_relight', '目标光影预设 lightingPreset 与生图网关'),
  image_gen: makeInteractiveOperatorHandler('image_gen', '生图提示词 prompt 与在线生图模型网关 (/api/gen/images)'),
  algo_affine: makeInteractiveOperatorHandler('algo_affine', '透明单品 PNG 与四边形透视顶点坐标 quad'),
  algo_pasteback: makeInteractiveOperatorHandler('algo_pasteback', '局部重绘结果图 croppedResultBuffer 与原始裁剪框 cropRect'),
  video_concat_render: makeInteractiveOperatorHandler('video_concat_render', '多段分镜视频路径列表 clips 与时间线参数'),
  video_gen: makeInteractiveOperatorHandler('video_gen', '首尾帧图像与在线视频生成模型网关 (/api/gen/videos)'),
  music_gen: makeInteractiveOperatorHandler('music_gen', '音乐风格提示词与豆包音乐网关'),
};

async function previewGateCategory(services, dataUrl) {
  const { db, config, logger } = services;
  const vlmCfg = resolveActiveVlmConfig(db, config);
  const gate = await chatVisionWithRetry({
    ...vlmCfg,
    prompt: gatePrompt(),
    images: [dataUrl],
  }, {}, logger);
  const { routeGate } = require('../gate-route');
  const decision = routeGate(gate);
  return {
    category: decision.category || 'none',
    keep: !!decision.keep,
    reason: decision.reason || '',
  };
}

module.exports = {
  NODE_REGISTRY,
  previewGateCategory,
  // 多模型挂载：模型 → 适配器候选链（供回归测试与外部复用）
  buildModelChain,
  nodeModelIds,
  executeGate,
  executeDefect,
  executeTag,
  executeTagSpace,
  executeTagFurniture,
  executeQc,
  executeCluster,
  executeMaterialize,
  executeBackup,
  executeClean,
  executeRestage9x16,
  executeRestageDual,
  index: executeIndex,
  // 异常治理台要用同一套错误语义做过滤，避免「能重试的」和「白重试的」混在一起
  isTransientErrorText,
  isDeterministicErrorText,
  poolFullErrorText,
  chatVisionWithRetry,
  tagSpacePrompt,
};
