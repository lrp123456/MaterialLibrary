/**
 * 多轮分域（D2）和生成域继承（D3）。
 * 历史进模型时只留文本。图片可以自动继承。视频只有 @ 选中才带上。
 * 音乐只粘参数。
 */

const CHAR_BUDGET = 12000;
const RECENT_TURNS = 6;
const PRONOUN = /它|这个|那个|上一张|同上|刚才|继续/;

function textOf(row) {
  return String((row && (row.prompt || row.content || row.text)) || '').trim();
}

function packHistory(rows) {
  const turns = (rows || [])
    .map((r) => ({
      role: r.role === 'assistant' ? 'assistant' : 'user',
      content: textOf(r),
    }))
    .filter((t) => t.content);
  const recent = turns.slice(-RECENT_TURNS);
  const older = turns.slice(0, Math.max(0, turns.length - RECENT_TURNS));
  const olderText = older.map((t) => `${t.role}: ${t.content}`).join('\n');
  const recentChars = recent.reduce((n, t) => n + t.content.length, 0);
  return {
    messages: recent,
    olderText,
    overflow: recentChars + olderText.length > CHAR_BUDGET,
  };
}

function needsPronounRewrite(prompt, hasAt) {
  return !hasAt && PRONOUN.test(String(prompt || ''));
}

function parseParams(row) {
  if (!row) return {};
  if (row.params && typeof row.params === 'object') return row.params;
  try { return JSON.parse(row.params_json || '{}'); } catch { return {}; }
}

function stickyFromRows(rows) {
  const list = rows || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const params = parseParams(list[i]);
    if (params.duration || params.lang || params.model) {
      return {
        duration: params.duration,
        lang: params.lang,
        model: params.model,
      };
    }
  }
  return {};
}

function lastImageUrls(rows) {
  const list = rows || [];
  for (let i = list.length - 1; i >= 0; i--) {
    let images = list[i].images;
    if (!Array.isArray(images)) {
      try { images = JSON.parse(list[i].images_json || '[]'); } catch { images = []; }
    }
    const urls = (images || []).filter((x) => typeof x === 'string' && x);
    if (urls.length) return urls;
  }
  return [];
}

/**
 * @param {'chat'|'image'|'video'|'portrait'|'music'} domain
 */
function inheritGeneration({
  domain,
  prompt,
  historyText,
  images,
  videos,
  atVideos,
  sticky,
}) {
  const d = domain || 'image';
  const hasAt = /@/.test(String(prompt || '')) || (Array.isArray(atVideos) && atVideos.length > 0);
  if (d === 'music') {
    return { prompt: String(prompt || ''), images: [], videos: [], params: { ...(sticky || {}) } };
  }
  let text = String(prompt || '');
  if (d !== 'chat' && needsPronounRewrite(text, hasAt) && historyText) {
    text = `上文：${String(historyText).slice(-500)}\n本次：${text}`;
  }
  const vids = hasAt ? (atVideos && atVideos.length ? atVideos : (videos || [])) : [];
  return {
    prompt: text,
    images: images || [],
    videos: vids,
    params: {},
  };
}

module.exports = {
  CHAR_BUDGET,
  packHistory,
  needsPronounRewrite,
  stickyFromRows,
  lastImageUrls,
  inheritGeneration,
};
