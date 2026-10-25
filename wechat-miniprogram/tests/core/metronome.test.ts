import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  SUBDIVISIONS,
  Subdivision,
  beatDurationSeconds,
  normalizedConfig,
  subdivisionForBeat,
  subdivisionDurationSeconds,
} from '../../miniprogram/core/metronome/metronome-config';
import { MetronomeTimeline } from '../../miniprogram/core/metronome/metronome-timeline';
import { TapTempoTracker } from '../../miniprogram/core/metronome/tap-tempo';

describe('节拍器配置', () => {
  it('把 BPM 限制在 20 到 300 的产品范围内', () => {
    expect(normalizedConfig({ bpm: 1 }).bpm).toBe(20);
    expect(normalizedConfig({ bpm: 999 }).bpm).toBe(300);
  });

  it('按拍号分母和细分计算节拍间隔', () => {
    expect(subdivisionDurationSeconds(DEFAULT_CONFIG)).toBeCloseTo(0.5);
    expect(
      subdivisionDurationSeconds(
        normalizedConfig({ bpm: 120, timeSignature: '6/8', subdivision: 'eighth' }),
      ),
    ).toBeCloseTo(0.125);
  });

  it('摆锤完整一拍的时长跟随拍号分母', () => {
    expect(beatDurationSeconds({ bpm: 120, timeSignature: '4/4' })).toBeCloseTo(0.5);
    expect(beatDurationSeconds({ bpm: 120, timeSignature: '6/8' })).toBeCloseTo(0.25);
    expect(beatDurationSeconds({ bpm: 120, timeSignature: '12/8' })).toBeCloseTo(0.25);
  });

  it('拍号变化时补齐对应数量的强弱设置', () => {
    const config = normalizedConfig({ timeSignature: '7/8' });
    expect(config.beatStrengths).toHaveLength(7);
    expect(config.beatStrengths[0]).toBe('accent');
    expect(config.beatStrengths[6]).toBe('normal');
  });

  it('本地配置拍号损坏时回退到完整的默认节拍列', () => {
    const config = normalizedConfig({ timeSignature: 'invalid' as never });
    expect(config.timeSignature).toBe('4/4');
    expect(config.beatStrengths).toHaveLength(4);
  });

  it('本地配置强弱值损坏时只保留合法枚举', () => {
    const config = normalizedConfig({
      beatStrengths: ['accent', 'invalid', 'muted', 'normal'] as never,
    });
    expect(config.beatStrengths).toEqual(['accent', 'normal', 'muted', 'normal']);
  });

  it('逐拍细分从统一细分展开并保留每拍覆盖值', () => {
    const config = normalizedConfig({
      subdivision: 'eighth',
      customSubdivisionEnabled: true,
      beatSubdivisions: ['quarter', 'invalid' as never, 'triplet'],
    });

    expect(config.beatSubdivisions).toEqual([
      'quarter',
      'eighth',
      'triplet',
      'eighth',
    ]);
    expect(subdivisionForBeat(config, 1)).toBe('eighth');
    expect(subdivisionForBeat(config, 99)).toBe('eighth');
    expect(subdivisionDurationSeconds(config, 2)).toBeCloseTo(1 / 6);
  });
});

describe('TapTempoTracker', () => {
  it('使用最近点击的平均间隔计算 BPM', () => {
    const tracker = new TapTempoTracker();
    expect(tracker.addTap(0)).toBeNull();
    expect(tracker.addTap(500)).toBe(120);
    expect(tracker.addTap(1000)).toBe(120);
  });

  it('超过两秒没有点击时重新开始采样', () => {
    const tracker = new TapTempoTracker();
    tracker.addTap(0);
    tracker.addTap(500);
    expect(tracker.addTap(3000)).toBeNull();
  });
});

