/**
 * 生成适配器引擎 (Generation Adapters Engine)
 * 支持 http_json (同步), http_multipart (同步), async_http_job (异步提交轮询)
 * 具备统一调用接口，结果统一下载至本地磁盘文件
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { shapeVolcVideo } = require('../portrait-contract');

function getNested(obj, pathStr) {
  if (!obj || !pathStr) return undefined;
  return pathStr.split('.').reduce((acc, part) => (acc !== null && acc !== undefined ? acc[part] : undefined), obj);
}

function fillTemplate(tpl, vars) {
  if (typeof tpl === 'string') {
    let s = tpl;
    for (const [k, v] of Object.entries(vars)) {
      const placeholder = `{{${k}}}`;
      if (s === placeholder && (typeof v === 'object' || typeof v === 'number' || typeof v === 'boolean')) {
        return v;
      }
      s = s.replaceAll(placeholder, typeof v === 'object' ? JSON.stringify(v) : String(v || ''));
    }
    return s;
  }
  if (Array.isArray(tpl)) {
    return tpl.map(item => fillTemplate(item, vars));
  }
  if (tpl !== null && typeof tpl === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(tpl)) {
      out[k] = fillTemplate(v, vars);
    }
    return out;
  }
  return tpl;
}

async function downloadToFile(url, destPath, { timeoutMs = 60000, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw enrichFetchError(e, '下载产物网络失败');
  }
  if (!res.ok) throw new Error(`下载产物失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return buf;
}

function describeFetchError(e) {
  const cause = e?.cause;
  const detail = cause
    ? (cause.message || cause.code || cause.errno || String(cause))
    : '';
  const base = e?.message || String(e);
  if (detail && !base.includes(detail)) return `${base} (${detail})`;
  return base;
}

function enrichFetchError(e, what) {
  const err = new Error(`${what}: ${describeFetchError(e)}`);
  err.cause = e?.cause || e;
  return err;
}

/* ------------------------------------------------------------------ *
 * 火山方舟 Seedream 载荷规范化（模块级纯函数，便于单测）
 *
 * 官方契约（ARK /images/generations）：
 *  - image   : string | string[]，参考图。文生图不传；单图字符串；多图数组。
 *              上限随代际变化（5.0 pro/flash ≤10，5.0 lite / 4.x ≤14）——读 schema.slots。
 *  - size    : 档位关键字（1K/1.5K/2K/3K/4K，各代际支持集不同）或 'WIDTHxHEIGHT'
 *              （总像素 1024×1024 ~ 4096×4096，宽高比 1/16 ~ 16）。两种写法不可混用。
 *  - sequential_image_generation: 'auto' | 'disabled'，组图。**部分代际不支持**，不支持时严禁下发。
 *  - response_format: 'url' | 'b64_json'；output_format: 'jpeg' | 'png'；watermark: boolean。
 *  - 无 negative_prompt、无 ratio、**无 mask 参数**。
 *    局部控制只能靠提示词里的归一化坐标（1000×1000 网格）+「图1/图2」图片顺序引用，
 *    或直接在图上手绘圈/箭头/草图。
 *
 * 此前 ark_seedream 完全没做规范化，多图参考与 size 会被静默丢弃
 * （模板只填了 image_data_url，且 defaultModel 是 404 幻影 'doubao-seedream-5-0-pro'）。
 * ------------------------------------------------------------------ */

/** 按任意 id / alias / model_code 取 { officialId, caps }；查不到给保守空值 */
function probeCaps(idOrCode) {
  try {
    const { officialIdOf, capsFor } = require('../studio-catalog');
    return { officialId: officialIdOf(idOrCode) || '', caps: capsFor(idOrCode) || {} };
  } catch (e) {
    return { officialId: '', caps: {} };
  }
}

/**
 * 适配器级默认模型：**只在调用方完全没给 model 时**兜底。
 *
 * 一律取自官方目录（`studio-catalog.js` 的 `OFFICIAL_STUDIO`），禁止在本文件写死
 * 任何 model code —— 历史教训：这里曾写死 'doubao-seedream-5-0-pro'（缺日期后缀的
 * 幻影 code，发出去必 404）。目录里找不到就返回空串，由调用方决定报错还是报缺参。
 *
 * @param {'image'|'video'|'music'|'chat'} domain
 * @param {string} [provider] 只在该 provider 内找（如 'gemini'）——跨厂商兜底会比空值更危险
 * @returns {string} 该域默认模型的 **model_code**（已带日期后缀那种），找不到返回空串
 */
function catalogDefaultCode(domain, provider) {
  try {
    const { OFFICIAL_STUDIO } = require('../studio-catalog');
    const block = (OFFICIAL_STUDIO && OFFICIAL_STUDIO[domain]) || {};
    const list = block.models || [];
    if (provider) {
      const hit = list.find((m) => m.provider === provider);
      return (hit && hit.model_code) || '';
    }
    const def = list.find((m) => m.id === block.defaultModel) || list[0];
    return (def && def.model_code) || '';
  } catch (e) {
    return '';
  }
}

/**
 * size 规范化：只放行该模型 schema 声明的档位，或合法的 'WIDTHxHEIGHT'。
 * 非法输入返回 null —— 宁可不传（上游用默认档），也不给上游一个必然 400 的值。
 */
function normalizeArkSize(raw, officialId) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  const upper = s.toUpperCase().replace(/\s+/g, '');
  let presets = [];
  try {
    const { sizeOptionsOf } = require('../model-schemas');
    presets = sizeOptionsOf(officialId).map((x) => String(x).toUpperCase());
  } catch (e) {}
  if (!presets.length) presets = ['1K', '1.5K', '2K', '3K', '4K'];
  if (presets.includes(upper)) return upper;

  const m = s.match(/^(\d{3,4})\s*[x×*]\s*(\d{3,4})$/i);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  const px = w * h;
  if (px < 1024 * 1024 || px > 4096 * 4096) return null;
  const ratio = w / h;
  if (ratio < 1 / 16 || ratio > 16) return null;
  return `${w}x${h}`;
}

/**
 * @param {object} body  已 fillTemplate 的请求体
 * @param {object} v     executeAdapter 的 vars
 * @param {object} inp   executeAdapter 的 input
 * @param {object} ctx   { adapter, baseUrl, cfg, apiKey }
 * @returns {object} 规范化后的 ARK Seedream 请求体（非 ARK 时原样返回）
 */
