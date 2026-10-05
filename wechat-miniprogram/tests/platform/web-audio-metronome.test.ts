import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizedConfig } from '../../miniprogram/core/metronome/metronome-config';
import {
  ScheduledBeatEvent,
  WebAudioMetronome,
} from '../../miniprogram/platform/web-audio/web-audio-metronome';

class FakeAudioBuffer {
  readonly duration: number;
  readonly length: number;
  readonly sampleRate: number;
  readonly numberOfChannels = 1;
  private readonly channel: Float32Array;

  constructor(length: number, sampleRate: number) {
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channel = new Float32Array(length);
  }

  getChannelData(): Float32Array {
    return this.channel;
  }
}

class FakeBufferSource {
  buffer!: WechatMiniprogram.AudioBuffer;
  onended: (() => void) | null = null;
  readonly starts: number[] = [];
  stopCount = 0;

  connect(): void {}

  start(when: number): void {
    this.starts.push(when);
  }

  stop(): void {
    this.stopCount += 1;
    this.onended?.();
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('WebAudioMetronome', () => {
  it('把节拍提前排入音频时钟，并清理倒计时缩短后的视觉回调', async () => {
    vi.useFakeTimers();
    const sources: FakeBufferSource[] = [];
    const context = {
      state: 'suspended',
      currentTime: 0,
      sampleRate: 48000,
      destination: {},
      onstatechange: null,
      resume: vi.fn(async () => {
        context.state = 'running';
      }),
      close: vi.fn(async () => {
        context.state = 'closed';
      }),
      createBuffer: (_channels: number, length: number, sampleRate: number) =>
        new FakeAudioBuffer(length, sampleRate),
      createBufferSource: () => {
        const source = new FakeBufferSource();
        sources.push(source);
        return source;
      },
    } as unknown as WechatMiniprogram.WebAudioContext & { state: string };
    vi.stubGlobal('wx', {
      createWebAudioContext: () => context,
    });

    const beats: ScheduledBeatEvent[] = [];
    const audio = new WebAudioMetronome({ onBeat: (event) => beats.push(event) });
    await audio.start(normalizedConfig({ bpm: 120 }));

    expect(context.resume).toHaveBeenCalledTimes(1);
    expect(sources[0]?.starts[0]).toBeCloseTo(0.08);

    // 第一拍尚未到达时缩短倒计时，音频节点和对应的 UI 回调都应被取消。
    audio.update(normalizedConfig({ bpm: 120 }), 0.05);
    vi.advanceTimersByTime(100);

    expect(sources[0]?.stopCount).toBe(1);
    expect(beats).toHaveLength(0);
    audio.stop();
  });

  it('音频上下文被系统挂起时清理调度会话并报告中断', async () => {
    vi.useFakeTimers();
    const sources: FakeBufferSource[] = [];
    const context = {
      state: 'running',
      currentTime: 0,
      sampleRate: 48000,
      destination: {},
      onstatechange: null,
      resume: vi.fn(async () => {}),
      close: vi.fn(async () => {
        context.state = 'closed';
      }),
      createBuffer: (_channels: number, length: number, sampleRate: number) =>
        new FakeAudioBuffer(length, sampleRate),
      createBufferSource: () => {
        const source = new FakeBufferSource();
        sources.push(source);
        return source;
      },
    } as unknown as WechatMiniprogram.WebAudioContext & { state: string };
    vi.stubGlobal('wx', { createWebAudioContext: () => context });

    const statuses: string[] = [];
    const audio = new WebAudioMetronome({ onStatus: (status) => statuses.push(status) });
    await audio.start(normalizedConfig({ bpm: 120 }));
    expect(audio.isPlaying).toBe(true);

    context.state = 'suspended';
    (context.onstatechange as (() => void) | null)?.();

    expect(audio.isPlaying).toBe(false);
    expect(statuses).toEqual(['playing', 'interrupted']);
    expect(sources.some((source) => source.stopCount > 0)).toBe(true);
    audio.dispose();
  });

  it('等待恢复期间停止时，旧启动不会在恢复后重新激活', async () => {
    vi.useFakeTimers();
    const resumeResolvers: Array<() => void> = [];
    const context = {
      state: 'suspended',
      currentTime: 0,
      sampleRate: 48000,
      destination: {},
      onstatechange: null,
      resume: vi.fn(() => new Promise<void>((resolve) => resumeResolvers.push(resolve))),
      close: vi.fn(async () => {
        context.state = 'closed';
      }),
      createBuffer: (_channels: number, length: number, sampleRate: number) =>
        new FakeAudioBuffer(length, sampleRate),
      createBufferSource: () => new FakeBufferSource(),
    } as unknown as WechatMiniprogram.WebAudioContext & { state: string };
    vi.stubGlobal('wx', { createWebAudioContext: () => context });

    const audio = new WebAudioMetronome();
    const startPromise = audio.start(normalizedConfig({ bpm: 120 }));
    audio.stop();
    context.state = 'running';
    resumeResolvers[0]?.();
    await startPromise;

    expect(audio.isPlaying).toBe(false);
    audio.dispose();
  });
});
