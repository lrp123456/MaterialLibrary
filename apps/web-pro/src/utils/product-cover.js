/**
 * 3D 选品的「外部预览」只有一张封面。
 * 卡片、角标、编辑页和内部视口的初始机位都读这一份，避免角标写 180°、图却是 45°、视口再从 0° 打开。
 *
 * 封面仍沿用原来的回退顺序：right_45 → front → front_0 → 任意已有快照 → preview_url。
 * 角标和机位跟这张图自己的视角走，不跟库里的 facing 数字走。
 */

const ANGLES = [
  { key: 'right_45', yaw: 45, pitch: 75, label: '45°' },
  { key: 'front_0', yaw: 0, pitch: 80, label: '0°', aliases: ['front'] },
  { key: 'right_90', yaw: 90, pitch: 80, label: '90°' },
  { key: 'back_180', yaw: 180, pitch: 80, label: '180°' },
  { key: 'left_45', yaw: -45, pitch: 75, label: '315°' }
];

function snapshotMap(item) {
  const raw = item && item.snapshots;
  if (!raw || typeof raw !== 'object') return {};
  return raw;
}

function urlOf(map, angle) {
  const direct = map[angle.key];
  if (typeof direct === 'string' && direct) return direct;
  for (const alias of angle.aliases || []) {
    const value = map[alias];
    if (typeof value === 'string' && value) return value;
  }
  return '';
}

export function thumbnailUrl(item) {
  const map = snapshotMap(item);
  if (typeof map.right_45 === 'string' && map.right_45) return map.right_45;
  if (typeof map.front === 'string' && map.front) return map.front;
  if (typeof map.front_0 === 'string' && map.front_0) return map.front_0;
  const first = Object.values(map).find((value) => typeof value === 'string' && value.length > 0);
  if (first) return first;
  return (item && item.preview_url) || '';
}

export function productCover(item) {
  const url = thumbnailUrl(item);
  const map = snapshotMap(item);
  for (const angle of ANGLES) {
    if (url && urlOf(map, angle) === url) {
      return { url, key: angle.key, yaw: angle.yaw, pitch: angle.pitch, label: angle.label };
    }
  }
  return { url, key: 'preview', yaw: null, pitch: 75, label: '封面' };
}

export function coverBadge(cover) {
  if (!cover || !cover.url) return '';
  if (cover.yaw == null) return '封面';
  return `标准 ${cover.label}`;
}

export function coverOrbit(cover) {
  if (!cover || cover.yaw == null) return 'auto auto auto';
  return `${cover.yaw}deg ${cover.pitch ?? 75}deg auto`;
}
