/**
 * 数据模型（自 Types.ets 迁移）
 */

/** 单张照片/视频元数据 */
export function createPhotoMeta(id, name, size, modified, localPath = '', mediaType = 'image') {
  return {
    id: String(id || ''),
    name: String(name || ''),
    size: Number(size) || 0,
    modified: Number(modified) || 0,
    fingerprint: `${id}_${size}_${modified}`,
    localPath: String(localPath || ''),
    mediaType: String(mediaType || 'image')
  }
}

/** 完整快照 JSON */
export function createSnapshot(deviceId, appVersion, windowDays, photos) {
  return {
    device_id: deviceId,
    timestamp: Date.now(),
    app_version: appVersion,
    window_days: windowDays,
    total_count: photos.length,
    photos,
  }
}

export const UploadStatus = {
  SUCCESS: 'SUCCESS',
  FALLBACK: 'FALLBACK',
  ERROR: 'ERROR',
}
