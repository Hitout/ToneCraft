import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../miniprogram/platform/recorder-tuner', () => ({ recorderTuner: {} }));

interface TrendSample {
  cents: number | null;
  capturedAt: number;
}

interface TunerPage {
  data: Record<string, unknown>;
  trendSamples: TrendSample[];
  tunedTargetIndices: number[];
  lastReading: { frequencyHz: number } | null;
  handlePitch(frequencyHz: number, confidence: number, startsNewTrack: boolean, capturedAt: number): void;
  setData(patch: Record<string, unknown>): void;
}

async function setup(): Promise<TunerPage> {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1120);
  let page!: TunerPage;
  vi.stubGlobal('Page', (definition: TunerPage) => {
    page = {
      ...definition,
      data: { ...definition.data },
      trendSamples: [],
      tunedTargetIndices: [],
      setData(patch) { Object.assign(this.data, patch); },
    };
  });
  await import('../../miniprogram/pages/tuner/tuner');
  return page;
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('调音页面音轨时序', () => {
  it('静音断点使用采集时间，晚于断点到达的旧结果不能改写读数或倒退音轨', async () => {
    const page = await setup();
    page.handlePitch(110, 0.99, true, 1100);
    vi.advanceTimersByTime(420);
    expect(page.trendSamples.map((sample) => sample.capturedAt)).toEqual([1100, 1520]);

    vi.advanceTimersByTime(160);
    page.handlePitch(196, 0.99, false, 1164);
    expect(page.trendSamples.map((sample) => sample.capturedAt)).toEqual([1100, 1520]);
    expect(page.lastReading?.frequencyHz).toBe(110);

    vi.advanceTimersByTime(100);
    page.handlePitch(196, 0.99, true, 1740);
    expect(page.trendSamples.map((sample) => sample.capturedAt)).toEqual([1100, 1520, 1740]);
    expect(page.lastReading?.frequencyHz).toBe(196);
  });

  it('线程整体延迟不改变音轨时间轴，断点之后的有效采集结果可以继续显示', async () => {
    const page = await setup();
    vi.advanceTimersByTime(580);
    page.handlePitch(110, 0.99, true, 1100);
    vi.advanceTimersByTime(420);
    expect(page.trendSamples.map((sample) => sample.capturedAt)).toEqual([1100, 1520]);

    page.handlePitch(110, 0.99, false, 1580);
    expect(page.trendSamples.map((sample) => sample.capturedAt)).toEqual([1100, 1520, 1580]);
  });

  it('重复时间戳不会追加音轨或推迟原有静音判断', async () => {
    const page = await setup();
    page.handlePitch(110, 0.99, true, 1100);
    vi.advanceTimersByTime(100);
    page.handlePitch(196, 0.99, false, 1100);
    vi.advanceTimersByTime(320);
    expect(page.trendSamples.map((sample) => sample.capturedAt)).toEqual([1100, 1520]);
    expect(page.lastReading?.frequencyHz).toBe(110);
  });
});
