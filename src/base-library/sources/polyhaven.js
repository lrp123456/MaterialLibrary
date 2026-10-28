/**
 * Poly Haven CC0 材质来源适配器
 * 官方规范：
 * - 列表：GET https://api.polyhaven.com/assets?type=textures (必须带 User-Agent)
 * - 详情：GET https://api.polyhaven.com/files/{id}
 * - 允许主机：api.polyhaven.com, dl.polyhaven.org
 * - 只取 1K JPG (Diffuse / diff / Color)
 */

const ALLOWED_HOSTS = new Set([
  'api.polyhaven.com',
  'dl.polyhaven.org'
]);

function isAllowedHost(urlStr) {
  try {
    const u = new URL(urlStr);
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

async function searchPolyHaven(query = '', { timeoutMs = 8000 } = {}) {
  const url = 'https://api.polyhaven.com/assets?type=textures';
  try {
    const { fetch } = require('undici');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, {
      headers: { 'User-Agent': 'DSH-MaterialLibrary/1.0' },
      signal: controller.signal
    });
    clearTimeout(timer);

    if (!res.ok) return [];
    const all = await res.json();
    const q = (query || '').toLowerCase().trim();

    const list = [];
    for (const [id, meta] of Object.entries(all)) {
      if (meta.type !== 0 && meta.type !== 'texture' && meta.type !== 'textures') {
        // polyhaven 0 表示 texture
      }
      const name = (meta.name || id).toLowerCase();
      const tags = (meta.tags || []).map(t => String(t).toLowerCase());
      const categories = (meta.categories || []).map(c => String(c).toLowerCase());

      if (!q || name.includes(q) || tags.some(t => t.includes(q)) || categories.some(c => c.includes(q))) {
        list.push({
          id,
          title: meta.name || id,
          source: 'polyhaven',
          categories: meta.categories || [],
          tags: meta.tags || [],
          thumb_url: `https://cdn.polyhaven.com/asset_img/primary/${id}.png?width=256&height=256`,
          has_1k: true
        });
        if (list.length >= 60) break;
      }
    }
    return list;
  } catch (e) {
    return [];
  }
}

async function resolvePolyHavenDownloadUrl(assetId, { timeoutMs = 8000 } = {}) {
  const url = `https://api.polyhaven.com/files/${encodeURIComponent(assetId)}`;
  const { fetch } = require('undici');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const res = await fetch(url, {
    headers: { 'User-Agent': 'DSH-MaterialLibrary/1.0' },
    signal: controller.signal
  });
  clearTimeout(timer);

  if (!res.ok) throw new Error(`Poly Haven files API HTTP ${res.status}`);
  const json = await res.json();

  // 寻觅 1k -> Diffuse / diff / Color 的 jpg
  const root = json['1k'] || json['1K'] || json.diffuse || json.Diffuse || {};
  let downloadUrl = null;

  // 1k 结构通常为 { diffuse: { jpg: { url: ... } }, ... }
  if (root.diffuse?.jpg?.url) downloadUrl = root.diffuse.jpg.url;
  else if (root.Diffuse?.jpg?.url) downloadUrl = root.Diffuse.jpg.url;
  else if (root.color?.jpg?.url) downloadUrl = root.color.jpg.url;
  else if (root.Color?.jpg?.url) downloadUrl = root.Color.jpg.url;
  else if (root.basecolor?.jpg?.url) downloadUrl = root.basecolor.jpg.url;

  if (!downloadUrl) {
    // 深度搜索符合条件的 1k jpg
    for (const [key, val] of Object.entries(root)) {
      if (/diff|color|base/i.test(key) && val?.jpg?.url) {
        downloadUrl = val.jpg.url;
        break;
      }
    }
  }

  if (!downloadUrl) {
    throw new Error('未找到 Poly Haven 1K JPG 底色贴图');
  }

  if (!isAllowedHost(downloadUrl)) {
    throw new Error(`source_host_rejected: ${downloadUrl}`);
  }

  return downloadUrl;
}

module.exports = {
  searchPolyHaven,
  resolvePolyHavenDownloadUrl,
  isAllowedHost
};
