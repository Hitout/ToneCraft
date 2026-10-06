export interface PendulumTrackLayout {
  start: number;
  width: number;
}

/**
 * 按节拍柱的实际槽位计算滑块轨道。
 *
 * 轨道需要与首尾节拍柱的外缘对齐，而不是直接铺满整个节拍可用区；这样在
 * 2/4、3/4 与 6/8 等拍号下，滑块与节拍网格仍能保持一致的首尾留白。
 */
export function calculatePendulumTrack(
  width: number,
  beatCount: number,
): PendulumTrackLayout {
  if (!Number.isFinite(width) || width <= 0) {
    return { start: 0, width: 0 };
  }
  const count = Math.max(1, Math.round(beatCount));
  const slotWidth = width / count;
  const availableBeatWidth = slotWidth - (count > 4 ? 6 : 0);
  const beatWidth = Math.max(0, Math.min(69, availableBeatWidth));
  const firstBeatEdge = (slotWidth - beatWidth) / 2;
  const end = width - firstBeatEdge;
  return {
    start: firstBeatEdge,
    width: Math.max(0, end - firstBeatEdge),
  };
}
