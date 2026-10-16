import { describe, expect, it } from 'vitest';

import {
  pendulumPhaseAt,
  retimePendulumAnimation,
} from '../../miniprogram/components/pendulum/pendulum-animation';

describe('摆锤动画时序', () => {
  it('按 alternate 动画的完整往返计算相位', () => {
    expect(pendulumPhaseAt(1000, 500, 1250)).toBeCloseTo(0.5, 5);
    expect(pendulumPhaseAt(1000, 500, 2000)).toBeCloseTo(0, 5);
  });

  it('改速时保持滑块相位不变', () => {
    const timing = retimePendulumAnimation(1000, 500, 1000, 1250);

    expect(timing.phase).toBeCloseTo(0.5, 5);
    expect(timing.delayMs).toBeCloseTo(-500, 5);
    expect(timing.startAt).toBeCloseTo(750, 5);
  });
});
