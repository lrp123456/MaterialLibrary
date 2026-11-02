/**
 * VLM 客户端（OpenAI 兼容，走工作室 LiteLLM 代理）。
 * 图片统一 base64 data URL 喂入（thumb 300px / 打标 1024px），
 * 不依赖模型服务端公网抓取夸克 CDN（海外模型访问国内链接会超时）。
 */

/** 思考块里经常夹着一份假 JSON，必须整段丢掉再找真正的对象。 */
function stripThinking(text) {
  let s = String(text || '');
  s = s.replace(/<thought>[\s\S]*?<\/thought>/gi, '');
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  s = s.replace(/<thought>[\s\S]*$/gi, '');
  s = s.replace(/<think>[\s\S]*$/gi, '');
  return s.trim();
}

/**
 * 判断视觉模型错误是否可触发级联回退到备用模型
 * 包含：403（密钥泄露/免费额度不可用/无权限/账单问题）、429（限流/配额用尽/排队满）、
 * 500/502/503/504（网关与服务异常）、超时（timeout/aborted）、网络中断（fetch failed/ECONNRESET/ECONNREFUSED）
 */
function isVlmFallbackableError(err) {
  const m = String((err && err.message) || err || '');
  if (!m) return false;
  // 403 专属识别：Google/Gemini 报告 key leaked 或 free tier 不可用或 permission_denied/forbidden
  if (/HTTP 403|leaked|free[_ ]?tier|permission_denied|forbidden|billing|quota/i.test(m)) return true;
  // 429 / 503 / 500 / 502 / 504 / 池满 / 部署满 / 速率限制
  if (/HTTP 429|HTTP 500|HTTP 502|HTTP 503|HTTP 504|queue is full|no deployments available|no available deployment|overloaded|rate[_ ]?limit/i.test(m)) return true;
  // 401 密钥失效伪装（若 upstream 返回 invalid token 且有备用通道时应尝试兜底）
  if (/HTTP 401|invalid[_ ]?token|无效的令牌/i.test(m)) return true;
  // 超时与网络中断
  if (/aborted due to timeout|timeout|ETIMEDOUT|fetch failed|ECONNRESET|ECONNREFUSED|socket hang up/i.test(m)) return true;
  return false;
}

function poolFullError(err) {
  return isVlmFallbackableError(err);
}

function extractJson(text) {
  if (!text || typeof text !== 'string') return {};
  let cleaned = stripThinking(text);
  if (!cleaned) {
    throw new Error(`VLM 返回非 JSON: ${text.slice(0, 200)}`);
  }

  // 1. 去除代码块包裹
  const codeBlockMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (codeBlockMatch) {
    cleaned = codeBlockMatch[1].trim();
  } else {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }

  // 2. 尝试直接完整解析
  try {
    return JSON.parse(cleaned);
  } catch (e) {}

  // 3. 提取最外层大括号
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const bracketSnippet = cleaned.substring(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(bracketSnippet);
    } catch (e) {}
  }

  // 4. 容错修复截断 JSON (去除末尾未闭合字段，自动补齐闭合大括号)
  if (firstBrace !== -1) {
    const snippet = cleaned.substring(firstBrace);
    const lastComma = snippet.lastIndexOf(',');
    if (lastComma > 0) {
      const repaired = snippet.substring(0, lastComma).trim() + '\n}';
      try {
        return JSON.parse(repaired);
      } catch (e) {}
    }
  }

  throw new Error(`VLM 返回非 JSON: ${text.slice(0, 200)}`);
}

function resolveChatCompletionsUrl(baseUrl) {
  let b = (baseUrl || 'http://127.0.0.1:4000').replace(/\/$/, '');
  if (b.endsWith('/chat/completions')) return b;
  if (b.includes('generativelanguage.googleapis.com')) {
    if (!b.includes('/v1beta/openai')) {
      return 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
    }
    return `${b}/chat/completions`;
  }
  if (b.endsWith('/v1') || b.endsWith('/api/v3') || b.endsWith('/v1beta/openai') || b.endsWith('/gateway')) {
    return `${b}/chat/completions`;
  }
  return `${b}/v1/chat/completions`;
}

