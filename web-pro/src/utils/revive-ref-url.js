/**
 * 发送前不再改写引用地址。
 *
 * 看图区用的就是 ref.url。原图、9:16、3:4、裁剪结果挂上之后是什么，上传就是什么。
 * 以前见 fid 会重签成不带版本的库图，或在地址丢了 derivative 时写回另一版。
 * 那一步会让屏幕和上传变成两张图，所以这里原样返回，什么都不补、什么都不换。
 * 地址本身不可用时由发送流程停下来告诉用户，而不是换成别的图继续发。
 */

function parseUrl(url) {
  try {
    return new URL(url, 'http://local.invalid');
  } catch {
    return null;
  }
}

export function isLibraryAssetUrl(url) {
  return /^\/api\/(?:viewer\/)?assets\/[^/]+\/image\/?$/.test(parseUrl(url)?.pathname || '');
}

/** 忽略登录凭证，只比「哪一个文件」。token 不同不算换了一张图。 */
export function sameMountedFile(a, b) {
  const left = parseUrl(a);
  const right = parseUrl(b);
  if (!left || !right) return String(a || '') === String(b || '');
  if (left.pathname !== right.pathname) return false;
  return left.searchParams.get('derivative') === right.searchParams.get('derivative')
    && left.searchParams.get('raw') === right.searchParams.get('raw');
}

export function reviveRefUrl(ref) {
  return String(ref?.url || '');
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
