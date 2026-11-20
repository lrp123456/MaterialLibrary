/**
 * 相似工作台的时间排序工具（纯函数，便于单测与复用）
 *
 * 时间口径：素材时间 = assets.created_at
 *  - 上传入库路径优先取文件的修改时间（dateModified）
 *  - 其余路径（同步/抓取/生成）为入库时刻
 */

function toTime(value) {
  const t = Number(value);
  return Number.isFinite(t) && t > 0 ? t : 0;
}

export function memberTime(member) {
  return toTime(member?.createdAt);
}

/**
 * 簇内时间跨度：后端已返回 timeStart/timeEnd 时直接用，
 * 老版本后端未返回时按成员时间现算（保证前端兜底可用）。
 */
export function timeRangeOf(cluster) {
  if (cluster?.timeStart || cluster?.timeEnd) {
    return { timeStart: cluster.timeStart || null, timeEnd: cluster.timeEnd || null };
  }
  const times = (cluster?.members || []).map(memberTime).filter((t) => t > 0);
  return {
    timeStart: times.length ? Math.min(...times) : null,
    timeEnd: times.length ? Math.max(...times) : null,
  };
}

/**
 * 排序簇列表（不修改入参）
 * @param {Array} clusters 原始簇数组
 * @param {'similarity'|'time_desc'|'time_asc'} sort
 */
export function sortClusters(clusters, sort) {
  const list = Array.isArray(clusters) ? clusters : [];
  if (sort !== 'time_desc' && sort !== 'time_asc') {
    // 相似度默认顺序：保持后端聚类顺序，仅补齐时间跨度供界面展示
    return list.map((c) => ({ ...c, ...timeRangeOf(c) }));
  }

  const desc = sort === 'time_desc';
  return list
    .map((c) => {
      const { timeStart, timeEnd } = timeRangeOf(c);
      const members = (c.members || [])
        .slice()
        .sort((a, b) => (desc ? memberTime(b) - memberTime(a) : memberTime(a) - memberTime(b)));
      return { ...c, timeStart, timeEnd, members };
    })
    .sort((a, b) =>
      desc
        ? (b.timeEnd || 0) - (a.timeEnd || 0) || (b.timeStart || 0) - (a.timeStart || 0)
        : (a.timeEnd || 0) - (b.timeEnd || 0) || (a.timeStart || 0) - (b.timeStart || 0)
    );
}