async function completeChat({
  baseUrl,
  apiKey,
  model,
  messages,
  temperature = 0.2,
  max_tokens = 4096,
  timeoutMs = 90000,
  response_format = null,
  extraBody = null,
}) {
  if (!baseUrl) {
    throw new Error('LiteLLM 未配置 base_url（llm_providers.litellm）');
  }
  if (!apiKey && /127\.0\.0\.1:4000|localhost:4000/i.test(String(baseUrl))) {
    throw new Error('本地网关没有钥匙');
  }
  const endpoint = resolveChatCompletionsUrl(baseUrl);
  const body = {
    model,
    messages,
    temperature,
    max_tokens,
  };
  if (response_format) body.response_format = response_format;
  // 思考档位等厂商扩展字段：仅由服务端按模型 caps 组装后传入，拒绝客户端任意透传
  if (extraBody && typeof extraBody === 'object') {
    for (const [k, v] of Object.entries(extraBody)) {
      if (v === undefined || v === null) continue;
      body[k] = v;
    }
  }
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? { Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    if (/OPENAI_API_KEY|AuthenticationError|api_key client option/i.test(t)) {
      throw new Error('对话网关未配上游 Key');
    }
    throw new Error(`VLM HTTP ${res.status}: ${t.slice(0, 200)}`);
  }
  return res.json();
}

async function chatVisionOnce({ baseUrl, apiKey, model, prompt, images, timeoutMs = 90000 }) {
  const content = [{ type: 'text', text: prompt }];
  for (const img of (images || [])) {
    if (!img) continue;
    let url = '';
    if (typeof img === 'string') {
      url = img.startsWith('data:') || /^https?:\/\//i.test(img) ? img : `data:image/jpeg;base64,${img}`;
    } else if (img.url) {
      url = img.url;
    } else if (img.b64 || img.data) {
      url = `data:${img.mime || 'image/jpeg'};base64,${img.b64 || img.data}`;
    }
    if (url) content.push({ type: 'image_url', image_url: { url } });
  }
  const data = await completeChat({
    baseUrl,
    apiKey,
    model,
    messages: [{ role: 'user', content }],
    temperature: 0.2,
    max_tokens: 4096,
    timeoutMs,
    response_format: { type: 'json_object' },
  });
  const text = data.choices?.[0]?.message?.content || '{}';
  return extractJson(text);
}

/**
 * 视觉大模型级联多组回退候选池。
 * 异构候选后端，避免整组共享同一份配额/故障域：
 *   agnes-3.0-flash   独立后端（api.agnes-ai.cn），不受 Google 额度影响
 *   workflow_vision   主组轮转
 *   workflow_vision_low 低优先组
 *   model_image_input 兜底模型
 */
const VISION_FALLBACK_CHAIN = ['agnes-3.0-flash', 'workflow_vision_low', 'model_image_input'];

function buildVisionChain(requestedModel, customChain = null) {
  if (Array.isArray(customChain) && customChain.length > 0) {
    return customChain.filter(Boolean);
  }
  const primary = requestedModel || 'workflow_vision';
  const chain = [primary];
  const defaultFallbacks = ['agnes-3.0-flash', 'workflow_vision', 'workflow_vision_low', 'model_image_input'];
  for (const fb of defaultFallbacks) {
    if (fb && !chain.includes(fb)) {
      chain.push(fb);
    }
  }
  return chain;
}

/**
 * 视觉大模型统一调用（含级联多组模型回退策略）。
 * 针对 Gemini / workflow_vision 等模型，若遇到 403 泄露/429限流/超时/网络异常，
 * 自动级联回退到备用异构模型链（agnes-3.0-flash 等），保障服务不中断。
 */
async function chatVision(opts) {
  const primaryModel = (opts && opts.model) || 'workflow_vision';
  const enableFallback = !(opts && opts.disableFallback === true);
  const chain = enableFallback
    ? buildVisionChain(primaryModel, opts && (opts.fallbackChain || opts.modelChain))
    : [primaryModel];

  let lastErr = null;
  const tried = [];
  for (const model of chain) {
    if (!model) continue;
    if (tried.includes(model)) continue;
    tried.push(model);
    try {
      const fn = (module.exports && module.exports.chatVisionOnce) || chatVisionOnce;
      return await fn({ ...opts, model });
    } catch (e) {
      lastErr = e;
      if (!enableFallback || !isVlmFallbackableError(e)) {
        throw e;
      }
      try {
        console.warn(`[vlm] 模型 ${model} 失败 (${e.message})，级联回退到备用视觉模型...`);
      } catch (_) {}
    }
  }
  throw lastErr || new Error('VLM 级联回退全部失败');
}

module.exports = {
  chatVision,
  chatVisionOnce,
  completeChat,
  extractJson,
  stripThinking,
  resolveChatCompletionsUrl,
  poolFullError,
  isVlmFallbackableError,
  buildVisionChain,
  VISION_FALLBACK_CHAIN,
};
