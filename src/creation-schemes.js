/**
 * 创作库方案配方中台模块 (Creation Schemes Hub)
 *
 * 核心认知重构：
 * 资产的第一主键是【风格 × 空间 × 方案配方 (Style × Space × Prompt)】。
 * 原图不同但提示词相同，属于“同一套方案在不同户型上的落地案例 (Instances)”。
 *
 * 本模块负责：
 * 1. 方案配方聚合 (aggregateSchemes)
 * 2. 跨基图横向对比与设为封面 (setSchemeCover)
 * 3. 方案活体包 (.csp / zip) 结构化打包导出 (exportSchemeZip)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { dataDirOf, mediaDirFor } = require('./creation-library');

function normalizePrompt(raw) {
  return String(raw || '')
    .replace(/@图\d+(\[[^\]]*\])?/g, '')
    .replace(/@\S+/g, '')
    .replace(/[\s\r\n\t,，。！!？?、:：;；"'"'“”‘’（）\(\)\[\]【】]/g, '')
    .toLowerCase()
    .trim();
}

function promptHashOf(raw) {
  const norm = normalizePrompt(raw);
  if (!norm) return '';
  return crypto.createHash('sha256').update(norm).digest('hex').slice(0, 32);
}

/**
 * 将平铺的 creation_templates 记录聚合为按【风格 × 空间 × 方案配方】组织的方案列表
 */
function aggregateSchemes(rows, filters = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const map = new Map();

  for (const r of list) {
    const style = (r.style || '').trim() || '未填写';
    const space = (r.space || '').trim() || '未填写';
    const pHash = r.prompt_hash || promptHashOf(r.prompt) || 'blank';
    
    // 方案聚合键：风格 + 空间 + 提示词指纹
    const schemeKey = `${style}:::${space}:::${pHash}`;

    if (!map.has(schemeKey)) {
      map.set(schemeKey, {
        scheme_id: crypto.createHash('md5').update(schemeKey).digest('hex').slice(0, 24),
        style: r.style || '',
        space: r.space || '',
        prompt: r.prompt || '',
        prompt_hash: pHash,
        title: r.title || (r.style && r.space ? `${r.style} · ${r.space}方案` : '灵感空间创作方案'),
        type: r.type || 'image',
        operation: r.operation || '',
        created_at: Number(r.created_at || Date.now()),
        updated_at: Number(r.updated_at || Date.now()),
        is_pinned: 0,
        instances: []
      });
    }

    const scheme = map.get(schemeKey);
    if (r.is_pinned) scheme.is_pinned = 1;
    if (r.updated_at && r.updated_at > scheme.updated_at) scheme.updated_at = Number(r.updated_at);
    if (r.created_at && r.created_at < scheme.created_at) scheme.created_at = Number(r.created_at);

    // 格式化实例条目
    scheme.instances.push({
      id: r.id,
      title: r.title || '',
      type: r.type || 'image',
      operation: r.operation || '',
      created_at: Number(r.created_at || 0),
      updated_at: Number(r.updated_at || 0),
      root_origin_hash: r.root_origin_hash || '',
      parent_step_id: r.parent_step_id || '',
      is_cover: Number(r.is_cover || 0),
      is_pinned: Number(r.is_pinned || 0),
      origin_images: r.origin_images || [],
      result_images: r.result_images || [],
      params: r.params || {}
    });
  }

  const result = [];
  for (const scheme of map.values()) {
    // 实例按更新时间从新到旧排
    scheme.instances.sort((a, b) => b.updated_at - a.updated_at);

    // 确定方案默认展示封面：优先选取被用户显式设为封面的实例，若无则取最新实例
    const coverInst = scheme.instances.find(it => it.is_cover === 1) || scheme.instances[0];
    scheme.cover_card = coverInst || null;
    scheme.instance_count = scheme.instances.length;

    // 统计跨越的不同基图数量 (不同 root_origin_hash 的个数)
    const rootSet = new Set(scheme.instances.map(it => it.root_origin_hash).filter(Boolean));
    scheme.root_count = Math.max(rootSet.size, 1);

    // 过滤逻辑
    if (filters.filterSpace && filters.filterSpace !== 'all' && filters.filterSpace !== '全部空间') {
      const matchSpace = filters.filterSpace === '未填写' ? !scheme.space : scheme.space === filters.filterSpace;
      if (!matchSpace) continue;
    }
    if (filters.filterStyle && filters.filterStyle !== 'all' && filters.filterStyle !== '全部风格') {
      const matchStyle = filters.filterStyle === '未填写' ? !scheme.style : scheme.style === filters.filterStyle;
      if (!matchStyle) continue;
    }
    if (filters.filterOperation && filters.filterOperation !== 'all') {
      const matchOp = filters.filterOperation === '未填写' ? !scheme.operation : scheme.instances.some(i => i.operation === filters.filterOperation);
      if (!matchOp) continue;
    }
    if (filters.pinnedOnly && !scheme.is_pinned) continue;
    if (filters.kw) {
      const kw = filters.kw.toLowerCase();
      const matchKw = (scheme.title && scheme.title.toLowerCase().includes(kw))
        || (scheme.prompt && scheme.prompt.toLowerCase().includes(kw))
        || (scheme.style && scheme.style.toLowerCase().includes(kw))
        || (scheme.space && scheme.space.toLowerCase().includes(kw));
      if (!matchKw) continue;
    }

    result.push(scheme);
  }

  // 默认按活跃时间倒序排
  result.sort((a, b) => b.updated_at - a.updated_at);
  return result;
}

/**
 * 纯 Node 原生标准 PKZIP 打包器 (零外部 npm 依赖，安全可靠)
 */
