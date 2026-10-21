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

function poolFullError(err) {
  const m = String((err && err.message) || err || '');
  return /HTTP 429|HTTP 503|queue is full|no deployments available|no available deployment|overloaded/i.test(m);
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
 * 无人值守视觉作业的降级链。
 *
 * 背景（2026-10-03 实测）：主组 workflow_vision 有 17 个 deployment
 * （gemini-flash-lite ×7 / gemma-4-26b-a4b ×7 / agnes-3.0-flash ×3），
 * 而 workflow_vision_low 原本 7 个 deployment **全部指向同一个 gemma-4-31b-it**。
 * 该模型 Google 端免费额度一旦耗尽，low 组就是「7 个尸体」，
 * 于是主组 429 → 降级 low → low 必挂 → 最终抛出误导性的
 * 「No deployments available」（看起来像没部署，实际是额度打满）。
 *
 * 因此降级必须是一条**异构链**：每个候选来自不同后端，
 * 避免整组共享同一份配额/故障域。
 *
 * 顺序按「实测速度 + 故障域独立性」排（2026-10-03 实测同一张图）：
 *   agnes-3.0-flash  0.6s  独立后端（api.agnes-ai.cn），不受 Google 额度影响 → 首选兜底
 *   model_image_input 31.3s 与主组同源（Gemini），只是多一层壳，慢且不独立 → 放最后
 */
const VISION_FALLBACK_CHAIN = ['agnes-3.0-flash', 'workflow_vision_low', 'model_image_input'];

/**
 * 无人值守只打 workflow_vision。池满/配额耗尽时按异构链依次降级。
 * 其它模型名（含原名、含用户手选的 31B）不会被改道。
 */
async function chatVision(opts) {
  const chain = (opts && opts.model === 'workflow_vision')
    ? ['workflow_vision', ...VISION_FALLBACK_CHAIN]
    : [opts && opts.model];
  let lastErr = null;
  const tried = [];
  for (const model of chain) {
    if (!model) continue;
    // 同一模型不重复试（链上偶有重复项）
    if (tried.includes(model)) continue;
    tried.push(model);
    try {
      return await chatVisionOnce({ ...opts, model });
    } catch (e) {
      lastErr = e;
      // 只在「池满/配额/过载」这类瞬时或配额问题上换组；
      // 参数错、JSON 不合法等确定性错误直接上抛，换组也没用。
      if (!(opts && opts.model === 'workflow_vision') || !poolFullError(e)) throw e;
    }
  }
  throw lastErr || new Error('VLM 调用失败');
}

module.exports = {
  chatVision,
  chatVisionOnce,
  completeChat,
  extractJson,
  stripThinking,
  resolveChatCompletionsUrl,
  poolFullError,
  VISION_FALLBACK_CHAIN,
};
