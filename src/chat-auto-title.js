/**
 * 对话动作标题：纯函数与默认视觉池调用。
 *
 * 约定（已 grilling 闭合）：
 * - 标题只写动作，最长 16 字，如「换空间：门厅→客厅」；模型名不进标题；
 * - 同时记 action_tag，取值只能是下面六个；
 * - 材料 = 已发送的提示词 + 最多 2 张参考图；
 * - 默认走免费视觉池 workflow_vision，失败再试 Gemini Flash-Lite。
 */
const ACTION_TAGS = ['换空间', '换表面', '换整件', '生图', '生视频', '其他'];
const TITLE_MAX = 16;

const SYSTEM_PROMPT = `你是室内设计创作助手的标题整理器。只输出一个 JSON 对象，不要解释、不要 Markdown：
{"title":"...","action_tag":"..."}

规则：
1. title 只写这次要做的动作和对象/位置，不写模型名、参数、品牌、比例、分辨率、耗时、寒暄。
2. title 最长 ${TITLE_MAX} 个汉字（含标点），优先简洁，例如「换空间：门厅→客厅」「砂岩墙改木饰面」。
3. action_tag 只能是：换空间、换表面、换整件、生图、生视频、其他。
4. 判断依据是提示词和参考图；纯对话/问答用「其他」。`;

const MODEL_NAME_RE = /\b(seedream|agnes|gemini|doubao|wan|wanx|qwen|flux|sdxl|gpt[- ]?image|veo|seedance|kling|nano[- ]?banana|workflow_vision)\b[^\s，,。:：]*/gi;

function normalizeTitle(raw) {
  let text = String(raw || '')
    .replace(/```[a-z]*|```/gi, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’「」]|["'“”‘’「」]$/g, '')
    .trim();
  text = text.replace(MODEL_NAME_RE, '').replace(/[，,、\s]+$/g, '').trim();
  const chars = Array.from(text);
  if (chars.length > TITLE_MAX) text = chars.slice(0, TITLE_MAX).join('').trim();
  return text;
}

function parseAutoTitle(content) {
  const text = String(content || '');
  const candidates = [];
  // 先尝试整段 JSON，再退化为花括号片段
  try { candidates.push(text); } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) candidates.push(text.slice(start, end + 1));
  for (const raw of candidates) {
    let obj = null;
    try { obj = JSON.parse(raw); } catch {}
    if (!obj) {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        try { obj = JSON.parse(m[0]); } catch {}
      }
    }
    if (!obj || typeof obj !== 'object') continue;
    const title = normalizeTitle(obj.title);
    if (!title) continue;
    const tagRaw = String(obj.action_tag || '').trim();
    const action_tag = ACTION_TAGS.includes(tagRaw) ? tagRaw : '其他';
    return { title, action_tag };
  }
  const err = new Error('标题解析失败');
  err.code = 'parse_failed';
  throw err;
}

function buildMessages(prompt) {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `请给下面这次创作起一个动作标题（≤${TITLE_MAX}字），并给出 action_tag。\n\n用户提示词：\n${String(prompt || '').slice(0, 2000)}` },
  ];
}

/**
 * 默认起名器：workflow_vision → gemini-flash-lite-latest。
 * call(model, messages, images) 由调用方注入（api.js 里是 executeChatCompletion）。
 */
async function defaultTitleNamer({ prompt, images, call, fallbackModel }) {
  let lastErr = null;
  for (const model of ['workflow_vision', fallbackModel || 'gemini-flash-lite-latest']) {
    try {
      const content = await call(model, buildMessages(prompt), images);
      return parseAutoTitle(content);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('标题生成失败');
}

module.exports = {
  ACTION_TAGS,
  TITLE_MAX,
  SYSTEM_PROMPT,
  normalizeTitle,
  parseAutoTitle,
  buildMessages,
  defaultTitleNamer,
};
