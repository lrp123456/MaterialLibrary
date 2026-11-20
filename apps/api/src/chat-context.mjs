/** 模型没写窗口，或窗口更大时，单次历史上限。再大容易把这一轮请求撑失败。 */
export const STUDIO_CONTEXT_TOKENS = 32000;
export const REPLY_RESERVE_TOKENS = 2048;

export function estimateTokens(text) {
  const s = String(text || '');
  let tokens = 0;
  for (let i = 0; i < s.length; i++) {
    tokens += s.charCodeAt(i) > 255 ? 1 : 0.25;
  }
  return Math.ceil(tokens);
}

export function contextBudgetTokens(modelContextTokens) {
  const declared = Number(modelContextTokens);
  const safety = STUDIO_CONTEXT_TOKENS - REPLY_RESERVE_TOKENS;
  if (!Number.isFinite(declared) || declared < 4096) return safety;
  const usable = Math.floor(declared * 0.7) - REPLY_RESERVE_TOKENS;
  return Math.max(1024, Math.min(usable, safety));
}

function messageText(message) {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content.map((part) => (part && part.type === 'text' ? String(part.text || '') : '')).join('');
  }
  return '';
}

/**
 * 从最新一轮往回装，直到 token 预算用完。错误气泡不进模型。
 * 最新一条即使超预算也保留尾部，避免当前这句话被整段丢掉。
 */
export function trimChatMessages(messages, budgetTokens) {
  const budget = Math.max(1024, Number(budgetTokens) || contextBudgetTokens(null));
  const usable = (Array.isArray(messages) ? messages : []).filter((message) => {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) return false;
    if (message.isError) return false;
    return messageText(message).trim().length > 0;
  });
  if (!usable.length) {
    return { messages: [], kept: 0, dropped: 0, tokens: 0, budget };
  }

  const kept = [];
  let tokens = 0;
  for (let i = usable.length - 1; i >= 0; i--) {
    const text = messageText(usable[i]);
    const cost = estimateTokens(text) + 4;
    if (kept.length && tokens + cost > budget) break;
    if (!kept.length && cost > budget) {
      const sliced = text.slice(-budget * 2);
      kept.push({ role: usable[i].role, content: sliced });
      tokens = estimateTokens(sliced) + 4;
      break;
    }
    kept.push({ role: usable[i].role, content: text });
    tokens += cost;
  }
  kept.reverse();
  return {
    messages: kept,
    kept: kept.length,
    dropped: Math.max(0, usable.length - kept.length),
    tokens,
    budget,
  };
}
