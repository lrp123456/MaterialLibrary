/**
 * 发送前引用地址自愈。
 *
 * 裁剪、标绘合成、扩图落地后的 url 是一份新像素（data: 或仍活着的 blob:）。
 * 托盘项上的素材 fid 只代表库里的原图。见 fid 就重签会在发送时把裁剪图换回原图。
 *
 * 只在这两种情况下按 fid 重签：
 *   - 当前没有地址
 *   - 当前地址本身就是这张库图（/api/viewer/assets/:fid/image，token 过期）
 * 失效的 blob 也回到库图。没有 fid 的库图地址仍走 resignUrl 刷新 token。
 */

function pathnameOf(url) {
  try {
    return new URL(url, 'http://local.invalid').pathname;
  } catch {
    return '';
  }
}

export function isLibraryAssetUrl(url) {
  const path = pathnameOf(String(url || ''));
  return /^\/api\/(?:viewer\/)?assets\/[^/]+\/image\/?$/.test(path);
}

function isApiUrl(url) {
  return url.startsWith('/api/') || /^https?:\/\/[^/]+\/api\//i.test(url);
}

export function reviveRefUrl(ref, { signAsset, resignUrl, blobAlive } = {}) {
  const fid = String(ref?.fid || '');
  const mediaToken = ref?.mediaToken || '';
  const url = String(ref?.url || '');

  if (url.startsWith('data:')) return url;

  if (url.startsWith('blob:')) {
    if (typeof blobAlive === 'function' && blobAlive(url)) return url;
    if (fid && typeof signAsset === 'function') {
      const fresh = signAsset(fid, mediaToken);
      if (fresh) return fresh;
    }
    return '';
  }

  if (fid && (!url || isLibraryAssetUrl(url)) && typeof signAsset === 'function') {
    const fresh = signAsset(fid, mediaToken);
    if (fresh) return fresh;
  }

  if (!url) return '';
  if (isApiUrl(url)) {
    if (typeof resignUrl === 'function') return resignUrl(url) || '';
    return url;
  }
  if (/^https?:/i.test(url)) return url;
  if (url.startsWith('/')) return url;
  return '';
}

/**
 * 把裁剪/标绘/扩图的像素写进托盘项，并脱离库素材身份。
 * originalUrl / sourceFid 只在第一次编辑时记下，供撤回回到真正的原图。
 */
export function adoptEditedPixels(item, nextUrl, flags = {}) {
  if (!item || typeof nextUrl !== 'string' || !nextUrl) return item;
  return {
    ...item,
    originalUrl: item.originalUrl || item.url || '',
    sourceFid: item.sourceFid || item.fid || '',
    fid: '',
    mediaToken: '',
    url: nextUrl,
    thumbUrl: nextUrl,
    ...(flags.annotated !== undefined ? { annotated: flags.annotated } : {}),
    ...(flags.outpainted !== undefined ? { outpainted: flags.outpainted } : {})
  };
}

export function revertEditedPixels(item) {
  if (!item || !item.originalUrl) return item;
  return {
    ...item,
    url: item.originalUrl,
    thumbUrl: item.originalUrl,
    annotated: false,
    outpainted: false,
    fid: item.sourceFid || item.fid || ''
  };
}
