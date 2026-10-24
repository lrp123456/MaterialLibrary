/**
 * 参数 schema 读取层。
 *
 * 这里不再自带任何字段表/档位表——唯一真相源是服务端 /lab/capabilities 里
 * 每个模型对象上的 `schema`（与 web-pro 同源，均由 src/models-contract.js 生成）。
 * 条件联动规则统一走 utils/model-protocol.js 的 evaluateClientModelRules，
 * 那份文件与 web-pro/src/utils/model-protocol.js 必须逐字节一致。
 */

/** 服务端下发的模型 schema；缺失返回 null，由界面提示「参数表还没接入」。 */
export function schemaFor(model) {
  return (model && model.schema) || null
}

/** 字段选项标签（与 web-pro 的 optionLabel 同语义）。 */
export function optionLabel(field, value) {
  if (value == null) return ''
  if (field && field.labels && field.labels[String(value)] != null) return field.labels[String(value)]
  if (value === -1 || value === '-1') return '智能'
  if (value === 'auto') return '自动'
  return String(value)
}

/**
 * 参考图槽位上限，语义与 web-pro 的 refCap() 对齐：
 * slots.images 先被 free.maxRefs 收紧，再按模式封顶。
 * 返回 null 表示服务端没给这一档（调用方自行决定兜底）。
 */
export function slotLimit(schema, key = 'images', mode = '') {
  const raw = schema && schema.slots ? schema.slots[key] : null
  if (raw == null || raw === '') return null
  const slots = Number(raw)
  if (!Number.isFinite(slots)) return null
  const free = schema.free && schema.free.maxRefs
  let cap = free != null ? Math.min(slots, Number(free)) : slots
  if (key === 'images') {
    if (mode === 'first_last_frame') cap = Math.min(cap, 2)
    if (mode === 'image_edit' || mode === 'expand_fill') cap = Math.min(cap, 1)
  }
  return cap
}

/** 纯音频模型（只能挂音频、不能挂图），用于切文件选择类型。 */
export function isAudioOnlySchema(schema) {
  return (
    Number((schema && schema.slots && schema.slots.audios) || 0) > 0 &&
    Number((schema && schema.slots && schema.slots.images) || 0) === 0
  )
}
