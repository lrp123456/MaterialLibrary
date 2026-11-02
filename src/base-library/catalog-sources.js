/**
 * 一站一个适配器。种类写死在适配器上。
 * 列表页只负责发现产品地址。没有参考图的条目不入库。
 */

const ADAPTERS = [
  { id: 'treezo', kindKey: 'wood', brand: '千年舟', startUrl: 'https://www.treezogroup.com/individuals-households/product/48.html' },
  { id: 'nippon-cn', kindKey: 'latex', brand: '立邦', startUrl: 'https://www.nipponpaint.com.cn/baidase' },
  { id: 'monalisa', kindKey: 'tile', brand: '蒙娜丽莎', startUrl: 'https://www.monalisa.com.cn/productcenter/list_lcid_0.html' },
  { id: 'marcopolo', kindKey: 'tile', brand: '马可波罗', startUrl: 'https://www.marcopolo.com.cn/products/' },
  { id: 'wallpaper-cn', kindKey: 'wallpaper', brand: '', startUrl: 'https://www.wallpaper.cn/product/271521.html' },
  { id: 'delfone', kindKey: 'stone', brand: '德利丰', startUrl: 'https://stone.delfone.com/product/' },
  { id: 'antolini', kindKey: 'stone', brand: '安托里尼', startUrl: 'https://www.antolini.com/en/c6/natural-stone-collection/m1864/pietra-serena' }
];

function listAdapters() {
  return ADAPTERS.map(({ id, kindKey, brand, startUrl }) => ({ id, kindKey, brand, startUrl }));
}

function getAdapter(id) {
  return ADAPTERS.find((row) => row.id === id) || null;
}

function parseDelfoneSwatches(html, pageUrl) {
  const out = [];
  const seen = new Set();
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = /src="([^"]+)"/i.exec(tag)?.[1] || '';
    const alt = /alt="([^"]*)"/i.exec(tag)?.[1] || '';
    if (!/产品图/.test(alt) || /效果图/.test(alt)) continue;
    const name = alt.replace(/产品图/g, '').trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({
      external_id: `delfone:${name}`,
      name_zh: name,
      source_url: pageUrl,
      image_url: new URL(src, pageUrl).href,
      brand: '德利丰',
      kind_key: 'stone'
    });
  }
  return out;
}

function parseMonalisaSwatches(html, pageUrl) {
  const out = [];
  const seen = new Set();
  for (const match of html.matchAll(/<img\b[^>]*class="poImg"[^>]*>/gi)) {
    const tag = match[0];
    const src = /src="([^"]+)"/i.exec(tag)?.[1] || '';
    if (!src) continue;
    const query = src.split('?')[1] || '';
    let name = '';
    try { name = Buffer.from(query, 'base64').toString('utf8').replace(/\.[a-z0-9]+$/i, '').trim(); } catch { name = ''; }
    if (!name || /^\d+$/.test(name) || /微信|拷贝|副本/.test(name) || seen.has(src)) continue;
    seen.add(src);
    out.push({
      external_id: `monalisa:${query.slice(0, 40) || name}`,
      name_zh: name,
      source_url: pageUrl,
      image_url: new URL(src, pageUrl).href,
      brand: '蒙娜丽莎',
      kind_key: 'tile'
    });
  }
  return out;
}

function decodeNuxtSlashes(value) {
  return String(value || '').replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
}

function hexFromRgb(r, g, b) {
  const clamp = (n) => Math.max(0, Math.min(255, Number(n) || 0));
  return '#' + [clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, '0')).join('');
}

function parseNipponSwatches(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const re = /name:"([^"]+)",url:"(https:\\u002F\\u002Fcdn-color-prod\.nipponpaint\.com\.cn\\u002F[^"]+)"/g;
  let match;
  while ((match = re.exec(html))) {
    const name = match[1].trim();
    const imageUrl = decodeNuxtSlashes(match[2]);
    if (!name || !imageUrl || seen.has(name)) continue;
    seen.add(name);
    const window = html.slice(Math.max(0, match.index - 500), match.index + match[0].length);
    const rgb = /rgbR:(\d+)\s*,\s*rgbG:(\d+)\s*,\s*rgbB:(\d+)/.exec(window);
    out.push({
      external_id: `nippon:${name}`,
      name_zh: name,
      source_url: pageUrl,
      image_url: imageUrl,
      brand: '立邦',
      kind_key: 'latex',
      hex: rgb ? hexFromRgb(rgb[1], rgb[2], rgb[3]) : ''
    });
  }
  return out;
}

function parseMarcopoloSwatches(html, pageUrl) {
  const out = [];
  const seen = new Set();
  const re = /class="[^"]*product-card[^"]*"[\s\S]{0,1200}?<img\b[^>]*\bsrc="([^"]+)"[^>]*>[\s\S]{0,500}?<(?:h[1-4]|p|span|a)\b[^>]*>([^<]{1,40})<\//gi;
  let match;
  while ((match = re.exec(html))) {
    const src = match[1].trim();
    const name = match[2].replace(/\s+/g, ' ').trim();
    if (!src || !name || /undefined|error|fatal/i.test(name) || seen.has(src)) continue;
    seen.add(src);
    out.push({
      external_id: `marcopolo:${name}`,
      name_zh: name,
      source_url: pageUrl,
      image_url: new URL(src, pageUrl).href,
      brand: '马可波罗',
      kind_key: 'tile'
    });
  }
  return out;
}

