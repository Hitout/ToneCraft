export interface PendulumTrackLayout {
  start: number;
  width: number;
}

/**
 * 按节拍柱的实际槽位计算摆锤轨道。
 *
 * 轨道需要与首尾节拍柱的外缘对齐，而不是简单使用整个节拍可用区；这也是
 * 2/4、3/4 与 6/8 等拍号下视觉仍然保持一致的关键几何约束。调用方传入的
 * width 与节拍网格共用同一坐标系，因此首尾留白可以严格镜像。
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
