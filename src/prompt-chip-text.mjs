/**
 * 编辑器芯片提交文本。
 * 用户写下的字、@图N、真正的选区名和 <bbox> 可以提交。
 * 文件名、长哈希、ARCH_REF 这类方括号不再拼进提示词。
 */

export function isFileLikeBracket(inner) {
  const s = String(inner || '').trim();
  if (!s) return false;
  return /\.(jpe?g|png|webp|gif|svg|bmp|mp4|mov|webm|m4v)/i.test(s)
    || /^[0-9a-f]{12,}/i.test(s)
    || /ARCH_REF/i.test(s)
    || s.length > 40;
}

export function chipSubmitText(tag) {
  const raw = String(tag || '').trim();
  const bbox = raw.match(/<bbox>[\s\S]*?<\/bbox>/i);
  const baseMatch = raw.match(/@(?:图片|图|视频|音频)\d+/);
  const base = baseMatch ? baseMatch[0] : '@图1';
  const region = raw.match(/\[([^\]]*)\]/);
  let out = base;
  if (region && !isFileLikeBracket(region[1])) out += `[${region[1]}]`;
  if (bbox) out += ` ${bbox[0]}`;
  return out;
}

/** 重编号时保留选区，丢掉文件名括号。 */
export function paintChipFinalTag(previousTag, nextTag) {
  const prev = String(previousTag || '');
  const bbox = prev.match(/<bbox>[\s\S]*?<\/bbox>/i);
  const region = prev.match(/\[([^\]]*)\]/);
  let base = String(nextTag || '').replace(/\[[^\]]*\]/g, '').replace(/\s*<bbox>[\s\S]*?<\/bbox>/gi, '').trim();
  if (!base) {
    const prevBase = prev.match(/@(?:图片|图|视频|音频)\d+/);
    base = prevBase ? prevBase[0] : '@图1';
  }
  let finalTag = base;
  if (region && !isFileLikeBracket(region[1]) && !finalTag.includes('[')) finalTag += `[${region[1]}]`;
  if (bbox && !/<bbox>/i.test(finalTag)) finalTag += ` ${bbox[0]}`;
  return finalTag;
}
