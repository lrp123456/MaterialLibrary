/** 局部血缘图的关系归并与摆放。只读已有血缘，不新增边。 */

export const KIND_LABEL = {
  parent: '父图',
  child: '衍生',
  ref: '参考',
  edit: '剪辑使用'
};

const KIND_ORDER = ['parent', 'child', 'ref', 'edit'];

export const KIND_COLOR = {
  parent: '#F59E0B',
  child: '#F59E0B',
  ref: '#06B6D4',
  edit: '#10B981'
};

function pushRelation(out, asset, kind, note) {
  const fid = asset && asset.fid;
  if (!fid) return;
  out.push({
    fid,
    kind,
    name: asset.file_name || asset.name || fid,
    url: asset.url || '',
    note: note || ''
  });
}

/** 一张素材的直接关系：父图、参考、衍生、剪辑使用。剪辑不进衍生。 */
export function relationsOf(lineage) {
  const out = [];
  if (!lineage) return out;
  if (lineage.parent && lineage.parent.fid) pushRelation(out, lineage.parent, 'parent', '');
  for (const ref of lineage.refs || []) pushRelation(out, ref, 'ref', '');
  for (const child of lineage.children || []) pushRelation(out, child, 'child', '');
  for (const film of lineage.usedByFilms || []) pushRelation(out, film, 'edit', '成片');
  for (const use of (lineage.record && lineage.record.editUses) || []) {
    pushRelation(out, { fid: use.fid, file_name: use.file_name || use.name || '' }, 'edit', use.role || '');
  }
  return out;
}

export function mergeRelations(list) {
  const map = new Map();
  for (const rel of list) {
    if (!rel || !rel.fid) continue;
    let node = map.get(rel.fid);
    if (!node) {
      node = { fid: rel.fid, name: rel.name || rel.fid, url: rel.url || '', notes: [], kinds: [] };
      map.set(rel.fid, node);
    }
    if (rel.name && (node.name === node.fid || !node.name)) node.name = rel.name;
    if (rel.url && !node.url) node.url = rel.url;
    if (!node.kinds.includes(rel.kind)) node.kinds.push(rel.kind);
    if (rel.note && !node.notes.includes(rel.note)) node.notes.push(rel.note);
  }
  for (const node of map.values()) {
    node.kinds.sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  }
  return [...map.values()];
}

export const VERSION_LABEL = {
  restage_9_16: '9:16 净画重构',
  restage_3_4: '3:4 净画重构'
};

/** 同一张素材上的 9:16、3:4 画幅，不是另一条资产，也不进父图。 */
export function versionNodes(derivatives) {
  const out = [];
  for (const item of derivatives || []) {
    const name = VERSION_LABEL[item && item.kind];
    if (!name || item.id == null || item.id === '') continue;
    out.push({
      fid: `deriv:${item.id}`,
      name,
      kinds: ['child'],
      notes: [],
      sameAsset: true,
      derivativeId: item.id
    });
  }
  return out;
}

export function visibleKind(node, flags) {
  if (!node) return '';
  return node.kinds.find((kind) => flags[kind]) || '';
}

/**
 * 中心在画布正中。第一圈均分。第二圈靠在各自的第一圈节点外侧。
 * ring2 节点带 via，指向它从哪张第一圈长出来。
 */
export function layoutGraph({ center, ring1, ring2, width, height }) {
  const w = Number(width) || 0;
  const h = Number(height) || 0;
  if (!center || !center.fid || w < 40 || h < 40) {
    return { nodes: [], edges: [] };
  }
  const cx = w / 2;
  const cy = h / 2;
  const r1 = Math.max(120, Math.min(w, h) * 0.28);
  const r2 = Math.max(r1 + 108, Math.min(w, h) * 0.43);
  const nodes = new Map();
  nodes.set(center.fid, { ...center, x: cx, y: cy, ring: 0, angle: -Math.PI / 2 });
  const first = ring1 || [];
  const count = Math.max(first.length, 1);
  first.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
    nodes.set(node.fid, {
      ...node,
      x: cx + Math.cos(angle) * r1,
      y: cy + Math.sin(angle) * r1,
      ring: 1,
      angle
    });
  });
  const groups = new Map();
  for (const node of ring2 || []) {
    if (!node || !node.fid || nodes.has(node.fid)) continue;
    const key = node.via || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(node);
  }
  for (const [via, group] of groups) {
    const host = nodes.get(via);
    const base = host ? host.angle : -Math.PI / 2;
    group.forEach((node, index) => {
      const spread = Math.min(0.95, 0.42 * group.length);
      const angle = group.length === 1
        ? base
        : base - spread / 2 + (index * spread) / (group.length - 1);
      nodes.set(node.fid, {
        ...node,
        x: cx + Math.cos(angle) * r2,
        y: cy + Math.sin(angle) * r2,
        ring: 2,
        angle
      });
    });
  }
  return { nodes: [...nodes.values()], edges: [] };
}

/** 第二圈：只从已经显示的第一圈往外长，不把隐藏类型补回来。 */
export function secondRing(ring1, packs, flags, centerFid) {
  const skip = new Set([centerFid, ...(ring1 || []).map((node) => node.fid)]);
  const map = new Map();
  for (const host of ring1 || []) {
    if (host.sameAsset) continue;
    const lineage = packs && packs[host.fid];
    if (!lineage) continue;
    for (const rel of relationsOf(lineage)) {
      if (!rel.fid || skip.has(rel.fid) || !flags[rel.kind]) continue;
      let node = map.get(rel.fid);
      if (!node) {
        node = { fid: rel.fid, name: rel.name || rel.fid, url: rel.url || '', notes: [], kinds: [], via: host.fid };
        map.set(rel.fid, node);
      }
      if (rel.name && node.name === node.fid) node.name = rel.name;
      if (!node.kinds.includes(rel.kind)) node.kinds.push(rel.kind);
      if (rel.note && !node.notes.includes(rel.note)) node.notes.push(rel.note);
    }
  }
  for (const node of map.values()) {
    node.kinds.sort((a, b) => KIND_ORDER.indexOf(a) - KIND_ORDER.indexOf(b));
  }
  return [...map.values()];
}
