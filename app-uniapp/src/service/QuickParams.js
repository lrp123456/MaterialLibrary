/**
 * 快捷操作页的参数字段档位读取。
 *
 * 档位（画幅、尺寸等）不在客户端写死，而是从服务端 /lab/capabilities 的
 * 模型契约 schema 里取——与 home.vue / web-pro 用的是同一份 schema。
 * 取不到就返回空数组，界面自然不渲染这一档，避免出现「客户端有一份、服务端有一份」。
 */
import { fetchLabCapabilities } from './ViewerApi'

let _caps = null
let _pending = null

async function capabilities() {
  if (_caps) return _caps
  if (!_pending) {
    _pending = fetchLabCapabilities()
      .then((data) => {
        _caps = data || {}
        return _caps
      })
      .finally(() => {
        _pending = null
      })
  }
  return _pending
}

/** 某模态的默认工坊模型（服务端没标 default 时取列表第一个）。 */
function primaryModel(caps, domain) {
  const grp = (caps.studio || {})[domain] || {}
  const models = grp.models || []
  return models.find((m) => m.id === grp.defaultModel) || models.find((m) => m.default) || models[0] || null
}

/**
 * 取服务端契约里某个字段的可选档位。
 * @param {string} domain image / video / music / portrait
 * @param {string} key 字段 key，如 ratio / size
 * @returns {Promise<Array>} 档位数组；拿不到返回 []
 */
export async function fieldOptionsOf(domain, key) {
  try {
    const caps = await capabilities()
    const schema = primaryModel(caps, domain) && primaryModel(caps, domain).schema
    if (!schema) return []
    const fields = [...(schema.common || []), ...(schema.advanced || [])]
    const f = fields.find((x) => x && x.key === key)
    return f && Array.isArray(f.options) ? f.options : []
  } catch (e) {
    return []
  }
}

/** 同上，但返回整个字段定义（含 label/default），供界面直接渲染。 */
export async function fieldOf(domain, key) {
  try {
    const caps = await capabilities()
    const m = primaryModel(caps, domain)
    const schema = m && m.schema
    if (!schema) return null
    const fields = [...(schema.common || []), ...(schema.advanced || [])]
    return fields.find((x) => x && x.key === key) || null
  } catch (e) {
    return null
  }
}
