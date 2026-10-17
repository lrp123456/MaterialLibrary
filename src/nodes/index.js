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
const { executeAdapter } = require('../gen');
const { findGroupForAsset, reElectGroupRepresentative, assignToGroup, getAssetTags } = require('../cluster');
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
    schema.style_main = `文化/流派风格。输出字符串数组，0-3 个 dir，从枚举中选 [${enumOptions(db, 'style_atom')}]。
判定要点：法式=护墙板/线脚/人字拼/对称；意式=大理石皮革低矮雕塑感；托斯卡纳=赤陶木梁锻铁陶罐乡土；地中海=白墙蓝白花砖拱廊；奶油风=无法式符号的浅暖软融；中古风=1945-75柚木细锥腿有机弧线；现代极简=冷感几何留白；工业=裸砖水泥管道；现代美式=当代舒适；美式乡村=农舍壁炉格纹旧木；南洋=藤编柚木绿植百叶；宋式美学=雅素文人；古典中式=明清红木繁雕对称；新中式=传统符号+现代转译；侘寂=斑驳枯寂；混搭=多风格强冲突。
【禁止】欧式轻奢、原木日式、日式、北欧、英式、民宿风。只有实在拿不准时才用 eclectic_other(混搭)。`;
    schema.style_confidence = '0到1之间的小数，表示风格判定置信度';
  }
  if (want('wood_style')) {
    schema.wood_style = `木系风格（深浅×做旧），严格单选 dir 或 null [${enumOptions(db, 'wood_style')}]。
浅=松/白橡/原色，深=胡桃/深橡/烟熏；做旧=裂痕/虫眼/大面积包浆/明显磨损/粗糙锯痕。光滑均匀色面不算做旧。非木质主体必须 null。只看木面表面，不看布局文化。`;
    schema.wood_confidence = '0到1之间的小数';
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
规则：空间 1 个；文化风格 style_main 为数组（0-3 个，可多选）；wood_style 木系单选或 null；硬装≤2、软装≤2。不要输出色系、地域、调性、构图、机位、光线、AI生成、装修实拍。
dir 只能从枚举中选；空间拿不准给 other；风格实在拿不准才给 eclectic_other。
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
  if (want('style_atom')) schema.style_main = `设计流派/风格，可多选数组 [${enumOptions(db, 'style_atom')}]。禁止：欧式轻奢、原木日式、日式、北欧、英式。`;
  if (want('wood_style')) schema.wood_style = `木系（深浅×做旧）单选或 null [${enumOptions(db, 'wood_style')}]。非木 null。`;
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

  // 预置防御：拦截明确的调试/测试截屏文件
  if (asset.file_name && /^(ml_debug|screencap_test)/i.test(asset.file_name)) {
    if (!isSandbox) {
      db.prepare("UPDATE assets SET status='excluded', error_note=?, updated_at=? WHERE fid=?")
        .run('调试工具测试截图(自动排除)', Date.now(), asset.fid);
    }
    return {
      success: true,
      excluded: true,
      category: 'none',
      reason: '调试工具测试截图',
      output: { excluded: true, category: 'none', reason: '调试工具测试截图' }
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
    // 拒收分类：生活照/人像 → life_photo；其余 → non_interior
    // AI 可能只给 is_material=false 而不给 reason/category（实测有过 39 条）。
    // 直接 `reasonText || gate.category` 会拼出字面量 "undefined" 并落库，
    // 用户在回收站看到的就是「闸门判定非素材: undefined」。这里兜底成可读文案。
    const reasonText = decision.reason;
    const categoryText = decision.category;
    const verdictText = reasonText || categoryText || 'AI 闸门判定该图不是可用素材（模型未给出具体理由）';
    const isLife = /自拍|生活照|人像|人物|美食|表情包|聊天|宠物/.test(verdictText) && !/室内|空间|设计|服装|穿搭/.test(verdictText);
    const rejectReason = isLife ? 'life_photo' : 'non_interior';
    if (!isSandbox) {
      try {
        const gw = require('../gateway');
        // 传 services 而非 db：这样拒收时才能真正把文件移入 trash 目录（可恢复）
        gw.markRejected(services, asset.fid, {
          reason: rejectReason,
          fileName: asset.file_name,
          detail: { message: verdictText, category: categoryText || 'unspecified', model: 'gate' },
        });
      } catch (e) {
        db.prepare("UPDATE assets SET status='rejected', reject_reason=?, error_note=?, rejected_at=?, updated_at=? WHERE fid=?")
          .run(rejectReason, `闸门判定非素材: ${verdictText}`, Date.now(), Date.now(), asset.fid);
      }
    }
    return {
      success: true,
      excluded: true,
      category: categoryText,
      reason: verdictText,
      rejectReason,
      output: { excluded: true, category: categoryText, reason: verdictText, rejectReason }
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
    if (categoryLocked) {
      db.prepare("UPDATE assets SET status='processing', updated_at=? WHERE fid=?").run(Date.now(), asset.fid);
    } else {
      db.prepare("UPDATE assets SET status='processing', category=?, updated_at=? WHERE fid=?")
        .run(validCategory, Date.now(), asset.fid);
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
  const onlyDims = runCtx.dictRetag?.dimensions || nodeConfig.onlyDimensions || require('../library-schema').dimensionsFor('interior_design', 'primary');
  let resolvedSpacePrompt = '';
  if (runCtx.dictRetag?.dimensions) {
    resolvedSpacePrompt = tagSpacePrompt(db, onlyDims);
  } else {
    const compiledTag = compileNodePrompt(db, {
      mountPointId: 'ingest_post_process',
      nodeType: 'tag',
      category: 'interior',
      promptId: nodeConfig.promptId || 'tag_space_interior',
      promptTemplate: nodeConfig.promptTemplate ? expandDictMacros(db, nodeConfig.promptTemplate) : null,
      modelId: nodeConfig.model,
    });
    // 若自定义模板未包含枚举词典且长度过短（历史残缺模板），自动回退至完整动态词典拼装
    if (compiledTag.prompt && (compiledTag.prompt.includes('living_room') || compiledTag.prompt.length > 400 || nodeConfig.forceCustomPrompt)) {
      resolvedSpacePrompt = compiledTag.prompt;
    } else {
      resolvedSpacePrompt = tagSpacePrompt(db, onlyDims);
    }
  }
  const vlmCfg = resolveActiveVlmConfig(db, config, nodeConfig.model);
  const tags = await chatVisionWithRetry({
    ...vlmCfg,
    prompt: resolvedSpacePrompt,
    images: tagImages
  }, nodeConfig, logger);

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
  if (dimTouched('style_atom')) {
    clearAiTagsOnDim('style_atom');
    const rawStyles = Array.isArray(tags.style_main) ? tags.style_main
      : (tags.style_main ? [tags.style_main] : []);
    const styles = rawStyles
      .map((v) => {
        const t = resolveTag('style_atom', v);
        return t ? t.dir : null;
      })
      .filter(Boolean)
      .slice(0, 4);
    // 有解析出的叶子就采用；只有完全无法解析才落混搭
    if (!styles.length) {
      applyTag('style_atom', 'eclectic_other', conf);
    } else {
      for (const dir of styles) applyTag('style_atom', dir, conf);
    }
  }
  if (dimTouched('wood_style')) {
    clearAiTagsOnDim('wood_style');
    const woodConf = typeof tags.wood_confidence === 'number' ? tags.wood_confidence : conf;
    const woodRaw = tags.wood_style;
    if (woodRaw) {
      const wt = resolveTag('wood_style', woodRaw);
      if (wt) applyTag('wood_style', wt.dir, woodConf);
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
  if (Array.isArray(tags.style_main)) {
    tags.style_main.slice(0, 4).forEach(v => applyTag('style_atom', v, 0.85));
  } else if (tags.style_main) {
    applyTag('style_atom', tags.style_main, 0.85);
  }
  if (tags.wood_style) applyTag('wood_style', tags.wood_style, 0.85);
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
  const { db } = services;
  const fresh = db.prepare('SELECT * FROM assets WHERE fid=?').get(asset.fid) || asset;
  const targetTags = getAssetTags(db, asset.fid);
  const colors = extras.colors || db.prepare('SELECT hex, weight FROM asset_colors WHERE asset_fid = ?').all(asset.fid);
  const found = findGroupForAsset(db, {
    fid: fresh.fid,
    file_name: fresh.file_name,
    phash: extras.phash || fresh.phash,
    width: extras.width || fresh.width,
    height: extras.height || fresh.height
  }, {
    phashThreshold: nodeConfig.phashThreshold || 5,
    targetTags,
    targetColors: colors
  });

  if (found && found.groupId) {
    assignToGroup(db, asset.fid, found.groupId, found.reason);
    reElectGroupRepresentative(db, found.groupId);
    return {
      dupGroupId: found.groupId,
      matchReason: found.reason,
      dist: found.dist,
      peerFid: found.peerFid
    };
  }
  return { dupGroupId: null, matchReason: null };
}

async function executeCluster(services, nodeConfig, asset, runCtx = {}) {
  const out = executeClusterLogic(services, nodeConfig, asset, {
    phash: runCtx.lastOutput?.phash,
    width: runCtx.lastOutput?.width,
    height: runCtx.lastOutput?.height,
    colors: runCtx.lastOutput?.colors
  });
  const members = out.dupGroupId
    ? services.db.prepare('SELECT fid, file_name FROM assets WHERE dup_group_id=?').all(out.dupGroupId)
    : [];
  return {
    success: true,
    output: {
      ...out,
      memberCount: members.length,
      members: members.map(m => m.file_name)
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
  const adapterId = nodeConfig.adapterId;
  if (!adapterId || adapterId === 'builtin_none') {
    return {
      success: true,
      nonFatal: true,
      flags: ['restage_skipped_no_adapter'],
      output: { restaged: false, fallback: 'origin' }
    };
  }
  let adapter = db.prepare('SELECT * FROM gen_adapters WHERE id=? AND enabled=1').get(adapterId);
  if (!adapter) {
    logger?.info?.(`[restage_9_16] 指定的生图适配器 (${adapterId}) 未启用，跳过重构图回退原图`);
    return {
      success: true,
      nonFatal: true,
      flags: ['restage_adapter_disabled'],
      error: `生图适配器 ${adapterId} 未启用`,
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
    const res = await executeAdapter(services, adapter, {
      kind: 'image',
      mode: 'ref',
      prompt,
      negativePrompt,
      model: nodeConfig.model,
      ratio: '9:16',
      size: agnesSizeForPreset(nodeConfig.sizePreset || '1080p'),
      imageLocalPaths: [refPath]
    });

    if (res.ok && res.files?.[0]?.localPath) {
      const file = res.files[0];
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
        params: { adapterId, model: nodeConfig.model, prompt, generated: true, calibrated: false, strategy: 'raw_byte_copy', ratio: '9:16', sizePreset }
      });

      // 设为主图
      setMainDerivative(db, asset.fid, deriv.id);

      return {
        success: true,
        derivative: deriv,
        output: { restaged: true, derivativeId: deriv.id }
      };
    }
    throw new Error('生图服务未返回产物文件');
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
  return /No deployments available|no available deployment|queue is full|image queue|队列已满|HTTP 429|HTTP 503/i.test(String(s || ''));
}

/**
 * 确定性错误：重试多少次都是同样结果，只能靠改配置/改数据解决。
 *
 * 注意 `download file size limit` 这类：文件超限，重试还是超限。
 * 「模型没部署」不要列在这里 —— 见 isTransientErrorText 的血泪教训二。
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
  return /对应资产记录不存在|文件找不到|free_tier|未配置|无适配器|unsupported|参数错误|400\b|资产已删除|已拉黑/i.test(s);
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

async function executeRestageDual(services, nodeConfig, asset, runCtx) {
  const { db, config, logger } = services;
  const { shouldAutoRestage } = require('../gate-route');
  if (!shouldAutoRestage(asset.category || runCtx?.lastOutput?.category)) {
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

  // 1. 成本与效率控制：仅组代表图或未归组独立资产生成 AI 重构图，同组次级切片跳过并共享代表图成果
  if (asset.dup_group_id && !asset.is_representative && !nodeConfig.forceMember && !nodeConfig.replaceExisting) {
    return {
      success: true,
      skipped: true,
      reason: 'group_member_skipped',
      output: { restaged: false, message: '同组副切片跳过生图，共享代表图重构主图' }
    };
  }

  // 2. 检查适配器 —— 构造「主通道 + 降级通道」候选链
  const adapterId = nodeConfig.adapterId || 'agnes_image';
  const primary = db.prepare('SELECT * FROM gen_adapters WHERE id=? AND enabled=1').get(adapterId);
  const fallback = db.prepare("SELECT * FROM gen_adapters WHERE id=? AND enabled=1").get('qwenimage_local');
  // 降级顺序：主通道 → 本地 QwenImage。批量灌入时可配 fallbackFirst 让本机先消化。
  const chain = [];
  if (nodeConfig.fallbackFirst && fallback) chain.push(fallback);
  if (primary) chain.push(primary);
  if (!nodeConfig.fallbackFirst && fallback) chain.push(fallback);
  if (!chain.length) {
    chain.push(db.prepare("SELECT * FROM gen_adapters WHERE kind='image' AND enabled=1 ORDER BY builtin DESC LIMIT 1").get());
  }
  const adapter = chain.find(Boolean);
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
    logger?.info?.(`[restage_dual] 资产 ${asset.fid} 生图通道链: ${chain.map(a => a.id).join(' → ')}`);
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
    let usedAdapterId = adapter.id;
    let lastErrText = '';
    try {
      // 逐个通道尝试；每个通道内部对偶发错误做有限次退避重试。
      // 偶发性故障（TLS 断连 / 超时 / 429 / 503）不应该把任务留在异常态，
      // 退避后重试即可恢复；只有确定性错误才立即换下一条通道。
      for (const cand of chain) {
        if (!cand) continue;
        const maxTry = isTransientAdapterError(cand.id) ? (Number(nodeConfig.retryTimes) || 3) : 1;
        for (let attempt = 1; attempt <= maxTry; attempt++) {
          if (genPath) break;
          try {
            const res = await executeAdapter(services, cand, {
              kind: 'image',
              mode: 'ref',
              prompt,
              negativePrompt,
              model: nodeConfig.model || cfgDefaultModel(cand),
              ratio,
              width: pixelSizeFor(ratio, sizePreset).width,
              height: pixelSizeFor(ratio, sizePreset).height,
              size: agnesSizeForPreset(sizePreset),
              imageLocalPaths: [composedPath]
            });
            if (res.ok && res.files?.[0]?.localPath) {
              genPath = res.files[0].localPath;
              usedAdapterId = cand.id;
              if (attempt > 1) logger?.info?.(`[restage_dual] 资产 ${asset.fid} ${ratio} 经 ${cand.id} 第 ${attempt} 次重试恢复`);
              break;
            }
            const errText = (res && res.error) || '生图服务未返回产物';
            lastErrText = errText;
            if (isTransientErrorText(errText) && attempt < maxTry) {
              const waitMs = transientBackoffMs(attempt);
              logger?.warn?.(`[restage_dual] 资产 ${asset.fid} ${ratio} ${cand.id} 偶发失败(${attempt}/${maxTry})，${waitMs}ms 后重试: ${errText}`);
              await sleep(waitMs);
              continue;
            }
            genErrors.push(`${ratio}@${cand.id}:${errText}`);
            break;
          } catch (e) {
            lastErrText = e.message;
            if (isQueueFullError(e)) {
              requeue = true;
              requeueError = e.message;
              break;
            }
            if (isTransientErrorText(e.message) && attempt < maxTry) {
              const waitMs = transientBackoffMs(attempt);
              logger?.warn?.(`[restage_dual] 资产 ${asset.fid} ${ratio} ${cand.id} 偶发异常(${attempt}/${maxTry})，${waitMs}ms 后重试: ${e.message}`);
              await sleep(waitMs);
              continue;
            }
            logger?.warn?.(`[restage_dual] 资产 ${asset.fid} 生成 ${ratio} 失败(${cand.id}): ${e.message}`);
            genErrors.push(`${ratio}@${cand.id}:${e.message}`);
            break;
          }
        }
        if (genPath || requeue) break;
        logger?.info?.(`[restage_dual] 资产 ${asset.fid} ${ratio} 通道 ${cand.id} 未能产出，切换下一通道`);
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
          model: nodeConfig.model || '',
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
      results[kind] = { id: deriv.id, width: deriv.width, height: deriv.height, ratio, kind };
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
    const { attempt, ms } = nextRestageBackoff(prevErr);
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
    return {
      success: false,
      error: `未能生成任何画幅${detail}`.slice(0, 500),
      output: { restaged: false, derivatives: results, skipped, sizePreset, ratios, genErrors }
    };
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
  } else if (currentCategory === 'portrait') {
    parts.push('类别:人像');
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