describe('MetronomeTimeline', () => {
  it('已提前排入但尚未发声的拍点保持固定起点，改速只缩放其后的间隔', () => {
    const timeline = new MetronomeTimeline();
    timeline.reset(0.08, normalizedConfig({ bpm: 120 }));
    expect(timeline.collect(0.15).map((tick) => tick.at)).toEqual([0.08]);
    timeline.queueConfig(normalizedConfig({ bpm: 240 }), 0.01);
    expect(timeline.collect(0.4)[0].at).toBeCloseTo(0.33);
  });

  it.each(SUBDIVISIONS)('%s 的整拍静音会覆盖全部细分，且仍正常推进下一拍', (subdivision) => {
    const timeline = new MetronomeTimeline();
    timeline.reset(0, normalizedConfig({
      subdivision, beatStrengths: ['muted', 'secondary', 'normal', 'normal'],
    }));
    const ticks = timeline.collect(1);
    const mutedBeat = ticks.filter((tick) => tick.beatIndex === 0);
    expect(mutedBeat.every((tick) => !tick.audible && tick.strength === 'muted')).toBe(true);
    const nextBeat = ticks.filter((tick) => tick.beatIndex === 1);
    expect(nextBeat[0].at).toBeCloseTo(0.5);
    expect(nextBeat.some((tick) => tick.audible)).toBe(true);
  });

  it.each([
    { subdivisions: ['quarter', 'sixteenth', 'quarter', 'quarter'] as const, cursor: 0.25, expected: 0.375 },
    { subdivisions: ['sixteenth', 'quarter', 'quarter', 'quarter'] as const, cursor: 0.4, expected: 0.45 },
  ])('混合细分改速保留当前间隔相位：$subdivisions', ({ subdivisions, cursor, expected }) => {
    const config = normalizedConfig({
      bpm: 120, customSubdivisionEnabled: true, beatSubdivisions: [...subdivisions],
    });
    const timeline = new MetronomeTimeline();
    timeline.reset(0, config);
    timeline.collect(cursor);
    timeline.queueConfig(normalizedConfig({ ...config, bpm: 240 }), cursor);
    expect(timeline.collect(0.51)[0].at).toBeCloseTo(expected);
  });

  const newRhythms: Array<[Subdivision, number[]]> = [
    ['dotted-eighth-sixteenth', [0, 0.75]],
    ['sixteenth-dotted-eighth', [0, 0.25]],
    ['eighth-sixteenth-sixteenth', [0, 0.5, 0.75]],
    ['sixteenth-sixteenth-eighth', [0, 0.25, 0.5]],
    ['sixteenth-eighth-sixteenth', [0, 0.25, 0.75]],
    ['eighth-note-rest', [0]],
    ['sixteenth-rest-note-note-note', [0.25, 0.5, 0.75]],
    ['eighth-rest-sixteenth-sixteenth', [0.5, 0.75]],
    ['sixteenth-sixteenth-eighth-rest', [0, 0.25]],
    ['sixteenth-note-note-rest-note', [0, 0.25, 0.75]],
    ['sixteenth-eighth-rest-sixteenth', [0, 0.75]],
    ['sixteenth-rest-note-note-rest', [0.25, 0.5]],
  ];

  it.each(newRhythms)('%s 按实际音符时值触发并保持每拍总长', (subdivision, offsets) => {
    for (const timeSignature of ['4/4', '6/8'] as const) {
      const config = normalizedConfig({ bpm: 120, timeSignature, subdivision });
      const beat = beatDurationSeconds(config);
      const timeline = new MetronomeTimeline();
      timeline.reset(0, config);
      const audibleTimes = timeline.collect(beat * 2 + 0.001)
        .filter((tick) => tick.audible)
        .map((tick) => tick.at);
      const expected = [
        ...offsets, ...offsets.map((offset) => offset + 1),
        ...(offsets[0] === 0 ? [2] : []),
      ];
      expect(audibleTimes).toHaveLength(expected.length);
      audibleTimes.forEach((at, index) => expect(at).toBeCloseTo(expected[index] * beat));
    }
  });

  it('新节奏可以逐拍混用且相同网格的节奏切换仍等待下一小节', () => {
    const timeline = new MetronomeTimeline();
    const config = normalizedConfig({
      timeSignature: '5/4',
      customSubdivisionEnabled: true,
      beatStrengths: ['accent', 'normal', 'normal', 'normal', 'normal'],
      beatSubdivisions: newRhythms.slice(0, 5).map(([rhythm]) => rhythm),
    });
    timeline.reset(0, config);
    timeline.collect(0.001);
    timeline.queueConfig(normalizedConfig({
      ...config,
      beatSubdivisions: newRhythms.slice(0, 5).map(() => 'sixteenth-dotted-eighth'),
    }));
    const audibleTimes = timeline.collect(3.001).filter((tick) => tick.audible).map((tick) => tick.at);
    expect(audibleTimes).toEqual([
      0.375, 0.5, 0.625, 1, 1.25, 1.375, 1.5, 1.625, 1.75,
      2, 2.125, 2.375, 2.5, 2.625, 3,
    ]);
  });

  it('按音频时间点生成连续节拍', () => {
    const timeline = new MetronomeTimeline();
    timeline.reset(10, normalizedConfig({ bpm: 120 }));
    const ticks = timeline.collect(11.1);
    expect(ticks.map((tick) => tick.at)).toEqual([10, 10.5, 11]);
    expect(ticks[0].beatIndex).toBe(0);
    expect(ticks[1].beatIndex).toBe(1);
  });

  it('细分进行中时把拍号结构延迟到当前小节结束', () => {
    const timeline = new MetronomeTimeline();
    timeline.reset(0, normalizedConfig({ bpm: 120, timeSignature: '4/4' }));
    timeline.collect(0.01);
    timeline.queueConfig(normalizedConfig({ bpm: 120, timeSignature: '2/4' }));

    const ticks = timeline.collect(2.1);
    expect(ticks.find((tick) => tick.at === 1)?.config.timeSignature).toBe('4/4');
    expect(ticks.find((tick) => tick.at === 2)?.config.timeSignature).toBe('2/4');
  });

  it('播放中调整重音时立即作用于下一拍', () => {
    const timeline = new MetronomeTimeline();
    timeline.reset(0, normalizedConfig({ bpm: 120 }));
    timeline.collect(0.01);
    timeline.queueConfig(normalizedConfig({ bpm: 120, beatStrengths: ['accent', 'secondary', 'normal', 'normal'] }));

    const ticks = timeline.collect(0.51);
    expect(ticks[0]?.at).toBe(0.5);
    expect(ticks[0]?.strength).toBe('secondary');
  });

  it('拍号切换等当前小节结束后从新小节第一拍开始', () => {
    const timeline = new MetronomeTimeline();
    timeline.reset(0, normalizedConfig({ bpm: 120, timeSignature: '4/4' }));
    timeline.collect(0.51);
    timeline.queueConfig(normalizedConfig({ bpm: 120, timeSignature: '2/4' }));

    const ticks = timeline.collect(2.1);
    expect(ticks.find((tick) => tick.at === 1)?.config.timeSignature).toBe('4/4');
    const firstNewBar = ticks.find((tick) => tick.at === 2);
    expect(firstNewBar?.beatIndex).toBe(0);
    expect(firstNewBar?.config.timeSignature).toBe('2/4');
  });

  it('BPM 改变时保持当前细分相位', () => {
    const timeline = new MetronomeTimeline();
    timeline.reset(0, normalizedConfig({ bpm: 120 }));
    timeline.collect(0.1);
    timeline.queueConfig(normalizedConfig({ bpm: 60 }), 0.25);

    const ticks = timeline.collect(0.8);
    expect(ticks[0]?.at).toBeCloseTo(0.75);
    expect(ticks[0]?.config.bpm).toBe(60);
  });

  it('调度器恢复时跳过已经错过的音频时间点', () => {
    const timeline = new MetronomeTimeline();
    timeline.reset(10, normalizedConfig({ bpm: 120 }));
    timeline.discardBefore(10.6);

    const ticks = timeline.collect(12);
    expect(ticks.map((tick) => tick.at)).toEqual([11, 11.5]);
    expect(ticks[0].beatIndex).toBe(2);
  });

  it('逐拍细分使用各自的时间间隔和休止位', () => {
    const timeline = new MetronomeTimeline();
    timeline.reset(
      0,
      normalizedConfig({
        timeSignature: '3/4',
        customSubdivisionEnabled: true,
        beatSubdivisions: ['quarter', 'triplet', 'eighth-rest-note'],
      }),
    );

    const ticks = timeline.collect(1.6);

    expect(ticks.map((tick) => [tick.beatIndex, tick.subdivisionIndex])).toEqual([
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
      [2, 0],
      [2, 1],
      [0, 0],
    ]);
    const expectedTimes = [0, 0.5, 2 / 3, 5 / 6, 1, 1.25, 1.5];
    ticks.forEach((tick, index) => {
      expect(tick.at).toBeCloseTo(expectedTimes[index]);
    });
    expect(ticks[4].audible).toBe(false);
  });

  it('播放中切换逐拍细分时等到下一小节再生效', () => {
    const timeline = new MetronomeTimeline();
    timeline.reset(0, normalizedConfig({ timeSignature: '4/4' }));
    timeline.collect(0.01);
    timeline.queueConfig(
      normalizedConfig({
        timeSignature: '4/4',
        customSubdivisionEnabled: true,
        beatSubdivisions: ['quarter', 'triplet', 'quarter', 'quarter'],
      }),
    );

    const ticks = timeline.collect(2.8);
    expect(ticks.find((tick) => tick.at === 0.5)?.config.customSubdivisionEnabled).toBe(false);
    const firstCustomTick = ticks.find((tick) => tick.at >= 2);
    expect(firstCustomTick?.at).toBe(2);
    expect(firstCustomTick?.config.customSubdivisionEnabled).toBe(true);
    expect(firstCustomTick?.config.beatSubdivisions[1]).toBe('triplet');
  });
});
