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
const { fetchNet, describeFetchError, isPreSendError } = require('./net-retry');

function logNetRetry({ attempt, useDirect, error, what, url }) {
  let host = '';
  try { host = new URL(url).hostname; } catch (_) {}
  console.warn(`[gen] ${what}传输失败(${host || url}${useDirect ? ' 直连' : ' 代理'}): ${describeFetchError(error)}，第 ${attempt + 1} 次重试`);
}

function getNested(obj, pathStr) {
  if (!obj || !pathStr) return undefined;
  return pathStr.split('.').reduce((acc, part) => (acc !== null && acc !== undefined ? acc[part] : undefined), obj);
}

/**
 * GPT Image 2.5 VIP（老张 NewAPI / Firefly shell 逆向通道）的 size 归一化。
 *
 * 这条通道只认两种值：`auto` 或 `WxH` 像素串。前端参数条里的「分辨率档位」是
 * 1K / 1.5K / 2K，视频板块还有 720p / 1080p / 720p_sr2x —— 这些档位一旦被原样透传，
 * 上游会直接返回 HTTP 400 `invalid_request`（"The request was not accepted…"）。
 * 实测：1.5K / 1080p / 720p_sr2x 必挂，1K / 2K / auto 侥幸通过（档位被忽略，出图尺寸不可控）。
 *
 * 因此这里统一折算成按画幅比例选定的安全像素，保证任何入参都不会再打到 400。
 */
const VIP_RATIO_SIZE = {
  '9:16': '1024x1536',
  '3:4': '1024x1536',
  '2:3': '1024x1536',
  '16:9': '1536x1024',
  '4:3': '1536x1024',
  '3:2': '1536x1024',
  '21:9': '1536x1024',
  '1:1': '1024x1024',
};

