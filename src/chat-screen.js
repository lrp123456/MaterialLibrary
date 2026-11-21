/**
 * 对话打开用的瘦消息。保留正文、画幅和封面地址，不带请求快照和内嵌大图。
 */
'use strict';

function lightRef(item) {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.url || item.imageUrl || '');
  if (url.startsWith('data:') && !item.fid) return null;
  return {
    fid: item.fid || '',
    url: url.startsWith('data:') ? '' : url,
    name: item.name || '',
    kind: item.kind || '',
    tag: item.tag || '',
    derivativeId: item.derivativeId || '',
    derivativeKind: item.derivativeKind || '',
    versionLabel: item.versionLabel || '',
  };
}

const DROP_KEYS = new Set([
  'requestSnapshot', 'outbound', 'raw', 'wireframeUrl', 'inlineData',
]);

function slimValue(key, value) {
  if (DROP_KEYS.has(key)) return undefined;
  if (typeof value === 'string') {
    if (value.startsWith('data:') && key !== 'imageUrl' && key !== 'url' && key !== 'previewUrl') return undefined;
    return value;
  }
  if (Array.isArray(value)) {
    if (key === 'refs' || key === 'retryRefs') return value.map(lightRef).filter(Boolean);
    return value.filter((item) => !(typeof item === 'string' && item.startsWith('data:')));
  }
  if (value && typeof value === 'object') {
    let text = '';
    try { text = JSON.stringify(value); } catch { return undefined; }
    if (text.length > 8192 || text.includes('"data:')) return undefined;
    return value;
  }
  return value;
}

function slimObject(source) {
  if (!source || typeof source !== 'object') return null;
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    const next = slimValue(key, value);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

function screenMessage(row) {
  const paramsIn = row && row.params && typeof row.params === 'object' ? row.params : {};
  const result = row && row.result && typeof row.result === 'object' ? slimObject(row.result) : null;
  const images = Array.isArray(row && row.images)
    ? row.images.filter((url) => typeof url === 'string' && url && !url.startsWith('data:')).slice(0, 8)
    : [];
  return {
    id: row.id,
    session_id: row.session_id,
    user_id: row.user_id,
    role: row.role,
    mode: row.mode,
    prompt: row.prompt || '',
    status: row.status || '',
    run_id: row.run_id || '',
    engine: row.engine || '',
    created_at: row.created_at,
    updated_at: row.updated_at,
    params: slimObject(paramsIn) || {},
    images,
    result,
  };
}

function derivativeIdOf(ref) {
  if (!ref || typeof ref !== 'object') return '';
  if (ref.derivativeId) return String(ref.derivativeId);
  const match = String(ref.url || '').match(/[?&]derivative=(\d+)/);
  return match ? match[1] : '';
}

/** 地址里已经写了 derivative=id 时，把库里的种类补回引用。这是读这一份文件的种类，不是猜主衍生。 */
function enrichRefVersions(db, refs) {
  if (!db || !Array.isArray(refs)) return refs;
  return refs.map((ref) => {
    if (!ref || typeof ref !== 'object' || ref.derivativeKind) return ref;
    const id = derivativeIdOf(ref);
    if (!id) return ref;
    let row = null;
    try {
      row = db.prepare('SELECT kind FROM derivatives WHERE id=?').get(Number(id));
    } catch (_) {
      return ref;
    }
    if (!row?.kind) return ref;
    return { ...ref, derivativeId: Number(id), derivativeKind: row.kind };
  });
}

module.exports = { screenMessage, enrichRefVersions };
