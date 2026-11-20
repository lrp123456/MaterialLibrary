/**
 * 多轨剪辑入口：把 App 内的素材整理成编辑器认识的载荷，暂存后跳转剪辑页。
 *
 * 编辑器在 iframe / WebView 里拿不到父窗口 postMessage（App 原生 web-view 不支持），
 * 所以统一走 `clip_pending_assets` 暂存 + 页面内拼 URL `import=`，与桌面端双击素材同一条链路。
 */
import { themeState } from './theme'

export const CLIP_PENDING_KEY = 'clip_pending_assets'

function pickKind(asset) {
  if (asset.isVideo) return 'video'
  if (asset.isMusic) return 'audio'
  return 'image'
}

/** 把列表页 / 详情页的素材对象规整为编辑器 MlsAssetPayload */
export function toClipAsset(asset, deriveId) {
  if (!asset || !asset.fid) return null
  const kind = pickKind(asset)
  const payload = {
    fid: String(asset.fid),
    file_name: String(asset.fileName || asset.name || asset.fid),
    kind,
  }
  const deriv = Number(
    deriveId != null
      ? deriveId
      : asset.derivativeId || asset.activeDerivativeId || asset.main_derivative_id || 0,
  )
  if (deriv > 0) payload.derivativeId = deriv
  if (asset.mime) payload.mime = asset.mime
  if (typeof asset.duration === 'number' && asset.duration > 0) payload.duration = asset.duration
  return payload
}

/** 打开多轨剪辑；assets 为空则是"空白工程"入口 */
export function openClip(assets) {
  const list = (Array.isArray(assets) ? assets : [assets])
    .map((a) => toClipAsset(a))
    .filter(Boolean)
  try {
    if (list.length) {
      uni.setStorageSync(CLIP_PENDING_KEY, list)
    } else {
      uni.removeStorageSync(CLIP_PENDING_KEY)
    }
  } catch (e) {}
  uni.navigateTo({ url: '/pages/clip/clip' })
}

/** 编辑器主题：暖色对应编辑器护眼主题，冷灰对应普通浅色 */
export function clipThemeParam() {
  return themeState.name === 'warm' ? 'eye-care' : 'light'
}

/** 读取并清空待导入素材（剪辑页 onLoad 调用一次） */
export function consumeClipAssets() {
  try {
    const raw = uni.getStorageSync(CLIP_PENDING_KEY)
    uni.removeStorageSync(CLIP_PENDING_KEY)
    const list = Array.isArray(raw) ? raw : []
    return list.filter((a) => a && a.fid)
  } catch (e) {
    return []
  }
}