function normalizeArkSeedreamPayload(body, v, inp, ctx) {
  const { adapter = {}, baseUrl = '', cfg = {}, apiKey = '' } = ctx || {};
  const probeModel = String(body.model || v.model || cfg.defaultModel || '');
  const isArkSeedream = String(adapter.id || '').includes('seedream') ||
                        /seedream/i.test(probeModel) ||
                        String(baseUrl).includes('volces.com');
  if (!isArkSeedream) return body;

  if (!apiKey) {
    throw new Error('[火山方舟 Seedream] 请先在提供商设置中配置火山引擎 (Volcengine) 的 API Key');
  }

  const prompt = String(body.prompt || v.prompt || '').trim();
  if (!prompt) throw new Error('[火山方舟 Seedream] prompt 为必填参数且不能为空');

  const { officialId, caps } = probeCaps(probeModel);
  const adapterId = String(adapter.id || '');
  const isSeedream = /seedream/i.test(officialId) || /seedream/i.test(probeModel) || adapterId.includes('seedream');
  if (isSeedream) {
    const { convertArkSeedreamRequest } = require('../converters');
    let modelContract = null;
    try {
      const { resolveModelExecution } = require('../models-contract');
      modelContract = resolveModelExecution(ctx && ctx.db, officialId || probeModel)?.model || null;
    } catch (_) {}
    const converted = convertArkSeedreamRequest({
      rawInput: {
        ...(inp || {}),
        ...(v || {}),
        ...(body || {}),
        prompt,
        model: probeModel,
      },
      modelContract,
    });
    return converted.body;
  }

  const inputCaps = caps.input || {};

  /**
   * 组图能力判定：只有 5.0 **Lite** 支持 sequential_image_generation。
   * 注意 model_code 是 'doubao-seedream-5-0-260128'，字面不含 "lite"，
   * 必须用 catalog id（seedream5lite）判定。
   */
  const supportsSequential = /lite/.test(officialId);

  // ---- 参考图：显式阵列优先，其次自动组装（保持「图1=场景、图2=参考」顺序） ----
  const images = [];
  const pushImg = (u) => {
    if (!u) return;
    const s = String(u).trim();
    if (!s || s === 'undefined' || s === 'null') return;
    if (!images.includes(s)) images.push(s);
  };
  if (Array.isArray(inp.arkImages) && inp.arkImages.length) {
    inp.arkImages.forEach(pushImg);
  } else {
    pushImg(v.image_data_url);
    if (Array.isArray(v.extra_image_data_urls)) v.extra_image_data_urls.forEach(pushImg);
    if (!images.length && Array.isArray(v.image_urls)) v.image_urls.forEach(pushImg);
  }

  const declaredMax = Number(inputCaps.images || 0) || (supportsSequential ? 14 : 10);
  const maxRefs = Math.max(1, declaredMax);

  // ⚠ model 必须是已归一好的 model_code，绝不能换成 catalog id
  const payload = { model: probeModel, prompt, watermark: false };
  if (images.length) {
    const capped = images.slice(0, maxRefs);
    payload.image = capped.length === 1 ? capped[0] : capped;
  }

  // Seedream 已在上面交给契约转换器。这里只给非 Seedream 的方舟图保留档位或像素校验。
  const rawSize = body.size != null ? body.size : (v.size != null ? v.size : inp.size);
  const size = normalizeArkSize(rawSize, officialId);
  if (size) payload.size = size;

  // ---- 组图：仅支持的代际才下发 ----
  const seqReq = body.sequential_image_generation || inp.sequentialImageGeneration;
  if (supportsSequential && seqReq) {
    const mode = seqReq === 'auto' ? 'auto' : 'disabled';
    payload.sequential_image_generation = mode;
    if (mode === 'auto') {
      const opt = body.sequential_image_generation_options || {};
      const raw = Number(opt.max_images != null ? opt.max_images : (inp.maxImages != null ? inp.maxImages : 3));
      const max = Number.isFinite(raw) ? Math.max(1, Math.min(15, Math.round(raw))) : 3;
      payload.sequential_image_generation_options = { max_images: max };
    }
  }

  // ---- 输出 ----
  payload.response_format = 'url';
  const outFmt = String(body.output_format || (body.extras && body.extras.output_format) || inp.outputFormat || (inp.extras && inp.extras.output_format) || '').toLowerCase();
  if (outFmt === 'png' || outFmt === 'jpeg') payload.output_format = outFmt;
  const isTransparent = body.background === 'transparent' || (body.extras && body.extras.background === 'transparent') || inp.transparentBackground || (inp.extras && inp.extras.background === 'transparent');
  if (isTransparent) {
    if (images.length !== 1) {
      throw new Error('Seedream Flash 透明背景必须且仅支持传入单张参考图');
    }
    payload.background = 'transparent';
    payload.output_format = 'png';
  }
  if (body.seed != null) payload.seed = body.seed;
  if (body.logo_info && typeof body.logo_info === 'object') payload.logo_info = body.logo_info;

  // 厂商优化选项
  if (body.optimize_prompt_options) {
    payload.optimize_prompt_options = body.optimize_prompt_options;
  }

  return payload;
}

function noteVendorOutcome(input, ok, errText) {
  const id = input && input.contractId;
  if (!id) return;
  try {
    const { globalCircuitBreaker } = require('../converters');
    if (ok) globalCircuitBreaker.recordSuccess(id);
    else globalCircuitBreaker.recordFailure(id, errText || '');
  } catch (_) {}
}