function parseWallpaperSwatches(html, pageUrl) {
  const og = /property=["']og:image["']\s+content=["']([^"']+)["']/i.exec(html)
    || /content=["']([^"']+)["']\s+property=["']og:image["']/i.exec(html);
  const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const name = h1 ? h1[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
  const brand = (/品牌\s*[:：]\s*([^<\s，,]{1,24})/.exec(html) || [])[1] || '';
  if (!og || !og[1] || !name) return [];
  return [{
    external_id: `wallpaper:${name}`,
    name_zh: name,
    source_url: pageUrl,
    image_url: new URL(og[1], pageUrl).href,
    brand: brand.trim(),
    kind_key: 'wallpaper'
  }];
}

function parseAntoliniSwatches(html, pageUrl) {
  const title = (/<title>\s*([^<|]+)/i.exec(html) || [])[1];
  const name = title ? title.trim() : '';
  const src = (/class="[^"]*images_repeater_elem[^"]*"[^>]*\bsrcfull="([^"]+)"/i.exec(html)
    || /\bsrcfull="([^"]*imgfull[^"]+)"/i.exec(html) || [])[1];
  if (!name || !src) return [];
  const slug = String(pageUrl || '').replace(/\/+$/, '').split('/').pop() || name;
  return [{
    external_id: `antolini:${slug}`,
    name_zh: name,
    source_url: pageUrl,
    image_url: new URL(src, pageUrl).href,
    brand: '安托里尼',
    kind_key: 'stone'
  }];
}

function parseSwatches(adapter, html) {
  if (!adapter) return [];
  if (adapter.id === 'treezo') return parseTreezoSwatches(html, adapter.startUrl);
  if (adapter.id === 'delfone') return parseDelfoneSwatches(html, adapter.startUrl);
  if (adapter.id === 'monalisa') return parseMonalisaSwatches(html, adapter.startUrl);
  if (adapter.id === 'nippon-cn') return parseNipponSwatches(html, adapter.startUrl);
  if (adapter.id === 'marcopolo') return parseMarcopoloSwatches(html, adapter.startUrl);
  if (adapter.id === 'wallpaper-cn') return parseWallpaperSwatches(html, adapter.startUrl);
  if (adapter.id === 'antolini') return parseAntoliniSwatches(html, adapter.startUrl);
  return [];
}

function parseTreezoSwatches(html, pageUrl) {
  const out = [];
  const re = /<li\b([^>]*)>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = re.exec(html))) {
    const attrs = match[1];
    const body = match[2];
    const id = /data-id="(\d+)"/.exec(attrs)?.[1];
    const imgs = [...body.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/gi)];
    const img = imgs.find((row) => /uploadfile|resource\.treezogroup/i.test(row[1])) || null;
    if (!id || !img) continue;
    const alt = /alt="([^"]*)"/i.exec(img[0])?.[1] || '';
    const text = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const name = (alt || text).trim().replace(/\.(jpg|jpeg|png|webp)$/i, '');
    if (!name || /square\.png$/i.test(img[1])) continue;
    const imageUrl = new URL(img[1], pageUrl).href;
    out.push({
      external_id: `treezo:${id}`,
      name_zh: name,
      source_url: pageUrl,
      image_url: imageUrl,
      brand: '千年舟',
      kind_key: 'wood'
    });
  }
  return out;
}

module.exports = {
  listAdapters,
  getAdapter,
  parseTreezoSwatches,
  parseNipponSwatches,
  parseMarcopoloSwatches,
  parseWallpaperSwatches,
  parseAntoliniSwatches,
  parseSwatches
};
