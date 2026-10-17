/**
 * 提示词优化器 · 输出校验（管线 A 的最后一道闸门）
 *
 * 硬约束（与具体模型无关）：**分辨率 / 时长 / 比例是「参数」，不是「提示词内容」**。
 * 它们的唯一权威载体是该次调用的参数对象（studio 选择器 → `submitMap` → API 字段）。
 * 一旦被优化器写进提示词正文，会同时产生三个问题：
 *   1. 双重生效：参数与正文都写了，模型可能各按一半理解（如正文说 9:16、参数传 16:9）；
 *   2. 参数被锁定（`modeConstraints.lock`）时，正文里的相反值会与锁定值打架；
 *   3. 视频模型会把「10 秒」当成叙事内容（"一个持续十秒的镜头"），而不是时长参数。
 *
 * 因此本模块在优化器返回后**自动剥离**这三类 token，并把剥离结果回报给前端
 * （`warnings`），让用户知道提示词被动过 —— 不做静默修改。
 */

/** 分辨率：档位（1K/1.5K/2K/3K/4K/480p/720p/1080p/512px）+ 像素对（1920x1080 / 1080×1920） */
const RESOLUTION_PATTERNS = [
  /\b\d{3,4}\s*[x×*]\s*\d{3,4}\b/g,                       // 1920x1080 / 1080×1920
  /\b(?:480|720|1080|1440|2160)\s*[pP]\b/g,               // 720p / 1080P
  /\b(?:512|1024)\s*px\b/gi,                              // 512px
  /\b(?:1|1\.5|2|3|4)\s*[kK]\b/g,                          // 2K / 1.5K / 4k
];

/** 时长：4秒 / 10 s / 4-15秒 / 时长 8s / duration: 8 */
const DURATION_PATTERNS = [
  /\b\d{1,3}(?:\.\d+)?\s*[-~至到]\s*\d{1,3}(?:\.\d+)?\s*(?:秒|s\b|sec\b|seconds?\b)/gi,
  /\b\d{1,3}(?:\.\d+)?\s*(?:秒|s\b|sec\b|seconds?\b)/gi,
  /(?:时长|duration)\s*[:：=]?\s*\d{1,3}(?:\.\d+)?\s*(?:秒|s\b)?/gi,
];

/** 画幅比：16:9 / 9:16 / 1:1 / 4:3 / 3:4 / 21:9 / 2:3 / 3:2 / 4:5 / 5:4 */
const RATIO_RE = /\b\d{1,2}\s*[:：]\s*\d{1,2}\b/g

/**
 * 白名单：出现在**构图/画幅语境**里的比例数不是参数，是镜头语言（如「1:3 三分法构图」
 * 「9:16 竖构图」），误删会破坏画面意图。用 ±8 字符的局部上下文判断，
 * 不做全文判断 —— 全文判断会把「9:16 竖构图… 画面比例改成 3:4」里的后者一起放过。
 */
const RATIO_CTX_RE = /构图|视角|画幅|横屏|竖屏|构图法|三分法|黄金分割/

function stripWithLog(text, res, kind, violations) {
  let out = text;
  for (const re of res) {
    re.lastIndex = 0;
    out = out.replace(re, (m) => {
      violations.push({ kind, token: m.trim() });
      return '';
    });
  }
  return out;
}

/**
 * @param {string} text       优化器返回的提示词
 * @param {object} [opts]
 * @param {boolean} [opts.strict] true = 直接判失败（返回 ok:false），false = 剥离并告警
 * @returns {{ ok:boolean, text:string, stripped:string[], warnings:string[], changed:boolean }}
 */
function validateOptimizedPrompt(text, opts = {}) {
  const raw = String(text == null ? '' : text);
  if (!raw.trim()) return { ok: false, text: '', stripped: [], warnings: ['优化器返回空内容'], changed: false };

  const violations = [];
  let out = raw;

  out = stripWithLog(out, RESOLUTION_PATTERNS, 'resolution', violations);
  out = stripWithLog(out, DURATION_PATTERNS, 'duration', violations);

  // 比例要排除「构图术语」上下文（只看±8 字符的局部语境，不做全文判断）
  RATIO_RE.lastIndex = 0;
  out = out.replace(RATIO_RE, (m, ...args) => {
    const idx = args[args.length - 2];
    const around = out.slice(Math.max(0, idx - 8), idx + m.length + 8);
    if (RATIO_CTX_RE.test(around)) return m;
    violations.push({ kind: 'ratio', token: m.trim() });
    return '';
  });

  // 清理剥离留下的空壳：空括号、悬空的连接词、连续空白、行首标点
  out = out
    .replace(/[（(]\s*[)）]/g, '')
    .replace(/[，,]\s*[，,]/g, '，')
    .replace(/[。；;]\s*[。；;]/g, '。')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[\s，,。；;、]+/gm, '')
    .trim();

  const changed = out !== raw;
  const kinds = Array.from(new Set(violations.map((v) => v.kind)));
  const LABEL = { resolution: '分辨率', duration: '时长', ratio: '画幅比' };
  const warnings = changed
    ? [`已从提示词中移除 ${kinds.map((k) => LABEL[k] || k).join(' / ')}（属于参数，应通过参数项设置，不写进提示词）`]
    : [];

  if (opts.strict && changed) {
    return { ok: false, text: out, stripped: violations.map((v) => `${v.kind}:${v.token}`), warnings, changed };
  }
  return {
    ok: true,
    text: out,
    stripped: violations.map((v) => `${v.kind}:${v.token}`),
    warnings,
    changed,
  };
}

module.exports = { validateOptimizedPrompt };
