/**
 * tabBar 页面跳转。
 * uni.switchTab 不支持 query 参数，需要带参时走一次性 storage 中转。
 */
const PENDING_KEY = 'tab_pending_params'

export function switchTabTo(pagePath, params = null) {
  if (params) {
    uni.setStorageSync(PENDING_KEY, { pagePath, params, at: Date.now() })
  }
  uni.switchTab({ url: pagePath, fail: () => {} })
}

/** 取走属于该页的一次性跳转参数；不属于本页的保留给后续消费 */
export function consumeTabParams(pagePath) {
  let pending = null
  try {
    pending = uni.getStorageSync(PENDING_KEY)
  } catch (_) {}
  if (!pending || pending.pagePath !== pagePath) return null
  try {
    uni.removeStorageSync(PENDING_KEY)
  } catch (_) {}
  return pending.params || null
}
