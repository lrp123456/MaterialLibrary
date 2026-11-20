/**
 * 创作库列表卡片。打开时只带封面和标题，提示词与整包图片在点开某一条时再取。
 */
'use strict';

function parseJson(text, fallback) {
  try {
    const value = JSON.parse(text || '');
    return value == null ? fallback : value;
  } catch {
    return fallback;
  }
}

function mapCreationTemplateRow(r) {
  const origin_images = Array.isArray(r.origin_images) ? r.origin_images : parseJson(r.origin_images, []);
  const result_images = Array.isArray(r.result_images) ? r.result_images : parseJson(r.result_images, []);
  const paramsObj = r.params && typeof r.params === 'object' ? r.params : parseJson(r.params_json, {});
  const tagsArr = Array.isArray(r.tags) ? r.tags : parseJson(r.tags, []);
  if ((r.type === 'video' || String(result_images[0]?.url || '').endsWith('.mp4')) && result_images[0]) {
    if (!result_images[0].poster && result_images[0].fid) {
      result_images[0].poster = '/api/viewer/assets/' + encodeURIComponent(result_images[0].fid) + '/poster';
    }
  }
  return {
    ...r,
    created_at: Number(r.created_at || r.updated_at || Date.now()),
    updated_at: Number(r.updated_at || r.created_at || Date.now()),
    type: r.type || 'image',
    space: r.space || '',
    style: r.style || '',
    purpose: r.purpose || '',
    channel: r.channel || 'studio',
    is_pinned: Number(r.is_pinned || 0),
    section_id: r.section_id || null,
    pin_order: r.pin_order !== null && r.pin_order !== undefined ? Number(r.pin_order) : null,
    pinned_at: r.pinned_at !== null && r.pinned_at !== undefined ? Number(r.pinned_at) : null,
    media_dir: r.media_dir || null,
    use_count: Number(r.use_count || 0),
    poster_w: r.poster_w !== null && r.poster_w !== undefined ? Number(r.poster_w) : null,
    poster_h: r.poster_h !== null && r.poster_h !== undefined ? Number(r.poster_h) : null,
    aspect_ratio: r.aspect_ratio || '16:9',
    origin_images,
    result_images,
    params: paramsObj,
    tags: tagsArr,
  };
}

function lightMedia(item) {
  if (!item || typeof item !== 'object') return null;
  const url = String(item.url || '');
  const poster = String(item.poster || item.poster_url || '');
  if (url.startsWith('data:') && !item.fid && !poster) return null;
  return {
    fid: item.fid || '',
    url: url.startsWith('data:') ? '' : url,
    poster,
    w: item.w || item.width || null,
    h: item.h || item.height || null,
  };
}

function toCreationCard(full) {
  const result = lightMedia(Array.isArray(full.result_images) ? full.result_images[0] : null);
  const origin = lightMedia(Array.isArray(full.origin_images) ? full.origin_images[0] : null);
  return {
    id: full.id,
    title: full.title || '',
    type: full.type || 'image',
    aspect_ratio: full.aspect_ratio || '16:9',
    poster_w: full.poster_w ?? null,
    poster_h: full.poster_h ?? null,
    is_pinned: Number(full.is_pinned || 0),
    section_id: full.section_id || null,
    pin_order: full.pin_order ?? null,
    pinned_at: full.pinned_at ?? null,
    created_at: Number(full.created_at || 0),
    updated_at: Number(full.updated_at || 0),
    space: full.space || '',
    style: full.style || '',
    purpose: full.purpose || '',
    channel: full.channel || 'studio',
    use_count: Number(full.use_count || 0),
    card: true,
    result_images: result ? [result] : [],
    origin_images: origin ? [origin] : [],
  };
}

module.exports = {
  mapCreationTemplateRow,
  toCreationCard,
};
