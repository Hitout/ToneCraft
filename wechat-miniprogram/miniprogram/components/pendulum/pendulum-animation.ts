export interface PendulumAnimationTiming {
  phase: number;
  startAt: number;
  delayMs: number;
  durationMs: number;
}

const FULL_CYCLE_PHASE = 2;

/**
 * 将摆锤动画时长限制为可用于 CSS 动画的正数，避免异常输入让动画失效。
 */
export function normalizePendulumDurationMs(durationMs: number): number {
  if (!Number.isFinite(durationMs)) return 1;
  return Math.max(1, durationMs);
}

/**
 * 根据动画起点和当前时刻计算摆锤相位。
 * 相位 0 和 2 都在左端，1 在右端，正好对应 alternate 动画的完整往返。
 */
export function pendulumPhaseAt(
  startAt: number,
  durationMs: number,
  now: number,
): number {
  const duration = normalizePendulumDurationMs(durationMs);
  const reference = Number.isFinite(startAt) ? startAt : now;
  const elapsed = Math.max(0, now - reference);
  return (elapsed / duration) % FULL_CYCLE_PHASE;
}

/**
 * 改变 BPM 时把 CSS 动画重新定位到同一相位，避免修改 duration 造成滑块瞬移。
 */
export function retimePendulumAnimation(
  startAt: number,
  currentDurationMs: number,
  nextDurationMs: number,
  now: number,
): PendulumAnimationTiming {
  const durationMs = normalizePendulumDurationMs(nextDurationMs);
  const phase = pendulumPhaseAt(startAt, currentDurationMs, now);
  return {
    phase,
    startAt: now - phase * durationMs,
    delayMs: -phase * durationMs,
    durationMs,
  };
}