async function executeAdapter(services, adapter, input) {
  const { config, logger } = services;
  // 生图/下载前确保全局代理 dispatcher 可用（启动探测失败后可恢复）
  try {
    const { ensureProxy } = require('../proxy-setup');
    ensureProxy({ quiet: true });
  } catch {}
  try {
    const { MODEL_SCHEMAS, assertFreeTier, uniqueUrls } = require('../model-schemas');
    const { officialIdOf } = require('../studio-catalog');
    if (Array.isArray(input.imageUrls)) input.imageUrls = uniqueUrls(input.imageUrls);
    const sch = MODEL_SCHEMAS[officialIdOf(input.model)] || MODEL_SCHEMAS[input.model];
    if (sch) {
      assertFreeTier(sch, {
        refs: input.imageUrls || input.imageLocalPaths || [],
        videos: input.videoUrl ? [input.videoUrl] : [],
        audios: input.audioUrls || [],
        size: (input.extras && (input.extras.size || input.extras.resolution)) || input.size || input.resolution,
      });
    }
  } catch (e) {
    if (e.code === 'free_tier') return { ok: false, success: false, error: e.message, files: [] };
    throw e;
  }
  const cfg = typeof adapter.config_json === 'string' ? JSON.parse(adapter.config_json) : (adapter.config_json || {});
  const secrets = typeof adapter.secrets_json === 'string' ? JSON.parse(adapter.secrets_json) : (adapter.secrets_json || {});

  const baseUrl = (adapter.base_url || config.litellmBaseUrl || '').replace(/\/$/, '');
  const { resolveProviderApiKey, endpointIdForAdapter, fallbackApiKey } = require('../providers');
  const resolvedKey = resolveProviderApiKey(services.db, adapter, secrets);
  const decided = fallbackApiKey(endpointIdForAdapter(adapter), resolvedKey, config.litellmApiKey || '');
  if (decided.error) return { ok: false, success: false, error: decided.error, files: [] };
  let apiKey = decided.apiKey;
  const timeoutMs = input.timeoutMs || cfg.timeoutMs || 180000;

  // 适配器级默认模型：此前 vars.model 引用了未定义的 defaultModelFromCfg / fallbackModel，
  // 仅在 input.model 恒为真时靠短路侥幸不炸。这里显式定义，避免缺参时 ReferenceError。
  const fallbackModel = cfg.defaultModel || input.model || '';
  const defaultModelFromCfg = cfg.defaultModel || fallbackModel;

  // ★ 模型标识归一（适配器边界是唯一可靠收口点）
  //   调用方可能传目录 id / alias（如 "seedream5flash"），真正发给上游的必须是
  //   model_code（如 "doubao-seedream-5-0-flash-260915"）。历史上 edit-run / quick-* 直接
  //   透传目录 id，导致 ARK 返回 404 InvalidEndpointOrModel.NotFound。
  if (adapter.protocol === 'doubao_music' || adapter.id === 'doubao_music') {
    const doubaoMusic = require('../doubao-music');
    const musicKind = doubaoMusic.musicKindFrom(input.entryId || '', {
      ...input,
      model: input.model || fallbackModel,
      mode: input.genMode || input.mode,
    });
    const result = await doubaoMusic.runMusicJob(services, {
      kind: musicKind,
      params: input,
      jobId: input.jobId || `music_${Date.now()}`,
    });
    return { ok: true, success: true, files: result.files || [], ...result };
  }

  if (adapter.protocol === 'indextts_local' || adapter.id === 'indextts_local') {
    return require('./indextts-local').runVoiceJob(services, adapter, input);
  }
  if (adapter.protocol === 'acestep_local' || adapter.id === 'acestep_local') {
    return require('./acestep-local').runMusicJob(services, adapter, input);
  }

  const requestedModel = input.model || defaultModelFromCfg || fallbackModel;
  let apiModel = requestedModel;
  try {
    const { resolveModelCode } = require('../studio-catalog');
    apiModel = resolveModelCode(requestedModel) || requestedModel;
  } catch (e) {
    if (logger?.warn) logger.warn('[gen] 模型 code 归一失败，按原值下发:', e.message);
  }

  // 智能参考图解析器：支持本地文件路径、本地遮罩路径、资产库缩略图/原图、缓存文件、以及 HTTP(S) 地址（自动回环拉取）转 Base64 Data URL

  // SEC-006：受控本地目录白名单（与 ai-tasks.resolveAssetBuffer 同规则）
  function isControlledLocalPath(p) {
    try {
      const os = require('os');
      const roots = [
        config?.dataDir,
        process.env.ML_DATA_DIR,
        path.join(os.homedir(), '.dsh-material-library'),
      ];
      try { roots.push(require('../nasstore').nasMaterialDir(config)); } catch {}
      const resolved = path.resolve(String(p));
      return roots.filter(Boolean).map((r) => path.resolve(r))
        .some((r) => resolved === r || resolved.startsWith(r + path.sep));
    } catch {
      return false;
    }
  }

  // SEC-006：内网/元数据地址判定（10.0.2.2 为安卓模拟器宿主别名，豁免）
  function isPrivateFetchHost(host) {
    const h = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
    if (!h) return true;
    if (h === 'localhost' || h === '::1' || /^127\./.test(h) || /^0\./.test(h)) return false; // 自身回环：参考图转换逻辑需要
    if (/^169\.254\./.test(h)) return true;
    if (/^10\./.test(h)) return h !== '10.0.2.2';
    if (/^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
    if (h === 'metadata.google.internal') return true;
    return false;
  }

  async function resolveImageToDataUrl(raw) {
    if (!raw) return null;
    const s = String(raw).trim();
    if (!s) return null;
    if (s.startsWith('data:image/')) return s;

    // 1. 本地文件绝对路径（SEC-006：仅受控目录内可读，防任意路径读取）
    if (fs.existsSync(s) && fs.statSync(s).isFile()) {
      if (!isControlledLocalPath(s)) {
        if (logger?.warn) logger.warn('[gen] 参考图路径超出受控目录，拒绝读取（SEC-006）:', s.slice(0, 120));
      } else {
        try {
          const buf = fs.readFileSync(s);
          const ext = path.extname(s).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          return `data:${mime};base64,${buf.toString('base64')}`;
        } catch (e) {
          if (logger?.warn) logger.warn('[gen] 读取本地参考图失败:', e.message);
        }
      }
    }

    // 2. 本地 AI 遮罩 / 选区文件 (/api/viewer/ai/masks/:maskId)
    const mMask = s.match(/\/api\/(?:viewer\/)?ai\/masks\/([^/?#]+)/);
    if (mMask) {
      try {
        const { resolveMaskFile } = require('../umbra');
        const mPath = resolveMaskFile(config, mMask[1]);
        if (mPath && fs.existsSync(mPath)) {
          const buf = fs.readFileSync(mPath);
          const ext = path.extname(mPath).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          return `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch (e) {}
    }

    // 3. 本地临时缓存文件 (/api/cache/temp/:filename)
    const mTemp = s.match(/\/api\/cache\/temp\/([^/?#]+)/);
    if (mTemp) {
      const tPath = path.join(config.dataDir, 'cache', 'temp', mTemp[1]);
      if (fs.existsSync(tPath)) {
        try {
          const buf = fs.readFileSync(tPath);
          const ext = path.extname(tPath).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          return `data:${mime};base64,${buf.toString('base64')}`;
        } catch (e) {}
      }
    }

    // 4. 素材库资产 (/api/viewer/assets/:fid/image 或 /api/assets/:fid/image)
    const mAsset = s.match(/\/api\/(?:viewer\/)?assets\/([^/?#]+)/);
    if (mAsset) {
      const fid = decodeURIComponent(mAsset[1]);
      const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`);
      if (fs.existsSync(thumb)) {
        try {
          const buf = fs.readFileSync(thumb);
          return `data:image/jpeg;base64,${buf.toString('base64')}`;
        } catch (e) {}
      }
      try {
        const row = services.db?.prepare("SELECT storage_path FROM derivatives WHERE asset_fid=? AND storage_type='nas' LIMIT 1").get(fid)
                 || services.db?.prepare("SELECT storage_path FROM assets WHERE fid=?").get(fid);
        if (row?.storage_path && fs.existsSync(row.storage_path)) {
          const buf = fs.readFileSync(row.storage_path);
          const ext = path.extname(row.storage_path).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
          return `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch (e) {}
    }

    // 5. 各种 HTTP/HTTPS URL（自动将本地/穿透端口转换为 127.0.0.1 回环拉取，避免 NAT 限制与外网解析）
    if (/^https?:\/\//i.test(s) || s.startsWith('/')) {
      let fetchUrl = s;
      const portStr = String(config.port || 30001);
      if (s.startsWith('/')) {
        fetchUrl = `http://127.0.0.1:${portStr}${s}`;
      } else {
        try {
          const uObj = new URL(s);
          if (uObj.port === portStr || uObj.hostname === '127.0.0.1' || uObj.hostname === 'localhost') {
            fetchUrl = `http://127.0.0.1:${portStr}${uObj.pathname}${uObj.search}`;
          }
        } catch (e) {}
      }
      // SEC-006：SSRF 防护——非自身回环的内网/元数据目标一律拒绝
      //（回环转换后的 fetchUrl 恒为 127.0.0.1:自端口，属自身访问，放行）。
      try {
        const fu = new URL(fetchUrl);
        const selfLoopback = fu.hostname === '127.0.0.1' && fu.port === portStr;
        if (!selfLoopback && isPrivateFetchHost(fu.hostname)) {
          if (logger?.warn) logger.warn('[gen] 参考图 URL 指向内网，已拒绝（SEC-006）:', fetchUrl.slice(0, 120));
          return null;
        }
      } catch (e) {}
      try {
        const r = await fetch(fetchUrl, { signal: AbortSignal.timeout(15000) });
        if (r.ok) {
          const ab = await r.arrayBuffer();
          const buf = Buffer.from(ab);
          const mime = r.headers.get('content-type') || 'image/jpeg';
          return `data:${mime};base64,${buf.toString('base64')}`;
        }
      } catch (e) {
        if (logger?.warn) logger.warn('[gen] 远端参考图拉取转 Base64 失败:', e.message);
      }
    }

    return null;
  }

  let imageB64 = '';
  let imageDataUrl = '';
  const refPath = input.imageLocalPaths?.[0];
  const firstUrl = (input.imageUrls || [])[0];

  if (refPath) {
    imageDataUrl = (await resolveImageToDataUrl(refPath)) || '';
  }
  if (!imageDataUrl && firstUrl) {
    imageDataUrl = (await resolveImageToDataUrl(firstUrl)) || '';
  }
  if (imageDataUrl) {
    const comma = imageDataUrl.indexOf(',');
    if (comma !== -1) imageB64 = imageDataUrl.slice(comma + 1);
  }

  const extraImageDataUrls = [];
  const extraCandidates = [
    ...(Array.isArray(input.imageLocalPaths) ? input.imageLocalPaths.slice(1) : []),
    ...(Array.isArray(input.imageUrls) ? input.imageUrls.slice(1) : [])
  ];
  for (const cand of extraCandidates) {
    const dUrl = await resolveImageToDataUrl(cand);
    if (dUrl) extraImageDataUrls.push(dUrl);
  }

  // ★ mask 出口：把栅格化蒙版作为**最后一张**参考图交给原生吃蒙版的模型
  //   （约定：image[0]=场景，中间=参考图，最后一张=蒙版）。仅当调用方显式给了 maskPath。
  if (input.maskPath && fs.existsSync(input.maskPath)) {
    const maskDataUrl = await resolveImageToDataUrl(input.maskPath);
    if (maskDataUrl) extraImageDataUrls.push(maskDataUrl);
  }

  const vars = {
    prompt: input.prompt || '',
    negativePrompt: input.negativePrompt || '',
    model: apiModel,
    modelId: requestedModel, // 目录 id / alias，供 schema、polish、caps 查询
    ratio: input.ratio || '9:16',
    size: input.size || (input.ratio === '9:16' ? '1024x1792' : '1024x1024'),
    duration: String(input.durationSec || 5),
    seed: input.seed || Math.floor(Math.random() * 1000000),
    image_b64: imageB64,
    image_data_url: imageDataUrl,
    image_urls: input.imageUrls || [],
    extra_image_data_urls: extraImageDataUrls,
    first_frame: input.firstFrame || '',
    last_frame: input.lastFrame || '',
    gen_mode: input.genMode || '',
    ...(input.extras || {})
  };

  const headers = {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(secrets.extraHeaders || {}),
    ...(cfg.submitHeaders || {})
  };

  const tempDir = path.join(config.dataDir, 'cache', 'temp');
  fs.mkdirSync(tempDir, { recursive: true });

  function resolveUrl(base, pathStr) {
    const b = (base || '').replace(/\/$/, '');
    const p = (pathStr || '').startsWith('/') ? pathStr : '/' + (pathStr || '');
    if (b.endsWith('/v1') && p.startsWith('/v1/')) {
      return b + p.slice(3);
    }
    return b + p;
  }

  function resolvePollUrl(base, template, v, currentTaskId) {
    const finalModel = v.model || fallbackModel;
    const mergedVars = { ...v, model: finalModel, taskId: currentTaskId };
    let pathStr = fillTemplate(template, mergedVars);
    let b = (base || '').replace(/\/$/, '');
    if (pathStr.startsWith('/agnesapi') && b.endsWith('/v1')) {
      b = b.slice(0, -3);
    }
    if (b.endsWith('/v1') && pathStr.startsWith('/v1/')) {
      return b + pathStr.slice(3);
    }
    if (pathStr.startsWith('http://') || pathStr.startsWith('https://')) {
      return pathStr;
    }
    return `${b}${pathStr.startsWith('/') ? '' : '/'}${pathStr}`;
  }

  /**
   * 按照 Agnes Image 2.5 Flash 官方规范与检查清单约束 Payload
   */
  function normalizeAgnesImagePayload(body, v, inp) {
    const isAgnes = (body.model || v.model || '').includes('agnes-image') ||
                    (adapter.id || '').includes('agnes') ||
                    baseUrl.includes('agnes-ai.com') || baseUrl.includes('agnes-ai.cn');
    if (!isAgnes || (body.model || v.model || '').includes('agnes-video')) return body;

    const prompt = body.prompt || v.prompt;
    if (!prompt || !String(prompt).trim()) {
      throw new Error('[Agnes Image] prompt 为必填参数且不能为空');
    }
    const ratio = body.ratio || v.ratio || inp.ratio || '9:16';
    const { convertAgnesImageRequest } = require('../converters');
    let modelContract = null;
    try {
      const { resolveModelExecution } = require('../models-contract');
      modelContract = resolveModelExecution(services.db, body.model || v.model || 'agnes_image_2_5_flash')?.model || null;
    } catch (_) {}
    const converted = convertAgnesImageRequest({
      rawInput: {
        ...(inp || {}),
        ...(v || {}),
        ...(body || {}),
        prompt: String(prompt).trim(),
        ratio,
        model: body.model || v.model || 'agnes-image-2.5-flash',
      },
      modelContract,
    });
    return converted.body || converted.payload;
  }

  /**
   * 按照 Agnes Video 2.5 Flash 官方规范约束异步生成 Payload
   */
  function normalizeAgnesVideoPayload(body, v, inp) {
    const isAgnesVideo = (body.model || v.model || '').includes('agnes-video') ||
                         (adapter.id || '').includes('agnes_video') ||
                         baseUrl.includes('agnes-ai.com') || baseUrl.includes('agnes-ai.cn');
    if (!isAgnesVideo || (body.model || v.model || '').includes('agnes-image')) return body;

    if (!apiKey) {
      throw new Error('[Agnes AI] 请先在提供商设置中配置 Agnes AI 的 API Key');
    }

    const prompt = body.prompt || v.prompt;
    if (!prompt || !String(prompt).trim()) {
      throw new Error('[Agnes Video] prompt 为必填参数且不能为空');
    }
    const { convertAgnesVideoRequest } = require('../converters');
    let modelContract = null;
    try {
      const { resolveModelExecution } = require('../models-contract');
      modelContract = resolveModelExecution(services.db, body.model || v.model || 'agnes_video_2_5_flash')?.model || null;
    } catch (_) {}
    const converted = convertAgnesVideoRequest({
      rawInput: {
        ...(inp || {}),
        ...(v || {}),
        ...(body || {}),
        prompt: String(prompt).trim(),
        model: body.model || v.model || 'agnes-video-2.5-flash',
        mode: inp.genMode || v.gen_mode || body.mode || body.client_mode,
        ratio: body.aspect_ratio || body.ratio || v.ratio || inp.ratio || '16:9',
        seconds: body.seconds || v.duration || inp.durationSec || '5',
      },
      modelContract,
    });
    return converted.body || converted.payload;
  }

  /**
   * 按照火山引擎方舟 Seedance 规范约束视频生成 Payload
   */
  function normalizeVolcengineVideoPayload(body, v, inp) {
    const isVolc = (adapter.id || '').includes('ark_seedance') ||
                   (body.model || v.model || '').includes('seedance') ||
                   baseUrl.includes('volces.com');

    const portraits = Array.isArray(v.portrait_assets) ? v.portrait_assets : [];
    const rawPrompt = body.prompt || v.prompt || '';
    const prompt = portraits.length ? rawPrompt : (rawPrompt || '室内空间全景镜头平移漫游效果');
    const finalModel = body.model || v.model || 'doubao-video-seedance';
    const images = [];
    if (v.image_data_url) images.push(v.image_data_url);
    if (Array.isArray(v.extra_image_data_urls)) {
      v.extra_image_data_urls.forEach((u) => { if (u && !images.includes(u)) images.push(u); });
    }
    if (!images.length && Array.isArray(v.image_urls)) {
      v.image_urls.forEach((u) => { if (u) images.push(u); });
    }
    const shaped = shapeVolcVideo({
      isVolc,
      model: finalModel,
      prompt,
      images,
      firstFrameUrl: v.first_frame || (inp && inp.firstFrame) || '',
      genMode: (inp && inp.genMode) || v.gen_mode || '',
      ratio: body.aspect_ratio || body.ratio || (inp && inp.ratio) || v.ratio,
      duration: body.duration || (inp && inp.durationSec) || v.duration,
      portraits,
    });
    if (shaped) {
      if (!apiKey) {
        throw new Error('[火山方舟] 请先在提供商设置中配置火山引擎 (Volcengine) 的 API Key');
      }
      const out = { ...shaped };
      delete out.caption;
      return out;
    }
    if (!isVolc) return body;

    if (!apiKey) {
      throw new Error('[火山方舟] 请先在提供商设置中配置火山引擎 (Volcengine) 的 API Key');
    }

    const content = [{ type: 'text', text: String(prompt).trim() }];
    const refs = images.slice(0, 6);
    if (refs.length <= 1) {
      if (refs[0]) content.push({ type: 'image_url', image_url: { url: refs[0] } });
    } else {
      refs.forEach((url) => {
        content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' });
      });
    }

    const ratio = body.aspect_ratio || body.ratio || inp.ratio || v.ratio;
    const durationNum = Number(body.duration || inp.durationSec || v.duration);
    const out = { model: finalModel, content };
    if (ratio) out.ratio = ratio;
    if (Number.isFinite(durationNum) && durationNum > 0) {
      out.duration = Math.max(4, Math.min(12, Math.round(durationNum)));
    }
    return out;
  }

  /**
   * 按照魔搭 ModelScope 规范约束 Payload
   */
  function normalizeModelScopePayload(body, v, inp) {
    const isMS = (adapter.id || '').includes('modelscope') || baseUrl.includes('modelscope.cn');
    if (!isMS) return body;

    if (!apiKey) {
      throw new Error('[ModelScope] 请先在提供商设置中配置魔搭社区 (ModelScope) 的 API Key');
    }

    const prompt = body.prompt || v.prompt;
    if (!prompt || !String(prompt).trim()) {
      throw new Error('[ModelScope] prompt 为必填参数且不能为空');
    }

    return body;
  }

  // ---- 1. 同步 JSON 协议 ----
  if (adapter.protocol === 'http_json') {
    const reqUrl = resolveUrl(baseUrl, cfg.path || '/v1/images/generations');
    let bodyObj = fillTemplate(cfg.bodyTemplate || { prompt: '{{prompt}}', model: '{{model}}' }, vars);
    if (bodyObj && typeof bodyObj === 'object') {
      if (bodyObj.image === '' || (Array.isArray(bodyObj.image) && bodyObj.image.length === 0)) delete bodyObj.image;
      if (bodyObj.image_data_url === '') delete bodyObj.image_data_url;
    }
    bodyObj = normalizeArkSeedreamPayload(bodyObj, vars, input, { adapter, baseUrl, cfg, apiKey });
    bodyObj = normalizeAgnesImagePayload(bodyObj, vars, input);
    bodyObj = normalizeModelScopePayload(bodyObj, vars, input);

    let res;
    try {
      res = await fetch(reqUrl, {
        method: cfg.method || 'POST',
        headers,
        body: JSON.stringify(bodyObj),
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (e) {
      noteVendorOutcome(input, false, e.message || '');
      throw enrichFetchError(e, '生成服务网络请求失败');
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      noteVendorOutcome(input, false, errText);
      throw new Error(`生成服务请求失败 HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    noteVendorOutcome(input, true);

    const data = await res.json();
    const isPngOut = Boolean(bodyObj && (bodyObj.output_format === 'png' || bodyObj.background === 'transparent' || bodyObj.layer_decomposition === true));
    const defaultImgExt = isPngOut ? '.png' : '.jpg';
    const defaultImgMime = isPngOut ? 'image/png' : 'image/jpeg';

    // 支持 Seedream 5.0 图层分解 (layer_decomposition) 及 Lite 多图连拍返回的多张 data[]
    const dataArr = Array.isArray(data?.data) ? data.data : [];
    if (input.kind !== 'video' && dataArr.length > 1) {
      const files = [];
      for (let i = 0; i < dataArr.length; i++) {
        const item = dataArr[i] || {};
        const itemFileName = `gen_${Date.now()}_${i}_${crypto.randomBytes(3).toString('hex')}${defaultImgExt}`;
        const itemPath = path.join(tempDir, itemFileName);
        if (item.b64_json) {
          fs.writeFileSync(itemPath, Buffer.from(item.b64_json, 'base64'));
        } else if (item.url) {
          await downloadToFile(item.url, itemPath, { timeoutMs: 120000 });
        } else {
          continue;
        }
        let itemMeta = { mime: defaultImgMime };
        try {
          const info = await sharp(itemPath).metadata();
          itemMeta = { width: info.width, height: info.height, mime: info.format === 'png' ? 'image/png' : defaultImgMime };
        } catch {}
        files.push({
          localPath: itemPath,
          previewUrl: `/api/cache/temp/${itemFileName}`,
          mime: itemMeta.mime,
          width: itemMeta.width,
          height: itemMeta.height,
          layerIndex: i,
          role: bodyObj?.layer_decomposition ? (i === 0 ? 'background' : `layer_${i}`) : `image_${i + 1}`,
          label: bodyObj?.layer_decomposition ? (i === 0 ? '底层背景 (Layer 0)' : `独立前景图层 #${i}`) : `生成图 #${i + 1}`,
        });
      }
      if (files.length) {
        let layerStack = null;
        try {
          const { normalizeArkSeedreamResponse } = require('../converters');
          layerStack = normalizeArkSeedreamResponse(
            { data: files.map(f => ({ url: f.previewUrl, width: f.width, height: f.height })) },
            { layerDecomposition: Boolean(bodyObj?.layer_decomposition) }
          );
        } catch (_) {}
        return {
          ok: true,
          success: true,
          files,
          layerStack,
          raw: data,
        };
      }
    }

    const resultUrl = getNested(data, cfg.resultUrlPath || 'data.0.url') || data.url;
    const resultB64 = getNested(data, cfg.resultB64Path || 'data.0.b64_json');

    const outExt = input.kind === 'video' ? '.mp4' : defaultImgExt;
    const outFileName = `gen_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${outExt}`;
    const outPath = path.join(tempDir, outFileName);

    if (resultB64) {
      fs.writeFileSync(outPath, Buffer.from(resultB64, 'base64'));
    } else if (resultUrl) {
      await downloadToFile(resultUrl, outPath, { timeoutMs: 120000 });
    } else {
      throw new Error('生成服务响应中未找到图片 URL 或 Base64 数据: ' + JSON.stringify(data).slice(0, 200));
    }

    let meta = {};
    if (input.kind !== 'video') {
      try {
        const info = await sharp(outPath).metadata();
        meta = { width: info.width, height: info.height, mime: info.format === 'png' ? 'image/png' : defaultImgMime };
      } catch {}
    } else {
      meta = { mime: 'video/mp4' };
    }

    const previewUrl = `/api/cache/temp/${outFileName}`;
    return {
      ok: true,
      success: true,
      files: [{ localPath: outPath, previewUrl, mime: meta.mime, width: meta.width, height: meta.height }],
      raw: data
    };
  }

  // ---- 本地 QwenImage（ncnn-vulkan）----
  // Agnes 的并行补充/降级通道。必须放在 http_json 之前独占分支：
  // 它要 multipart/form-data + 异步轮询 + 从面板取产物，与通用协议都不同。
  if (adapter.protocol === 'qwenimage_local') {
    const qwenLocal = require('./qwenimage-local');
    return qwenLocal.runImageJob(services, adapter, input);
  }

  // ---- 2. 异步任务轮询协议 (async_http_job) ----
  if (adapter.protocol === 'async_http_job') {
    const submitUrl = resolveUrl(baseUrl, cfg.submitPath);
    let submitBody = fillTemplate(cfg.submitBodyTemplate || { prompt: '{{prompt}}', model: '{{model}}' }, vars);
    submitBody = normalizeAgnesVideoPayload(submitBody, vars, input);
    submitBody = normalizeVolcengineVideoPayload(submitBody, vars, input);
    submitBody = normalizeModelScopePayload(submitBody, vars, input);

    let submitRes = null;
    let submitData = null;
    let lastErrText = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        submitRes = await fetch(submitUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(submitBody),
          signal: AbortSignal.timeout(60000)
        });
      } catch (e) {
        noteVendorOutcome(input, false, e.message || '');
        throw enrichFetchError(e, '异步任务提交网络失败');
      }
      if (submitRes.ok) {
        submitData = await submitRes.json();
        break;
      }
      lastErrText = await submitRes.text().catch(() => '');
      if ((submitRes.status === 503 || submitRes.status === 429) && attempt < 2) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }
      break;
    }

    if (!submitRes || !submitRes.ok) {
      noteVendorOutcome(input, false, lastErrText);
      throw new Error(`异步任务提交失败 HTTP ${submitRes?.status || 500}: ${lastErrText.slice(0, 300)}`);
    }

    const taskId = getNested(submitData, cfg.taskIdPath || 'task_id') ||
                   submitData.video_id ||
                   submitData.id ||
                   submitData.task_id;
    if (!taskId) {
      throw new Error('未解析到异步任务 ID: ' + JSON.stringify(submitData).slice(0, 200));
    }

    // 开始轮询
    const pollInterval = cfg.pollIntervalMs || 4000;
    const startTime = Date.now();
    const pollUrlTemplate = cfg.pollPathTemplate || '/v1/tasks/{{taskId}}';

    while (Date.now() - startTime < timeoutMs) {
      await new Promise(r => setTimeout(r, pollInterval));
      const pollUrl = resolvePollUrl(baseUrl, pollUrlTemplate, vars, taskId);
      const pollRes = await fetch(pollUrl, {
        method: cfg.pollMethod || 'GET',
        headers,
        signal: AbortSignal.timeout(30000)
      });
      if (!pollRes.ok) continue;

      const pollData = await pollRes.json();
      const status = String(getNested(pollData, cfg.statusPath || 'status') || '').toLowerCase();
      const successVals = (cfg.successValues || ['succeeded', 'success', 'completed']).map(v => v.toLowerCase());
      const failVals = (cfg.failValues || ['failed', 'fail', 'error']).map(v => v.toLowerCase());

      if (successVals.includes(status)) {
        const resultUrl = (cfg.resultUrlPath ? getNested(pollData, cfg.resultUrlPath) : null) ||
                          getNested(pollData, 'metadata.url') ||
                          getNested(pollData, 'content.video_url') ||
                          getNested(pollData, 'output_images.0') ||
                          getNested(pollData, 'output_video') ||
                          getNested(pollData, 'video_url') ||
                          getNested(pollData, 'data.0.url') ||
                          pollData.url;
        if (!resultUrl) throw new Error('任务成功但未找到输出 URL: ' + JSON.stringify(pollData).slice(0, 200));

        const outExt = input.kind === 'video' ? '.mp4' : '.jpg';
        const outFileName = `gen_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${outExt}`;
        const outPath = path.join(tempDir, outFileName);

        await downloadToFile(resultUrl, outPath, { timeoutMs: 120000 });
        const previewUrl = `/api/cache/temp/${outFileName}`;
        noteVendorOutcome(input, true);
        return {
          ok: true,
          success: true,
          taskId,
          files: [{ localPath: outPath, previewUrl, mime: input.kind === 'video' ? 'video/mp4' : 'image/jpeg' }],
          raw: pollData
        };
      }

      if (failVals.includes(status)) {
        const errMsg = getNested(pollData, cfg.errorPath || 'error') || '异步生成任务失败';
        noteVendorOutcome(input, false, String(errMsg));
        throw new Error(String(errMsg));
      }
    }

    if (input.allowPendingTimeout) {
      noteVendorOutcome(input, true);
      return {
        ok: true,
        success: true,
        taskId,
        pending: true,
        message: `视频生成任务已成功提交！\n• 任务 ID: ${taskId}\n• 模型: ${vars.model}\n• 状态: 官方云端排队生成中 (云端视频渲染通常需 1~3 分钟，产线后台将自动对账下载)`
      };
    }

    noteVendorOutcome(input, false, '异步生成超时');
    throw new Error(`异步生成超时 (${Math.round(timeoutMs/1000)}s), 任务 ID: ${taskId}`);
  }

  // ---- 3. 统一处理网关 (unified_gateway) ----
  // 契约：POST submit {action, params, input:{fid|url}} → {request_id}
  //       POST poll   {request_id} → {status, progress, result:{url,...}, error?}
  if (adapter.protocol === 'unified_gateway') {
    const submitUrl = resolveUrl(baseUrl, cfg.submitPath || '/');
    const action = vars.action || input.extras?.action || '';
    const params = vars.params || input.extras?.params || {};
    const fid = vars.fid || input.extras?.fid || '';
    if (!action) throw new Error('unified_gateway 缺少 action');

    const submitBody = {
      action,
      params,
      input: {
        fid,
        ...(vars.file_name || input.extras?.file_name ? { file_name: vars.file_name || input.extras.file_name } : {})
      }
    };
    if (imageDataUrl) submitBody.input.image_data_url = imageDataUrl;

    const submitRes = await fetch(submitUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(submitBody),
      signal: AbortSignal.timeout(60000)
    });
    const submitText = await submitRes.text();
    if (!submitRes.ok) {
      throw new Error(`统一网关提交失败 HTTP ${submitRes.status}: ${submitText.slice(0, 300)}`);
    }
    let submitData;
    try { submitData = JSON.parse(submitText); } catch {
      throw new Error('统一网关提交响应非 JSON: ' + submitText.slice(0, 200));
    }
    const requestId = getNested(submitData, cfg.taskIdPath || 'request_id') || submitData.request_id || submitData.id;
    if (!requestId) throw new Error('统一网关未返回 request_id: ' + submitText.slice(0, 200));

    const pollUrl = resolveUrl(baseUrl, cfg.pollPath || cfg.submitPath || '/');
    const pollInterval = cfg.pollIntervalMs || 2000;
    const startTime = Date.now();
    while (Date.now() - startTime < timeoutMs) {
      await new Promise(r => setTimeout(r, pollInterval));
      const pollRes = await fetch(pollUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ request_id: requestId }),
        signal: AbortSignal.timeout(30000)
      });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const status = String(getNested(pollData, cfg.statusPath || 'status') || '').toLowerCase();
      if (status === 'done' || status === 'succeeded' || status === 'success') {
        const resultUrl = getNested(pollData, cfg.resultUrlPath || 'result.url') || pollData.result?.url || pollData.url;
        if (!resultUrl) throw new Error('统一网关成功但无 result.url');
        const outExt = input.kind === 'video' ? '.mp4' : '.jpg';
        const outFileName = `gw_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${outExt}`;
        const outPath = path.join(tempDir, outFileName);
        await downloadToFile(resultUrl, outPath, { timeoutMs: 120000 });
        let meta = { mime: input.kind === 'video' ? 'video/mp4' : 'image/jpeg' };
        try {
          if (input.kind !== 'video') {
            const info = await sharp(outPath).metadata();
            meta = { width: info.width, height: info.height, mime: info.format === 'png' ? 'image/png' : 'image/jpeg' };
          }
        } catch {}
        return {
          ok: true,
          success: true,
          taskId: requestId,
          files: [{
            localPath: outPath,
            previewUrl: `/api/cache/temp/${outFileName}`,
            mime: pollData.result?.mime || meta.mime,
            width: pollData.result?.width || meta.width,
            height: pollData.result?.height || meta.height
          }],
          raw: pollData
        };
      }
      if (status === 'failed' || status === 'error') {
        throw new Error(String(pollData.error || '统一网关任务失败'));
      }
      // queued/running：继续轮询；可把 progress 回写到 node_runs
      if (typeof pollData.progress === 'number' && input.onProgress) {
        try { input.onProgress(pollData.progress); } catch {}
      }
    }
    throw new Error(`统一网关轮询超时 (${Math.round(timeoutMs / 1000)}s), request_id=${requestId}`);
  }

  // ---- 4. Google Interactions（Omni 视频 / Nano Banana 图 / Lyria 音频）----
  if (adapter.protocol === 'gemini_interactions' || adapter.protocol === 'gemini_lyria') {
    if (!apiKey) {
      throw new Error('Gemini API Key 未配置（llm_providers.gemini 或适配器 secrets）');
    }
    const mediaType = adapter.protocol === 'gemini_lyria'
      ? 'audio'
      : (cfg.responseType || (adapter.kind === 'image' ? 'image' : adapter.kind === 'music' ? 'audio' : 'video'));
    // 默认模型按 mediaType 映射到官方目录对应域（禁止写死 Google model code；
    // Google 图像/视频已从官方目录下架，真需要时由调用方显式传 model）
    const domainForType = mediaType === 'image' ? 'image' : mediaType === 'audio' ? 'music' : 'video';
    const catalogFallback = catalogDefaultCode(domainForType, 'gemini');
    if (!vars.model && !cfg.defaultModel && !catalogFallback) {
      console.warn(`[gen] 适配器 ${adapter.id} 未指定 model，且官方目录 ${domainForType} 域无 gemini 系默认模型`);
    }
    const model = String(vars.model || cfg.defaultModel || catalogFallback || '');
    const root = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const keyQ = `key=${encodeURIComponent(apiKey)}`;
    const geminiHeaders = {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    };

    const parts = [];
    const pushImage = (raw, mimeHint) => {
      if (!raw) return;
      const s = String(raw);
      const m = s.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        parts.push({ type: 'image', mime_type: m[1], data: m[2] });
        return;
      }
      if (/^https?:\/\//i.test(s)) {
        if (/127\.0\.0\.1|localhost|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[0-1])\./i.test(s)) {
          return;
        }
        parts.push({ type: 'image', uri: s, mime_type: mimeHint || 'image/jpeg' });
        return;
      }
      if (s.length > 200 && !s.includes('://')) {
        parts.push({ type: 'image', mime_type: mimeHint || 'image/jpeg', data: s });
      }
    };
    pushImage(vars.image_data_url);
    if (Array.isArray(vars.extra_image_data_urls)) vars.extra_image_data_urls.forEach((u) => pushImage(u));
    if (Array.isArray(vars.image_urls)) vars.image_urls.forEach((u) => pushImage(u));
    pushImage(vars.first_frame);
    pushImage(vars.last_frame);
    const defaultPrompt = mediaType === 'image'
      ? 'Generate an image.'
      : mediaType === 'audio'
        ? 'A warm instrumental background piece, piano and light strings, 30 seconds.'
        : 'Generate a short cinematic video.';
    parts.push({
      type: 'text',
      text: String(vars.prompt || '').trim() || defaultPrompt,
    });

    const response_format = { type: mediaType === 'audio' ? 'audio' : mediaType };
    if (mediaType === 'video') {
      const resolution = String(vars.resolution || vars.size || '720p').toLowerCase().replace(/p$/i, 'p');
      response_format.resolution = /^(360p|720p|1080p|4k)$/i.test(resolution) ? resolution : '720p';
      if (vars.ratio) response_format.aspect_ratio = vars.ratio;
      if (vars.duration) {
        const dur = Number(vars.duration);
        if (Number.isFinite(dur) && dur > 0) response_format.duration = String(Math.round(dur));
      }
    } else if (mediaType === 'image') {
      if (vars.ratio) response_format.aspect_ratio = vars.ratio;
      const rawSize = String(vars.image_size || vars.size || '1K');
      let imageSize = '1K';
      if (/4k|4096/i.test(rawSize)) imageSize = '4K';
      else if (/2k|2048/i.test(rawSize)) imageSize = '2K';
      else if (/512/i.test(rawSize)) imageSize = '512px';
      else if (/^[124]K$/i.test(rawSize)) imageSize = rawSize.toUpperCase();
      response_format.image_size = imageSize;
    }

    const body = {
      model,
      input: parts.length === 1 && parts[0].type === 'text' ? parts[0].text : parts,
      response_format,
    };
    if (mediaType === 'video') {
      const hasImage = parts.some((p) => p.type === 'image');
      body.generation_config = {
        video_config: { task: hasImage ? 'image_to_video' : 'text_to_video' },
      };
    }

    const submitUrl = `${root}/v1beta/interactions?${keyQ}`;
    const submitRes = await fetch(submitUrl, {
      method: 'POST',
      headers: geminiHeaders,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(timeoutMs, 180000)),
    });
    const submitText = await submitRes.text().catch(() => '');
    if (!submitRes.ok) {
      throw new Error(`Gemini 提交失败 HTTP ${submitRes.status}: ${submitText.slice(0, 400)}`);
    }
    let data = {};
    try { data = JSON.parse(submitText); } catch {
      throw new Error('Gemini 响应不是 JSON: ' + submitText.slice(0, 200));
    }

    const typeKeys = mediaType === 'image'
      ? ['image']
      : mediaType === 'audio'
        ? ['audio', 'output_audio']
        : ['video', 'output_video'];
    const mimePrefix = mediaType === 'image' ? 'image/' : mediaType === 'audio' ? 'audio/' : 'video/';
    const walkMedia = (obj, want) => {
      if (!obj || typeof obj !== 'object') return '';
      if (obj.type && typeKeys.includes(obj.type) && obj[want]) return obj[want];
      if (obj.mime_type && String(obj.mime_type).startsWith(mimePrefix) && obj[want]) return obj[want];
      if (obj.inline_data && obj.inline_data[want]) return obj.inline_data[want];
      if (Array.isArray(obj)) {
        for (const it of obj) {
          const hit = walkMedia(it, want);
          if (hit) return hit;
        }
        return '';
      }
      for (const k of ['output_video', 'output_image', 'output_audio', 'video', 'image', 'audio', 'output', 'outputs', 'steps', 'content', 'result', 'candidates']) {
        if (obj[k]) {
          const hit = walkMedia(obj[k], want);
          if (hit) return hit;
        }
      }
      return '';
    };
    const statusOf = (obj) => String(obj.status || obj.state || '').toLowerCase();
    const pending = (st) => /pending|queued|running|processing|in_progress|in-progress|incomplete/.test(st);

    let mediaB64 = walkMedia(data, 'data');
    let mediaUrl = walkMedia(data, 'uri') || walkMedia(data, 'url');
    const interactionId = data.id || data.interaction_id || data.name;
    const needPoll = (!mediaB64 && !mediaUrl) || pending(statusOf(data));
    if (needPoll && interactionId) {
      const pollEvery = cfg.pollIntervalMs || 4000;
      const startAt = Date.now();
      while (Date.now() - startAt < timeoutMs) {
        await new Promise((r) => setTimeout(r, pollEvery));
        if (input.onProgress) {
          const elapsed = Date.now() - startAt;
          try { input.onProgress(Math.min(90, 20 + Math.round((elapsed / timeoutMs) * 70))); } catch {}
        }
        const pollRes = await fetch(`${root}/v1beta/interactions/${encodeURIComponent(interactionId)}?${keyQ}`, {
          headers: { 'x-goog-api-key': apiKey },
          signal: AbortSignal.timeout(30000),
        });
        const pollText = await pollRes.text().catch(() => '');
        if (!pollRes.ok) {
          throw new Error(`Gemini 轮询失败 HTTP ${pollRes.status}: ${pollText.slice(0, 300)}`);
        }
        try { data = JSON.parse(pollText); } catch { continue; }
        mediaB64 = walkMedia(data, 'data');
        mediaUrl = walkMedia(data, 'uri') || walkMedia(data, 'url');
        const st = statusOf(data);
        if ((st === 'completed' || st === 'succeeded' || st === 'success' || st === 'done') && (mediaB64 || mediaUrl)) break;
        if (mediaB64 || mediaUrl) break;
        if (st === 'failed' || st === 'error' || st === 'cancelled') {
          throw new Error(data.error?.message || data.error || 'Gemini 生成失败');
        }
      }
    }

    const ext = mediaType === 'image' ? '.png' : mediaType === 'audio' ? '.mp3' : '.mp4';
    const mime = mediaType === 'image' ? 'image/png' : mediaType === 'audio' ? 'audio/mpeg' : 'video/mp4';
    const outFileName = `gen_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
    const outPath = path.join(tempDir, outFileName);
    if (mediaB64) {
      fs.writeFileSync(outPath, Buffer.from(mediaB64, 'base64'));
    } else if (mediaUrl) {
      let dl = mediaUrl;
      if (/generativelanguage\.googleapis\.com/i.test(dl) && !/[?&]key=/.test(dl)) {
        dl += (dl.includes('?') ? '&' : '?') + keyQ;
      }
      await downloadToFile(dl, outPath, {
        timeoutMs: 180000,
        headers: { 'x-goog-api-key': apiKey },
      });
    } else {
      throw new Error(`Gemini 未返回${mediaType}数据: ` + JSON.stringify(data).slice(0, 300));
    }

    let meta = { mime };
    if (mediaType === 'image') {
      try {
        const info = await sharp(outPath).metadata();
        meta = {
          width: info.width,
          height: info.height,
          mime: info.format === 'jpeg' ? 'image/jpeg' : 'image/png',
        };
      } catch {}
    }

    const previewUrl = `/api/cache/temp/${outFileName}`;
    return {
      ok: true,
      success: true,
      files: [{ localPath: outPath, previewUrl, mime: meta.mime, width: meta.width, height: meta.height, kind: mediaType === 'audio' ? 'audio' : mediaType }],
      raw: { id: interactionId || null },
    };
  }

  // ---- 5. Google Veo predictLongRunning ----
  if (adapter.protocol === 'gemini_veo') {
    if (!apiKey) {
      throw new Error('Gemini API Key 未配置（llm_providers.gemini 或适配器 secrets）');
    }
    // 模型解析链：调用方给的 model → 适配器行 config.defaultModel（migrate 已种）→ 官方目录 gemini 系
    // 三级都空就明确报错，**不再回落到写死的 'veo-3.1-generate-preview'**（那是会过期的知识点）
    const model = String(vars.model || cfg.defaultModel || catalogDefaultCode('video', 'gemini') || '');
    if (!model) {
      throw new Error(`Veo 适配器 ${adapter.id} 未指定模型：请传 model，或在适配器配置里设置 defaultModel`);
    }
    const root = (baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
    const keyQ = `key=${encodeURIComponent(apiKey)}`;

    const toVeoImage = (raw) => {
      if (!raw) return null;
      const s = String(raw);
      const m = s.match(/^data:([^;]+);base64,(.+)$/);
      if (m) return { bytesBase64Encoded: m[2], mimeType: m[1] };
      if (/^https?:\/\//i.test(s) && !/127\.0\.0\.1|localhost|192\.168\.|10\.\d+\.|172\.(1[6-9]|2\d|3[0-1])\./i.test(s)) {
        return { uri: s };
      }
      return null;
    };

    const instance = {
      prompt: String(vars.prompt || '').trim() || 'Cinematic interior camera move, natural light.',
    };
    const firstImg = toVeoImage(vars.first_frame) || toVeoImage(vars.image_data_url) || toVeoImage((vars.image_urls || [])[0]);
    if (firstImg) instance.image = firstImg;
    const lastImg = toVeoImage(vars.last_frame);
    if (lastImg) instance.lastFrame = lastImg;
    const refImgs = [];
    const extraRefs = [...(vars.extra_image_data_urls || []), ...((vars.image_urls || []).slice(firstImg ? 1 : 0))];
    for (const u of extraRefs) {
      const im = toVeoImage(u);
      if (im) refImgs.push({ image: im, referenceType: 'asset' });
      if (refImgs.length >= 3) break;
    }
    if (refImgs.length && !String(model).includes('lite')) {
      instance.referenceImages = refImgs;
    }

    let durationSeconds = Number(vars.duration || vars.durationSeconds || 8);
    if (![4, 6, 8].includes(durationSeconds)) durationSeconds = 8;
    let resolution = String(vars.resolution || '720p').toLowerCase();
    if (!/^(720p|1080p|4k)$/.test(resolution)) resolution = '720p';
    if (resolution !== '720p') durationSeconds = 8;
    const aspectRatio = vars.ratio === '9:16' ? '9:16' : '16:9';
    const personGeneration = firstImg || lastImg || refImgs.length ? 'allow_adult' : 'allow_all';

    const body = {
      instances: [instance],
      parameters: {
        aspectRatio,
        durationSeconds: String(durationSeconds),
        resolution,
        personGeneration,
      },
    };

    const submitUrl = `${root}/v1beta/models/${encodeURIComponent(model)}:predictLongRunning?${keyQ}`;
    const submitRes = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(Math.min(timeoutMs, 120000)),
    });
    const submitText = await submitRes.text().catch(() => '');
    if (!submitRes.ok) {
      throw new Error(`Veo 提交失败 HTTP ${submitRes.status}: ${submitText.slice(0, 400)}`);
    }
    let op = {};
    try { op = JSON.parse(submitText); } catch {
      throw new Error('Veo 响应不是 JSON: ' + submitText.slice(0, 200));
    }
    let opName = op.name || op.operation || '';
    if (!opName) throw new Error('Veo 未返回 operation name: ' + submitText.slice(0, 300));

    const pollEvery = cfg.pollIntervalMs || 5000;
    const startAt = Date.now();
    let donePayload = op;
    while (!donePayload.done && Date.now() - startAt < timeoutMs) {
      await new Promise((r) => setTimeout(r, pollEvery));
      if (input.onProgress) {
        const elapsed = Date.now() - startAt;
        try { input.onProgress(Math.min(90, 15 + Math.round((elapsed / timeoutMs) * 75))); } catch {}
      }
      const pollUrl = opName.startsWith('http')
        ? opName
        : `${root}/v1beta/${opName.replace(/^\//, '')}?${keyQ}`;
      const pollRes = await fetch(pollUrl, {
        headers: { 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(30000),
      });
      const pollText = await pollRes.text().catch(() => '');
      if (!pollRes.ok) {
        throw new Error(`Veo 轮询失败 HTTP ${pollRes.status}: ${pollText.slice(0, 300)}`);
      }
      try { donePayload = JSON.parse(pollText); } catch { continue; }
      if (donePayload.error) {
        throw new Error(donePayload.error.message || JSON.stringify(donePayload.error));
      }
    }
    if (!donePayload.done) {
      throw new Error(`Veo 轮询超时 (${Math.round(timeoutMs / 1000)}s)`);
    }

    const sample = donePayload.response?.generateVideoResponse?.generatedSamples?.[0]
      || donePayload.response?.generatedSamples?.[0]
      || {};
    const videoUri = sample.video?.uri || sample.video?.url || sample.uri || sample.url;
    const videoB64 = sample.video?.bytesBase64Encoded || sample.bytesBase64Encoded;
    const outFileName = `gen_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.mp4`;
    const outPath = path.join(tempDir, outFileName);
    if (videoB64) {
      fs.writeFileSync(outPath, Buffer.from(videoB64, 'base64'));
    } else if (videoUri) {
      let dl = videoUri;
      if (/generativelanguage\.googleapis\.com/i.test(dl) && !/[?&]key=/.test(dl)) {
        dl += (dl.includes('?') ? '&' : '?') + keyQ;
      }
      await downloadToFile(dl, outPath, {
        timeoutMs: 180000,
        headers: { 'x-goog-api-key': apiKey },
      });
    } else {
      throw new Error('Veo 未返回视频: ' + JSON.stringify(donePayload).slice(0, 400));
    }

    const previewUrl = `/api/cache/temp/${outFileName}`;
    return {
      ok: true,
      success: true,
      files: [{ localPath: outPath, previewUrl, mime: 'video/mp4', kind: 'video' }],
      raw: { name: opName },
    };
  }

  // ---- 6. 动态新协议适配器 (src/gen/adapters/) ----
  const { getAdapterModule } = require('./adapters');
  const customAdapter = getAdapterModule(adapter.protocol);
  if (customAdapter) {
    if (typeof customAdapter.execute === 'function') {
      return await customAdapter.execute(services, adapter, input);
    }
    const reqInfo = await customAdapter.buildRequest({ baseUrl, apiKey, vars, cfg, secrets, input });
    const fetchHeaders = {
      ...(headers || {}),
      ...(reqInfo.headers || {}),
    };
    const res = await fetch(reqInfo.url, {
      method: reqInfo.method || 'POST',
      headers: fetchHeaders,
      body: typeof reqInfo.body === 'object' && !(reqInfo.body instanceof FormData) && !Buffer.isBuffer(reqInfo.body)
        ? JSON.stringify(reqInfo.body)
        : reqInfo.body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`自定义适配器 ${adapter.protocol} 请求失败 HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json().catch(() => ({}));
    return await customAdapter.parseResponse(data, { baseUrl, apiKey, vars, cfg, secrets, input, tempDir });
  }

  throw new Error(`未知的适配器协议: ${adapter.protocol}`);
}

module.exports = {
  executeAdapter,
  getNested,
  fillTemplate,
  normalizeArkSeedreamPayload,
  normalizeArkSize,
  probeCaps,
  pickAdapterId: require('../adapter-match').pickAdapterId,
  ...require('./builtin-protocols'),
  ...require('./adapters'),
};