function makeZipBuffer(files) {
  const buffers = [];
  const centralDirs = [];
  let offset = 0;

  function crc32(buf) {
    let c = 0 ^ -1;
    for (let i = 0; i < buf.length; i++) {
      c = (c >>> 8) ^ table[(c ^ buf[i]) & 0xff];
    }
    return (c ^ -1) >>> 0;
  }
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }

  for (const f of files) {
    const raw = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data || ''), 'utf8');
    const compressed = zlib.deflateRawSync(raw);
    const useCompressed = compressed.length < raw.length;
    const body = useCompressed ? compressed : raw;
    const method = useCompressed ? 8 : 0;
    const crc = crc32(raw);
    const nameBuf = Buffer.from(f.path.replace(/\\/g, '/'));

    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(body.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    nameBuf.copy(localHeader, 30);

    buffers.push(localHeader, body);

    const cdir = Buffer.alloc(46 + nameBuf.length);
    cdir.writeUInt32LE(0x02014b50, 0);
    cdir.writeUInt16LE(20, 4);
    cdir.writeUInt16LE(20, 6);
    cdir.writeUInt16LE(0, 8);
    cdir.writeUInt16LE(method, 10);
    cdir.writeUInt16LE(0, 12);
    cdir.writeUInt16LE(0, 14);
    cdir.writeUInt32LE(crc, 16);
    cdir.writeUInt32LE(body.length, 20);
    cdir.writeUInt32LE(raw.length, 24);
    cdir.writeUInt16LE(nameBuf.length, 28);
    cdir.writeUInt16LE(0, 30);
    cdir.writeUInt16LE(0, 32);
    cdir.writeUInt16LE(0, 34);
    cdir.writeUInt16LE(0, 36);
    cdir.writeUInt32LE(0, 38);
    cdir.writeUInt32LE(offset, 42);
    nameBuf.copy(cdir, 46);

    centralDirs.push(cdir);
    offset += localHeader.length + body.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const cd of centralDirs) centralDirSize += cd.length;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralDirSize, 12);
  eocd.writeUInt32LE(centralDirOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...buffers, ...centralDirs, eocd]);
}

/**
 * 导出方案活体包 (.csp / zip)
 */
async function exportSchemeZip(services, { style, space, schemeId, templateIds }) {
  const db = services.db;
  let tpls = [];

  if (Array.isArray(templateIds) && templateIds.length > 0) {
    const qMarks = templateIds.map(() => '?').join(',');
    tpls = db.prepare(`SELECT * FROM creation_templates WHERE id IN (${qMarks}) AND deleted_at IS NULL LIMIT 50`).all(...templateIds);
  } else if (style) {
    tpls = db.prepare('SELECT * FROM creation_templates WHERE style = ? AND deleted_at IS NULL LIMIT 50').all(style);
  } else {
    tpls = db.prepare('SELECT * FROM creation_templates WHERE deleted_at IS NULL LIMIT 30').all();
  }

  const files = [];
  const manifest = {
    bundle_name: style ? `${style}全屋美学创作方案套件` : '灵感空间创作方案包',
    created_at: new Date().toISOString(),
    generator: 'MaterialStudio Pro Creation Hub',
    total_schemes: tpls.length,
    schemes: []
  };

  const readme = [
    `# ${manifest.bundle_name}`,
    `> 导出时间: ${manifest.created_at}`,
    '',
    '## 方案内容清单',
  ];

  const MAX_FILE_SIZE = 8 * 1024 * 1024; // 单文件不超过 8MB 避免内存暴涨

  for (let idx = 0; idx < tpls.length; idx++) {
    const tpl = tpls[idx];
    const spDir = `schemes/${idx + 1}_${(tpl.space || '空间').replace(/[\\/:*?"<>|]/g, '_')}`;
    const schemeMeta = {
      id: tpl.id,
      title: tpl.title,
      style: tpl.style,
      space: tpl.space,
      operation: tpl.operation,
      prompt: tpl.prompt,
      created_at: tpl.created_at
    };
    manifest.schemes.push(schemeMeta);

    readme.push(`### ${idx + 1}. [${tpl.style || '方案'}] ${tpl.space || '空间'} - ${tpl.title || ''}`);
    readme.push(`- **提示词配方**: ${tpl.prompt || '无'}`);
    readme.push('');

    // 存放方案单独的配方 json
    files.push({
      path: `${spDir}/recipe.json`,
      data: JSON.stringify(schemeMeta, null, 2)
    });

    // 读取该 template 私有目录中的文件
    const dir = mediaDirFor(services, tpl.id);
    if (fs.existsSync(dir)) {
      const readDir = (sub) => {
        const subPath = path.join(dir, sub);
        if (fs.existsSync(subPath)) {
          const names = fs.readdirSync(subPath);
          for (const name of names) {
            const fp = path.join(subPath, name);
            if (fs.statSync(fp).isFile()) {
              try {
                const stat = fs.statSync(fp);
                if (stat.size <= MAX_FILE_SIZE) {
                  files.push({
                    path: `${spDir}/${sub}/${name}`,
                    data: fs.readFileSync(fp)
                  });
                }
              } catch (_) {}
            }
          }
        }
      };
      readDir('origin');
      readDir('result');
      readDir('poster');
    }
  }

  files.push({ path: 'manifest.json', data: JSON.stringify(manifest, null, 2) });
  files.push({ path: 'README.md', data: readme.join('\n') });

  const zipBuf = makeZipBuffer(files);
  return {
    buffer: zipBuf,
    filename: `${encodeURIComponent(manifest.bundle_name)}_${Date.now()}.zip`
  };
}

module.exports = {
  normalizePrompt,
  promptHashOf,
  aggregateSchemes,
  makeZipBuffer,
  exportSchemeZip
};
