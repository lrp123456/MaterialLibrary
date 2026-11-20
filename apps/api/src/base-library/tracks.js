/**
 * 基材双轨定义与判定规则 (Track A / Track B)
 *
 * 判定口诀：
 * 1. 把这张图换成另一个 HEX，设计师仍然认为是同一种材料 → 轨道 B (花色是身份，必须附 1K 参考图)。
 * 2. 换成另一个 HEX 后只是「同工艺的另一种漆 / 另一种金属色」→ 轨道 A (色彩与工艺光感，参考图恒为 null)。
 * 3. 用户没要求换品类 → 一律轨道 A 的 mode: 'recolor'，即使原材质本身属于轨道 B。原图选区已包含该纹理证据。
 */

const TRACK_A = 'A';
const TRACK_B = 'B';

/**
 * 判断编辑区域属于轨道 A 还是轨道 B
 * @param {object} region 区域描述对象
 * @returns {'A'|'B'} 轨道标识
 */
function resolveTrack(region = {}) {
  // 显式指定 track 优先
  if (region.track === 'B') return TRACK_B;
  if (region.track === 'A') return TRACK_A;

  // 模式为 recolor (只换色) 恒为轨道 A
  if (region.mode === 'recolor') return TRACK_A;

  // 仓库为 paint (色号) 恒为轨道 A
  if (region.warehouse === 'paint') return TRACK_A;

  // 模式为 rematerial 或仓库为 material，若有具象材质且不是纯工艺则为轨道 B
  if (region.mode === 'rematerial' || region.warehouse === 'material') {
    // 艺术漆纯工艺无贴图走轨道 A
    if (region.process && !region.asset_id && !region.assetId) {
      return TRACK_A;
    }
    return TRACK_B;
  }

  return TRACK_A;
}

module.exports = {
  TRACK_A,
  TRACK_B,
  resolveTrack
};
