/**
 * ambientCG CC0 材质来源适配器
 * 官方规范：
 * - 列表：GET https://ambientcg.com/api/v2/full_json?type=Material
 * - 允许类别：Plaster, Painted Plaster, Tiles, Brick, Terrazzo, Travertine, Carpet, Fabric, Planks, wood
 * - 允许主机：ambientcg.com, acg-media.struffelproductions.com
 * - 下载 1K-JPG zip，只抽出以 _Color.jpg 结尾的文件，其余贴图立刻丢弃，zip 删除
 */

const zlib = require('zlib');

const ALLOWED_CATEGORIES = new Set([
  'plaster',
  'painted plaster',
  'tiles',
  'brick',
  'terrazzo',
  'travertine',
  'carpet',
  'fabric',
  'planks',
  'wood'
]);

const ALLOWED_HOSTS = new Set([
  'ambientcg.com',
  'acg-media.struffelproductions.com'
]);

function isAllowedHost(urlStr) {
  try {
    const u = new URL(urlStr);
    return ALLOWED_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

/**
 * 零依赖极简 ZIP 单文件抽取器
 * 查找文件名匹配 endingPattern 的文件数据
 */
function extractFileFromZip(zipBuffer, filenameEnding = '_Color.jpg') {
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break; // 不是 Local file header，停止或继续找

    const method = zipBuffer.readUInt16LE(offset + 8);
    const compSize = zipBuffer.readUInt32LE(offset + 18);
    const uncompSize = zipBuffer.readUInt32LE(offset + 22);
    const fnLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);

    const filename = zipBuffer.toString('utf8', offset + 30, offset + 30 + fnLen);
    const dataStart = offset + 30 + fnLen + extraLen;
    const dataEnd = dataStart + compSize;

    if (filename.toLowerCase().endsWith(filenameEnding.toLowerCase())) {
      const compressedData = zipBuffer.slice(dataStart, dataEnd);
      if (method === 0) {
        return compressedData;
      } else if (method === 8) {
        return zlib.inflateRawSync(compressedData);
      } else {
        throw new Error(`不支持的 ZIP 压缩算法: ${method}`);
      }
    }

    offset = dataEnd;
  }
  return null;
}

async function searchAmbientCG(query = '', { timeoutMs = 8000 } = {}) {
  const url = 'https://ambientcg.com/api/v2/full_json?type=Material';
  try {
    const { fetch } = require('undici');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return [];

    const json = await res.json();
    const found = json.foundAssets || [];
    const q = (query || '').toLowerCase().trim();

    const list = [];
    for (const item of found) {
      const cat = (item.displayCategory || '').toLowerCase();
      if (!ALLOWED_CATEGORIES.has(cat)) continue;

      const title = (item.assetId || '').toLowerCase();
      if (!q || title.includes(q) || cat.includes(q)) {
        list.push({
          id: item.assetId,
          title: item.assetId,
          source: 'ambientcg',
          category: item.displayCategory,
          thumb_url: `https://ambientcg.com/get?file=${item.assetId}_PREVIEW.jpg`,
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

module.exports = {
  ALLOWED_CATEGORIES,
  ALLOWED_HOSTS,
  isAllowedHost,
  extractFileFromZip,
  searchAmbientCG
};
