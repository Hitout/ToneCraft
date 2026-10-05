import { describe, expect, it } from 'vitest';

import { calculatePendulumTrack } from '../../miniprogram/components/pendulum/pendulum-geometry';

describe('摆锤轨道几何', () => {
  it('四拍时与设计基准的首尾节拍柱外缘对齐', () => {
    const layout = calculatePendulumTrack(318, 4);

    expect(layout.start).toBeCloseTo(5.25, 5);
    expect(layout.width).toBeCloseTo(307.5, 5);
    expect(318 - layout.start - layout.width).toBeCloseTo(layout.start, 5);
  });

  it('两拍时收窄轨道，不铺满整个摆锤槽位', () => {
    const layout = calculatePendulumTrack(318, 2);

    expect(layout.start).toBeCloseTo(45, 5);
    expect(layout.width).toBeCloseTo(228, 5);
  });

  it('五拍以上会为每个节拍柱保留 6px 间隔', () => {
    const fourBeat = calculatePendulumTrack(318, 4);
    const sixBeat = calculatePendulumTrack(318, 6);

    expect(sixBeat.start).toBeCloseTo(3, 5);
    expect(sixBeat.width).toBeCloseTo(312, 5);
    expect(sixBeat.width).toBeGreaterThan(fourBeat.width);
  });
});
