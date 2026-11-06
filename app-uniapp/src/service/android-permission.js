/**
 * Android 13+（API 33）相册权限判断。
 * plus.os.version 是系统版本号（"14"），不是 SDK_INT（34）。
 * sdkInt 优先；读不到时再用版本号。
 */
export function isAndroidTiramisu(osVersion, sdkInt) {
  const sdk = Number(sdkInt)
  if (Number.isFinite(sdk) && sdk >= 33) return true
  const v = parseFloat(String(osVersion == null ? '0' : osVersion))
  if (!Number.isFinite(v)) return false
  return v >= 33 || (v >= 13 && v < 100)
}
