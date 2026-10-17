/**
 * 提示词引用语法转换（分模型）。
 *
 * UI 输入里用户写 @图片1 / @图片2；提交给生成模型前按模型官方引用语法转换：
 *   - Seedream/Seedance（方舟）：<IMAGE_REF_N>
 *   - Agnes：<Picture N>
 *   - 对话/音乐：自然语言「第N张参考图」
 * 禁止把芯片语法直接塞进 API。
 */

export const REF_STYLE = {
  seedream: 'IMAGE_REF_N',
  seedance: 'IMAGE_REF_N',
  agnes: 'PICTURE_N',
  chat: 'NATURAL',
  music: 'NATURAL'
}

export function refStyleFor(modelId) {
  const id = String(modelId || '').toLowerCase()
  if (/agnes/.test(id)) return 'PICTURE_N'
  if (/seedance/.test(id)) return 'NATURAL' // 视频用自然语言「第N张参考图」
  if (/chat|doubao|seed-1|seed-2/.test(id)) return 'NATURAL'
  return 'IMAGE_REF_N' // seedream 默认
}

/**
 * 把提示词里的 @图片N 替换为目标模型的引用语法。
 * @param {string} text 含 @图片N 的提示词
 * @param {string} style REF_STYLE 的一种
 */
export function convertAtRefs(text, style = 'IMAGE_REF_N') {
  if (!text) return ''
  return String(text).replace(/@图片\s*([0-9]+)/g, (_, n) => {
    const idx = parseInt(n, 10)
    if (style === 'PICTURE_N') return `<Picture ${idx}>`
    if (style === 'NATURAL') return `第${idx}张参考图`
    // IMAGE_REF_N
    return `<IMAGE_REF_${idx}>`
  })
}
