/**
 * MediaStore 倒序游标的一步。
 * 无修改时间（0 / 非法）不当作截止；正的过期时间才停止，避免扫完整库。
 * 倒序末尾、落在第一条过期记录之后的无日期行读不到，再往下扫就是全库扫描。
 */
export function albumCursorAction(modified, cutoff) {
  if (!(modified > 0)) return 'keep'
  if (modified < cutoff) return 'break'
  return 'keep'
}