function normalizeVipSize(rawSize, ratio) {
  const fallback = VIP_RATIO_SIZE[String(ratio || '').trim()] || VIP_RATIO_SIZE['1:1'];
  const raw = rawSize == null ? '' : String(rawSize).trim();
  if (!raw) return fallback;
  if (/^auto$/i.test(raw)) return 'auto';

  const px = raw.match(/^(\d{2,5})\s*[x×*]\s*(\d{2,5})$/);
  if (px) {
    // 通道实测可接受 1024x1024 / 1536x1024 / 1024x1536 / 1792x1024；把越界值夹到 512–2048
    const w = Math.min(2048, Math.max(512, Number(px[1])));
    const h = Math.min(2048, Math.max(512, Number(px[2])));
    return `${w}x${h}`;
  }

  // 1K / 1.5K / 2K / 4K / 720p / 1080p / 720p_sr2x … 一律按画幅比例换算
  return fallback;
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
    res = await fetchNet(url, { headers }, { timeoutMs, what: '下载产物', onRetry: logNetRetry });
  } catch (e) {
    throw enrichFetchError(e, '下载产物网络失败');
  }
  if (!res.ok) throw new Error(`下载产物失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return buf;
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
    // 厂商只吃 data URL 或公网 https；本地相对路径/内网地址会在上游 400，这里直接丢弃
    const usable = s.startsWith('data:') || /^https?:\/\/(?!127\.0\.0\.1|localhost)/i.test(s);
    if (!usable) return;
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
    if (ok) return globalCircuitBreaker.recordSuccess(id);
    // 上游排队/限流/临时不可用属于瞬时状态，计入熔断会让用户重试几秒后就被整体拦下
    if (/队列已满|queue is full|rate.?limit|HTTP 429|HTTP 503|no available deployment/i.test(String(errText || ''))) return;
    globalCircuitBreaker.recordFailure(id, errText || '');
  } catch (_) {}
}

async function executeAdapter(services, adapter, input) {
  // 默认按用户主动请求处理；工作流节点显式传 gpuPriority:'low' 让出队头。
  const { withGpuPriority } = require('./lan-fetch');
  const priority = (input && input.gpuPriority) || 'high';
  return withGpuPriority(priority, () => executeAdapterInner(services, adapter, input));
}

async function executeAdapterInner(services, adapter, input) {
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
    // 客户端偶发把查询串里的 & 额外转义成字面量 \u0026，导致 token 解析失败取不到图
    const s = String(raw).trim().replace(/\\u0026/gi, '&');
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
    //    以前只要 cache/thumbs 存在就直接返回它 —— 那是 512px 预览图，参考给供应商既糊又可能画幅不符，
    //    而且原查询写的 derivatives.storage_path 列根本不存在（真实列是 storage_ref），一直是静默 catch。
    //    现在按 URL 查询串取「用户实际选中的那一版」：?derivative=N → ?raw=1 原图 → 素材主衍生。
    const mAsset = s.match(/\/api\/(?:viewer\/)?assets\/([^/?#]+)/);
    if (mAsset) {
      const fid = decodeURIComponent(mAsset[1]);
      let q = new URLSearchParams();
      try { q = new URL(s, 'http://local.invalid').searchParams; } catch (e) {}
      const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp' };
      const inlineImage = (fp, mime) => {
        if (!fp || !fs.existsSync(fp)) return null;
        const guess = mime || IMAGE_MIME[path.extname(String(fp).toLowerCase())] || 'image/jpeg';
        if (!guess.startsWith('image/')) return null; // 视频/音频衍生不能当图片内联
        try {
          return `data:${guess};base64,${fs.readFileSync(fp).toString('base64')}`;
        } catch (e) { return null; }
      };
      try {
        const { getDerivativeById, resolveDerivativeFile, ensurePreviewJpeg } = require('../derivatives');
        const db = services.db;
        const originRow = () => db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind='origin' ORDER BY id DESC LIMIT 1").get(fid);
        const derivId = Number(q.get('derivative') || 0);
        const asset = db.prepare('SELECT category, main_derivative_id FROM assets WHERE fid=?').get(fid);
        const isPortraitOrClothing = asset?.category === 'portrait' || asset?.category === 'clothing';
        let deriv = null;
        if (derivId && !isPortraitOrClothing) deriv = getDerivativeById(db, derivId);
        else if (q.get('raw') === '1' || isPortraitOrClothing) deriv = originRow();
        else {
          deriv = asset?.main_derivative_id ? getDerivativeById(db, asset.main_derivative_id) : originRow();
        }
        if (isPortraitOrClothing && (!deriv || String(deriv.kind || '').startsWith('restage_'))) {
          deriv = originRow();
        }
        if (deriv && deriv.asset_fid === fid) {
          const fp = await resolveDerivativeFile(services, deriv);
          if (fp) {
            // 手机直出原图动辄 10MB+，方舟一类供应商会直接拒收；超阈值换 1280px 预览档
            if (fs.statSync(fp).size > 8 * 1024 * 1024) {
              const preview = await ensurePreviewJpeg(services, fid, deriv, fp);
              const hit = inlineImage(preview, 'image/jpeg');
              if (hit) return hit;
            }
            const hit = inlineImage(fp, deriv.mime);
            if (hit) return hit;
          }
        }
      } catch (e) {
        if (logger?.warn) logger.warn('[gen] 素材衍生图解析失败，回退本地缓存:', e.message);
      }
    }

    // 4.5 素材库本地缓存兜底：local_cache 衍生图存在 derivatives.storage_ref，
    //     复用帧中继的本地解析（含 originals/thumbs/derivatives）
    try {
      const local = require('../frame-relay').readLocalRef(services, s);
      if (local?.buf?.length && String(local.mime || 'image/jpeg').startsWith('image/')) {
        return `data:${local.mime || 'image/jpeg'};base64,${local.buf.toString('base64')}`;
      }
    } catch (e) {}

    // 4.6 视频/音频素材或全图缺失：海报缩略图是最后一个还能给的静态参考
    if (mAsset) {
      const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${decodeURIComponent(mAsset[1])}.jpg`);
      if (fs.existsSync(thumb)) {
        try {
          return `data:image/jpeg;base64,${fs.readFileSync(thumb).toString('base64')}`;
        } catch (e) {}
      }
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
          if (uObj.port === portStr || uObj.port === '30002' || uObj.hostname === '127.0.0.1' || uObj.hostname === 'localhost' || uObj.pathname.startsWith('/api/')) {
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

  // 参考图统一转 data URL：火山方舟等厂商只接受 data URL 或公网 https，相对路径/内网地址会直接 400
  // 直接回写 input：下游 canonicalize 会读 imageUrls / arkImages / image / images 等原始字段
  const resolveList = async (list) => {
    const out = [];
    for (const cand of list) out.push((await resolveImageToDataUrl(cand)) || cand);
    return out;
  };
  const resolvedImageUrls = Array.isArray(input.imageUrls)
    ? await resolveList(input.imageUrls)
    : [];
  if (resolvedImageUrls.length) input.imageUrls = resolvedImageUrls;
  if (Array.isArray(input.arkImages) && input.arkImages.length) {
    input.arkImages = await resolveList(input.arkImages);
  }
  if (Array.isArray(input.images) && input.images.length) {
    input.images = await resolveList(input.images);
  }
  if (typeof input.image === 'string' && input.image) {
    input.image = (await resolveImageToDataUrl(input.image)) || input.image;
  }
  // 部分调用方把参考图放在 refs 里
  if (input.refs && Array.isArray(input.refs.images) && input.refs.images.length) {
    input.refs.images = await resolveList(input.refs.images);
  }
  if (typeof input.firstFrame === 'string' && input.firstFrame.startsWith('/')) {
    input.firstFrame = (await resolveImageToDataUrl(input.firstFrame)) || input.firstFrame;
  }
  if (typeof input.lastFrame === 'string' && input.lastFrame.startsWith('/')) {
    input.lastFrame = (await resolveImageToDataUrl(input.lastFrame)) || input.lastFrame;
  }

  // extras（客户端 params / 契约 assembled.body）展开后位于 vars 末尾，可能带着原始 image 字段
  // 覆盖掉上面解析好的值，这里一并解析，避免相对路径又漏给厂商。
  if (input.extras && typeof input.extras === 'object') {
    const ex = input.extras;
    if (typeof ex.image === 'string' && ex.image) {
      ex.image = (await resolveImageToDataUrl(ex.image)) || ex.image;
    }
    for (const key of ['images', 'imageUrls', 'image_urls', 'arkImages']) {
      if (Array.isArray(ex[key]) && ex[key].length) ex[key] = await resolveList(ex[key]);
    }
  }

  // size 的默认值会掩盖「调用方到底传没传」：GPT Image VIP 分支必须知道原始意图，
  // 契约没有分辨率档位的模型压根不该收到 size，此时按画幅比例算像素。
  const rawSizeInput = input.size;
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
    image_urls: resolvedImageUrls,
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
  async function normalizeAgnesImagePayload(body, v, inp) {
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
    const out = converted.body || converted.payload;
    // Agnes 只接受公网可拉取的 URL：把 data:/本地地址经帧中继换成公网地址，
    // 换不出去的本地路径直接剔除，绝不能让 '/api/...' 这类地址发到上游（会 400 invalid url）
    const frameRelay = require('../frame-relay');
    const toPublic = async (u) => {
      if (typeof u !== 'string' || !u) return null;
      // Agnes 官方接受 Data URI Base64（见 pe-agnes-image 技能说明），无需换成公网地址
      if (/^data:/i.test(u)) return u;
      if (/^https?:\/\/(?!127\.0\.0\.1|localhost)/i.test(u)) return u;
      try {
        return (await frameRelay.materializeFrameUrls(services, [u]))[0] || null;
      } catch (_) {
        return null;
      }
    };
    const cleanImageField = async (holder) => {
      if (!holder || !holder.image) return;
      const list = Array.isArray(holder.image) ? holder.image : [holder.image];
      const kept = [];
      for (const u of list) {
        const pub = await toPublic(u);
        if (pub && !kept.includes(pub)) kept.push(pub);
      }
      if (kept.length) holder.image = kept.length === 1 ? kept[0] : kept;
      else delete holder.image;
    };
    if (out && typeof out === 'object') {
      await cleanImageField(out);
      await cleanImageField(out.extra_body);
    }
    return out;
  }

  /**
   * 按照 Agnes Video 2.5 Flash 官方规范约束异步生成 Payload
   * 云端要求首帧/尾帧/参考图必须是公网可拉取 URL：把 data:/相对路径/本地路径
   * 统一通过帧中继落盘并签发公网 URL（见 src/frame-relay.js）。
   */
  async function normalizeAgnesVideoPayload(body, v, inp) {
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
    const frameRelay = require('../frame-relay');
    const clientMode = inp.genMode || v.gen_mode || body.mode || body.client_mode || '';

    // 1. 收集所有可能的图片引用（保留顺序、去重），先做帧中继
    const rawImages = [];
    const pushRaw = (u) => {
      if (!u || typeof u !== 'string') return;
      const s = u.trim();
      // 跳过空值与未填充的模板占位符（如 '{{image_data_url}}'）
      if (!s || s.includes('{{') || s === 'undefined' || s === 'null') return;
      if (!rawImages.includes(s)) rawImages.push(s);
    };
    pushRaw(inp.firstFrame); pushRaw(v.first_frame);
    pushRaw(inp.lastFrame); pushRaw(v.last_frame);
    (inp.imageUrls || []).forEach(pushRaw);
    (Array.isArray(v.image_urls) ? v.image_urls : []).forEach(pushRaw);
    [body.first_frame, body.last_frame, body.first_frame_image, body.last_frame_image]
      .forEach((u) => { if (typeof u === 'string') pushRaw(u); });
    (Array.isArray(body.images) ? body.images : []).forEach(pushRaw);

    const publicUrls = await frameRelay.materializeFrameUrls(services, rawImages);

    // 2. 按模式回填：首尾帧模式前两张即首帧/尾帧；其余作为参考图
    const needsKeyframe = ['first_last_frame', 'keyframe'].includes(String(clientMode));
    let firstFrame = '';
    let lastFrame = '';
    let refImages = [];
    // 只把调用方实际提供的首/尾帧纳入收集顺序，避免缺失的一方被另一张图错位填充
    const rawFirst = [];
    const rawLast = [];
    [inp.firstFrame, v.first_frame].forEach((u) => {
      if (u && typeof u === 'string' && u.trim() && !u.includes('{{') && !rawFirst.includes(u)) rawFirst.push(u);
    });
    [inp.lastFrame, v.last_frame].forEach((u) => {
      if (u && typeof u === 'string' && u.trim() && !u.includes('{{') && !rawLast.includes(u)) rawLast.push(u);
    });
    if (needsKeyframe) {
      if (rawFirst.length) firstFrame = (await frameRelay.materializeFrameUrls(services, rawFirst))[0] || '';
      if (rawLast.length) lastFrame = (await frameRelay.materializeFrameUrls(services, rawLast))[0] || '';
      // 未显式区分时，参考图前两张按顺序充当首/尾帧
      if (!firstFrame && !lastFrame && publicUrls.length) {
        firstFrame = publicUrls[0] || '';
        lastFrame = publicUrls[1] || '';
      }
      refImages = publicUrls.slice(firstFrame && lastFrame ? 2 : 1);
    } else {
      refImages = publicUrls;
      if (rawFirst.length) firstFrame = (await frameRelay.materializeFrameUrls(services, rawFirst))[0] || '';
      if (rawLast.length) lastFrame = (await frameRelay.materializeFrameUrls(services, rawLast))[0] || '';
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
        mode: clientMode,
        ratio: body.aspect_ratio || body.ratio || v.ratio || inp.ratio || '16:9',
        seconds: body.seconds || v.duration || inp.durationSec || '5',
        refs: {
          first_frame: firstFrame || null,
          last_frame: lastFrame || null,
          images: refImages,
          videos: [],
          audios: Array.isArray(body.audios) ? body.audios : [],
        },
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
      lastFrameUrl: v.last_frame || (inp && inp.lastFrame) || '',
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
    let refs = images.slice(0, 6);
    // 首尾帧必须带 role：不带时方舟只会当普通参考图，画面既不从首帧起、也不会收在尾帧。
    // 线上这条路以前只有「有人像」时才走 shapeVolcVideo 拼 role，普通首尾帧一直是坏的。
    const mode = String((inp && inp.genMode) || v.gen_mode || '');
    const firstUrl = String(v.first_frame || (inp && inp.firstFrame) || '');
    const lastUrl = String(v.last_frame || (inp && inp.lastFrame) || '');
    let first = firstUrl;
    let last = lastUrl;
    if (!first && mode === 'first_last_frame') first = refs[0] || '';
    if (!last && mode === 'first_last_frame' && firstUrl) last = refs.find((u) => u !== first) || '';
    if (first || last) {
      if (first) content.push({ type: 'image_url', image_url: { url: first }, role: 'first_frame' });
      if (last) content.push({ type: 'image_url', image_url: { url: last }, role: 'last_frame' });
      refs = refs.filter((u) => u !== first && u !== last);
    }
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
    const resRaw = body.resolution || (inp && (inp.resolution || inp.size)) || v.resolution || v.size;
    if (resRaw) {
      let r = String(resRaw).toLowerCase();
      if (r === '480p_sr2x') r = '480p';
      else if (r === '720p_sr2x') r = '720p';
      out.resolution = r;
    }
    if (Number.isFinite(durationNum) && durationNum > 0) {
      const maxDur = String(finalModel).includes('2_5') || String(finalModel).includes('2.5') ? 30 : 15;
      out.duration = Math.max(3, Math.min(maxDur, Math.round(durationNum)));
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
    bodyObj = await normalizeAgnesImagePayload(bodyObj, vars, input);
    bodyObj = normalizeModelScopePayload(bodyObj, vars, input);

    let res;
    try {
      res = await fetchNet(reqUrl, {
        method: cfg.method || 'POST',
        headers,
        body: JSON.stringify(bodyObj)
      }, { timeoutMs, what: '生成服务请求', retryOn: isPreSendError, onRetry: logNetRetry });
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

  // ---- NewAPI / Google Gemini 原生 generateContent 图像 ----
  if (adapter.protocol === 'gemini_generate_content') {
    const model = vars.model || cfg.defaultModel || '';
    if (!model) throw new Error('Gemini generate_content 适配器缺少 model');
    const modelPath = encodeURIComponent(model);
    // endpoint base_url 通常以 /v1 结尾；Gemini 原生接口在根路径 /v1beta 下
    const root = baseUrl.replace(/\/v1$/i, '');
    const reqUrl = `${root}/v1beta/models/${modelPath}:generateContent`;
    const inlineParts = [];
    const pushInline = (raw, mimeHint) => {
      const s = String(raw || '');
      const m = s.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        inlineParts.push({ inlineData: { mimeType: m[1] || mimeHint || 'image/jpeg', data: m[2] } });
        return;
      }
      if (/^https?:\/\//i.test(s)) return;
      try {
        if (s.length < 500 && fs.existsSync(s)) {
          inlineParts.push({ inlineData: { mimeType: mimeHint || 'image/jpeg', data: fs.readFileSync(s).toString('base64') } });
          return;
        }
      } catch (_) {}
      if (s.length > 200) {
        inlineParts.push({ inlineData: { mimeType: mimeHint || 'image/jpeg', data: s } });
      }
    };
    pushInline(vars.image_data_url);
    pushInline(vars.image_b64);
    if (Array.isArray(vars.extra_image_data_urls)) vars.extra_image_data_urls.forEach((u) => pushInline(u));
    if (Array.isArray(vars.image_urls)) vars.image_urls.forEach((u) => pushInline(u));

    const generationConfig = { responseModalities: ['TEXT', 'IMAGE'] };
    const allowedRatios = ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '1:2', '2:1', '4:5', '5:4', '9:21', '21:9', '1:3', '3:1'];
    const targetRatio = vars.ratio || '9:16';
    generationConfig.imageConfig = {};
    if (allowedRatios.includes(targetRatio)) {
      generationConfig.imageConfig.aspectRatio = targetRatio;
    }
    const targetSize = String(vars.size || '').toUpperCase();
    if (['1K', '2K', '4K'].includes(targetSize)) {
      generationConfig.imageConfig.outputResolution = targetSize;
    }
    if (vars.thinking_level) {
      generationConfig.thinkingConfig = { thinkingLevel: vars.thinking_level };
    }
    // 双保险：若比例非 1:1，在提示词末尾注入比例自然语言约束，确保网关与大模型严格遵循画幅
    let finalPrompt = vars.prompt || '';
    if (targetRatio && targetRatio !== '1:1' && !finalPrompt.includes(targetRatio)) {
      finalPrompt = `${finalPrompt.trim()}\n[Aspect Ratio: ${targetRatio}]`;
    }
    if (targetSize && ['1K', '2K', '4K'].includes(targetSize) && !finalPrompt.includes(targetSize)) {
      finalPrompt = `${finalPrompt.trim()}\n[Resolution: ${targetSize}]`;
    }
    const geminiBody = {
      contents: [{ role: 'user', parts: [...inlineParts, { text: finalPrompt }] }],
      generationConfig
    };
    const geminiRes = await fetchNet(reqUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(geminiBody)
    }, { timeoutMs, what: 'Gemini 图像生成', retryOn: isPreSendError, onRetry: logNetRetry });
    const geminiText = await geminiRes.text().catch(() => '');
    if (!geminiRes.ok) {
      noteVendorOutcome(input, false, geminiText);
      throw new Error(`Gemini 图像生成失败 HTTP ${geminiRes.status}: ${geminiText.slice(0, 400)}`);
    }
    noteVendorOutcome(input, true);
    const geminiData = JSON.parse(geminiText);
    const geminiFiles = [];
    const partsList = (geminiData.candidates || []).flatMap((c) => c?.content?.parts || []);
    for (const part of partsList) {
      const b64 = part?.inlineData?.data || part?.inline_data?.data;
      if (!b64) continue;
      const mime = part.inlineData?.mimeType || part.inline_data?.mime_type || 'image/png';
      const ext = mime.includes('jpeg') || mime.includes('jpg') ? '.jpg' : '.png';
      const fileName = `gen_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
      const filePath = path.join(tempDir, fileName);
      fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
      let meta = { mime };
      try {
        const info = await sharp(filePath).metadata();
        meta = { width: info.width, height: info.height, mime: info.format === 'jpeg' ? 'image/jpeg' : 'image/png' };
      } catch {}
      geminiFiles.push({
        localPath: filePath,
        previewUrl: `/api/cache/temp/${fileName}`,
        mime: meta.mime,
        width: meta.width,
        height: meta.height
      });
    }
    if (!geminiFiles.length) {
      throw new Error('Gemini 响应中没有 inlineData 图片: ' + geminiText.slice(0, 300));
    }
    return { ok: true, success: true, files: geminiFiles, raw: geminiData };
  }

  // ---- NewAPI / GPT Image 2.5 (Flare VIP / Sunburst VIP / Web) 图像生成 ----
  if (adapter.protocol === 'newapi_gpt_image' || adapter.id === 'newapi_gpt_image') {

    const rawModel = vars.model || cfg.defaultModel || 'gpt-image-2.5-flare-vip';
    const isVip = rawModel.includes('flare') || rawModel.includes('sunburst') || rawModel.includes('vip');
    const modelToUse = isVip
      ? (rawModel.includes('sunburst') ? 'gpt-image-2.5-sunburst-vip' : 'gpt-image-2.5-flare-vip')
      : 'gpt-image-2.5-web';

    // 宽高比与清晰度自然语言注入
    const targetRatio = vars.ratio || '9:16';
    let finalPrompt = vars.prompt || '';
    if (targetRatio && !finalPrompt.includes(targetRatio)) {
      finalPrompt = `${finalPrompt.trim()}\n[Aspect Ratio: ${targetRatio}]`;
    }

    // 收集参考图（Vision 格式图生图 / image_url）
    const inlineImages = [];
    const pushImg = (raw) => {
      if (!raw) return;
      const s = String(raw).trim();
      if (!s) return;
      if (s.startsWith('data:image/')) {
        inlineImages.push(s);
        return;
      }
      if (s.length > 200 && !s.includes('\n')) {
        inlineImages.push(`data:image/png;base64,${s}`);
        return;
      }
    };
    pushImg(vars.image_data_url);
    pushImg(vars.image_b64);
    if (Array.isArray(vars.extra_image_data_urls)) vars.extra_image_data_urls.forEach(pushImg);
    if (Array.isArray(vars.image_urls)) vars.image_urls.forEach(pushImg);
    if (Array.isArray(vars.imageLocalPaths)) {
      vars.imageLocalPaths.forEach((lp) => {
        try {
          if (fs.existsSync(lp)) {
            const buf = fs.readFileSync(lp);
            inlineImages.push(`data:image/png;base64,${buf.toString('base64')}`);
          }
        } catch (_) {}
      });
    }

    let imgBuf = null;
    let rawResponse = null;

    if (isVip) {
      // ===== 老张 VIP 模型分支 (POST /v1/images/generations) =====
      const reqUrl = resolveUrl(baseUrl, '/images/generations');
      // extras 里的 size 是参数条上的真实选择（仅当契约声明了 size 字段时才有），优先于顶层 input.size
      const sizeIntent = (input.extras && input.extras.size != null && input.extras.size !== '')
        ? input.extras.size
        : rawSizeInput;
      const size = normalizeVipSize(sizeIntent, targetRatio);

      if (!String(finalPrompt || '').trim()) {
        throw new Error('GPT Image VIP 需要提示词：这个通道不支持「只挂参考图不打字」，请补一句画面描述再生成');
      }

      const vipBody = {
        model: modelToUse,
        prompt: finalPrompt,
        size,
        quality: vars.quality || 'high',
        background: vars.background || 'auto',
        // 不指定 response_format：通道默认回 b64_json，少一次 pre-signed S3 下载就少一个失败点
        // （之前固定 url，偶发把「下载产物图」的错误算成了「图像生成失败」）
        num_images: 1
      };

      if (inlineImages.length > 0) {
        vipBody.image_url = inlineImages[0];
      }

      // 上游是老张的 Firefly shell 账号池，同参数会出现「一段时间连续 400、隔一阵又恢复」。
      // 实测 2026-11-06：04:49 成功 → 04:52–05:00 连续 8 次同参数 400 → 06:57 同参数成功，
      // 所以这类拒绝不一定是我们的参数错。仅对「网关秒拒」（<8s 就回 400）做一次退避重试，
      // 上游真跑了 20s 才拒绝的不重试（再跑大概率还是拒，白等几分钟还占额度）。
      let vipRes = null;
      let vipText = '';
      for (let attempt = 1; attempt <= 2; attempt++) {
        const t0 = Date.now();
        try {
          vipRes = await fetchNet(reqUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(vipBody)
          }, { timeoutMs, what: `GPT Image VIP 图像生成 (${modelToUse})`, retryOn: isPreSendError, onRetry: logNetRetry });
        } catch (e) {
          noteVendorOutcome(input, false, e.message || '');
          throw enrichFetchError(e, 'GPT Image VIP 图像生成网络请求失败');
        }
        vipText = await vipRes.text().catch(() => '');
        if (vipRes.ok) break;

        const elapsed = Date.now() - t0;
        const deterministic = /prompt is required|invalid size|unsupported/i.test(vipText);
        if (deterministic || attempt === 2 || elapsed > 8000) break;
        console.warn(`[gen] GPT Image VIP 网关秒拒 HTTP ${vipRes.status}（${elapsed}ms），5s 后重试一次`);
        await new Promise((r) => setTimeout(r, 5000));
      }

      if (!vipRes || !vipRes.ok) {
        noteVendorOutcome(input, false, vipText);
        const sent = {
          model: modelToUse,
          size,
          rawSize: sizeIntent == null || sizeIntent === '' ? null : sizeIntent,
          ratio: targetRatio,
          promptChars: String(finalPrompt || '').length,
          refImages: inlineImages.length,
          quality: vipBody.quality,
          background: vipBody.background,
        };
        const hint = vipRes && vipRes.status === 400
          ? '（上游账号池临时拒绝：同参数换时间通常能成功，可隔几分钟重试，或临时改用其它图像模型）'
          : '';
        throw new Error(`GPT Image VIP 图像生成失败 HTTP ${vipRes ? vipRes.status : '?'}: ${String(vipText).slice(0, 300)}${hint}｜实际请求参数 ${JSON.stringify(sent)}`);
      }

      noteVendorOutcome(input, true);
      const data = JSON.parse(vipText);
      rawResponse = data;
      const firstItem = data.data?.[0];
      if (!firstItem) {
        throw new Error('GPT Image VIP 返回缺少 data 列表: ' + vipText.slice(0, 200));
      }

      if (firstItem.b64_json) {
        imgBuf = Buffer.from(firstItem.b64_json, 'base64');
      } else if (firstItem.url) {
        const dlRes = await fetchNet(firstItem.url, {}, { timeoutMs: 60000, what: '下载 VIP 产物图' });
        imgBuf = Buffer.from(await dlRes.arrayBuffer());
      } else {
        throw new Error('GPT Image VIP 响应中既无 b64_json 也无 url: ' + vipText.slice(0, 200));
      }
    } else {
      // ===== Web 逆向通道分支 (POST /v1/chat/completions) =====
      let userContent;
      if (inlineImages.length > 0) {
        userContent = [{ type: 'text', text: finalPrompt }];
        for (const dUrl of inlineImages) {
          userContent.push({
            type: 'image_url',
            image_url: { url: dUrl }
          });
        }
      } else {
        userContent = finalPrompt;
      }

      const reqUrl = resolveUrl(baseUrl, '/chat/completions');
      // 只有方形 / 纵向 / 横向三类可映射，之前 4:3、3:4、21:9 全落到 square_hd，画幅会被悄悄改成正方形
      const webImageSize = ['9:16', '3:4', '2:3', '4:5'].includes(targetRatio)
        ? 'portrait_16_9'
        : (['16:9', '4:3', '3:2', '21:9'].includes(targetRatio) ? 'landscape_16_9' : 'square_hd');
      const gptBody = {
        model: modelToUse,
        messages: [{ role: 'user', content: userContent }],
        image_size: webImageSize,
        quality: vars.quality || 'high',
        background: vars.background || 'auto',
        num_images: 1,
        output_format: 'png'
      };

      let gptRes;
      try {
        gptRes = await fetchNet(reqUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(gptBody)
        }, { timeoutMs, what: `GPT Image Web 图像生成 (${modelToUse})`, retryOn: isPreSendError, onRetry: logNetRetry });
      } catch (e) {
        noteVendorOutcome(input, false, e.message || '');
        throw enrichFetchError(e, 'GPT 图像生成网络请求失败');
      }

      const gptText = await gptRes.text().catch(() => '');
      if (!gptRes.ok) {
        noteVendorOutcome(input, false, gptText);
        throw new Error(`GPT 图像生成失败 HTTP ${gptRes.status}: ${gptText.slice(0, 300)}`);
      }

      noteVendorOutcome(input, true);
      const data = JSON.parse(gptText);
      rawResponse = data;
      const content = data.choices?.[0]?.message?.content || '';
      if (!content) {
        throw new Error('GPT 图像生成响应 content 为空: ' + gptText.slice(0, 200));
      }

      if (content.startsWith('iVBORw0KGgo') || /^[A-Za-z0-9+/=]{100,}$/.test(content.slice(0, 500).trim())) {
        imgBuf = Buffer.from(content.trim(), 'base64');
      } else {
        const mDataUrl = content.match(/data:image\/([a-zA-Z]+);base64,([A-Za-z0-9+/=]+)/);
        if (mDataUrl) {
          imgBuf = Buffer.from(mDataUrl[2], 'base64');
        } else {
          const mUrl = content.match(/https?:\/\/[^\s\)\"\']+/);
          if (mUrl) {
            const dlRes = await fetchNet(mUrl[0], { headers }, { timeoutMs: 60000, what: '下载产物图' });
            imgBuf = Buffer.from(await dlRes.arrayBuffer());
          } else {
            throw new Error('未能在 GPT Image 返回中解析出有效图像数据: ' + content.slice(0, 300));
          }
        }
      }
    }

    // 上游（Firefly shell 通道）完全忽略 output_format：参数条选 jpeg / webp 也一律回 PNG（已实测）。
    // 要让「输出格式」真的生效，只能本地转码；转不动就老实回退 PNG，别把错扩展名写进缓存。
    const wantFormat = String(vars.output_format || 'png').toLowerCase();
    const targetExt = (wantFormat === 'jpeg' || wantFormat === 'jpg')
      ? 'jpg'
      : (wantFormat === 'webp' ? 'webp' : 'png');
    let finalBuf = imgBuf;
    if (targetExt !== 'png') {
      try {
        const encoder = targetExt === 'jpg' ? 'jpeg' : 'webp';
        finalBuf = await sharp(imgBuf)[encoder](targetExt === 'jpg' ? { quality: 92, mozjpeg: true } : { quality: 92 }).toBuffer();
      } catch (e) {
        console.warn(`[gen] output_format=${wantFormat} 本地转码失败，回退 PNG: ${e.message}`);
        finalBuf = imgBuf;
      }
    }
    const realExt = finalBuf === imgBuf ? 'png' : targetExt;

    const outFileName = `gen_${Date.now()}_${crypto.randomBytes(4).toString('hex')}.${realExt}`;
    const outPath = path.join(tempDir, outFileName);
    fs.writeFileSync(outPath, finalBuf);

    let meta = { mime: 'image/png' };
    try {
      const info = await sharp(outPath).metadata();
      const fmt = info.format;
      meta = {
        width: info.width,
        height: info.height,
        mime: fmt === 'jpeg' ? 'image/jpeg' : (fmt === 'webp' ? 'image/webp' : 'image/png'),
      };
    } catch {}

    const previewUrl = `/api/cache/temp/${outFileName}`;
    return {
      ok: true,
      success: true,
      files: [{ localPath: outPath, previewUrl, mime: meta.mime, width: meta.width, height: meta.height }],
      model: modelToUse,
      raw: rawResponse
    };
  }

    if (adapter.protocol === 'qwenimage_local') {
    const qwenLocal = require('./qwenimage-local');
    return qwenLocal.runImageJob(services, adapter, input);
  }

  // ---- 魔搭云端 Qwen-Image 2.1（API-Inference 异步任务）----
  // 与本机 qwenimage_local 是「同模型、不同算力」：云端走 X-ModelScope-Async-Mode 提交、
  // /v1/tasks 轮询、output_images 下载；参考图直接内联 data URI，不需要先传 OSS。
  if (adapter.protocol === 'qwenimage_modelscope') {
    const msQwen = require('./qwenimage-modelscope');
    return msQwen.runImageJob(services, adapter, { ...input, __apiKey: apiKey });
  }

  // ---- 2. 异步任务轮询协议 (async_http_job) ----
  if (adapter.protocol === 'async_http_job') {
    const submitUrl = resolveUrl(baseUrl, cfg.submitPath);
    let submitBody = fillTemplate(cfg.submitBodyTemplate || { prompt: '{{prompt}}', model: '{{model}}' }, vars);
    submitBody = await normalizeAgnesVideoPayload(submitBody, vars, input);
    submitBody = normalizeVolcengineVideoPayload(submitBody, vars, input);
    submitBody = normalizeModelScopePayload(submitBody, vars, input);

    let submitRes = null;
    let submitData = null;
    let lastErrText = '';

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        submitRes = await fetchNet(submitUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(submitBody)
        }, {
          timeoutMs: 60000,
          what: '异步任务提交',
          // 只在请求确定没发出去时重提，避免重复计费
          retryOn: isPreSendError,
          onRetry: logNetRetry,
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
      // 云端拉不到参考图时，把运维语言翻译成可操作提示（常见根因：公网基址用了非标准端口）
      if (/素材 URL 无法下载|无法下载或不是支持的媒体格式/.test(lastErrText)) {
        let hint = '';
        try {
          const relay = require('../frame-relay');
          const base = relay.resolvePublicBase(services);
          if (base) {
            const u = new URL(base);
            const nonStd = (u.protocol === 'http:' && u.port && u.port !== '80')
              || (u.protocol === 'https:' && u.port && u.port !== '443');
            if (nonStd) {
              hint = `——视频云端无法拉取参考图：公网地址 ${base} 使用了非标准端口 ${u.port}，多数厂商仅放行 80/443。请为该域名挂标准端口的反向代理后更新 BFF_PUBLIC_BASE，或改用文生视频。`;
            }
          }
        } catch (_) { /* ignore */ }
        if (!hint) hint = '——请确认首帧/尾帧图片可在公网直接打开（无需登录、无防盗链、为 JPG/PNG/WebP），或改用文生视频。';
        throw new Error(`异步任务提交失败 HTTP ${submitRes?.status || 500}: ${lastErrText.slice(0, 240)}${hint}`);
      }
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

    let pollNetFailures = 0;
    let lastPollErr = null;
    while (Date.now() - startTime < timeoutMs) {
      await new Promise(r => setTimeout(r, pollInterval));
      const pollUrl = resolvePollUrl(baseUrl, pollUrlTemplate, vars, taskId);
      let pollRes;
      try {
        pollRes = await fetchNet(pollUrl, {
          method: cfg.pollMethod || 'GET',
          headers
        }, { timeoutMs: 30000, attempts: 2, what: '任务轮询', onRetry: logNetRetry });
        pollNetFailures = 0;
      } catch (e) {
        lastPollErr = e;
        pollNetFailures += 1;
        // 任务已在云端渲染，单次抖动不能判死；连续失败超过阈值才放弃
        if (pollNetFailures >= 6) throw enrichFetchError(e, '任务轮询网络失败');
        console.warn(`[gen] 任务轮询第 ${pollNetFailures} 次网络失败，继续等待: ${describeFetchError(e)}`);
        continue;
      }
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
        const remoteUrl = /^https?:\/\//i.test(String(resultUrl)) ? String(resultUrl) : '';
        noteVendorOutcome(input, true);
        return {
          ok: true,
          success: true,
          taskId,
          files: [{ localPath: outPath, previewUrl, remoteUrl, mime: input.kind === 'video' ? 'video/mp4' : 'image/jpeg' }],
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

    const submitRes = await fetchNet(submitUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(submitBody)
    }, { timeoutMs: 60000, what: '统一网关提交', retryOn: isPreSendError, onRetry: logNetRetry });
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
      const pollRes = await fetchNet(pollUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({ request_id: requestId })
      }, { timeoutMs: 30000, attempts: 2, what: '统一网关轮询', onRetry: logNetRetry });
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
