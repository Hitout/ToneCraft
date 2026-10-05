import { describe, expect, it } from 'vitest';
import { ClickSynthesizer } from '../../miniprogram/platform/web-audio/click-synthesizer';

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

describe('ClickSynthesizer', () => {
  it('按实际音频采样率生成五种音色和三档强度', () => {
    const context = {
      sampleRate: 48000,
      createBuffer: (channels: number, length: number, sampleRate: number) =>
        new FakeAudioBuffer(length, sampleRate),
    } as unknown as WechatMiniprogram.WebAudioContext;
    const synthesizer = new ClickSynthesizer(context);
    synthesizer.render();

    for (const sound of ['mechanical', 'electronic', 'drums', 'cowbell', 'clapper'] as const) {
      for (const strength of ['accent', 'secondary', 'normal'] as const) {
        const buffer = synthesizer.get(sound, strength);
        expect(buffer).not.toBeNull();
        expect(buffer?.sampleRate).toBe(48000);
        expect(Array.from(buffer?.getChannelData(0) ?? []).every(Number.isFinite)).toBe(true);
      }
    }
    expect(synthesizer.get('mechanical', 'muted')).toBeNull();
  });

  it('保留五种音色已经确认的包络时长和边界采样', () => {
    const context = {
      sampleRate: 48000,
      createBuffer: (channels: number, length: number, sampleRate: number) =>
        new FakeAudioBuffer(length, sampleRate),
    } as unknown as WechatMiniprogram.WebAudioContext;
    const synthesizer = new ClickSynthesizer(context);
    synthesizer.render();

    const expectedSeconds = {
      mechanical: { accent: 0.023, secondary: 0.026, normal: 0.022 },
      electronic: { accent: 0.024, secondary: 0.027, normal: 0.029 },
      drums: { accent: 0.135, secondary: 0.072, normal: 0.043 },
      cowbell: { accent: 0.068, secondary: 0.061, normal: 0.055 },
      clapper: { accent: 0.039, secondary: 0.039, normal: 0.039 },
    } as const;
    for (const sound of Object.keys(expectedSeconds) as Array<keyof typeof expectedSeconds>) {
      for (const strength of ['accent', 'secondary', 'normal'] as const) {
        const buffer = synthesizer.get(sound, strength);
        expect(buffer?.length).toBe(Math.round(expectedSeconds[sound][strength] * 48000));
        const data = buffer?.getChannelData(0) ?? new Float32Array();
        expect(data[0]).toBe(0);
        expect(data[data.length - 1]).toBe(0);
      }
    }
  });

  it('三档强度保持重音大于次重音、次重音大于普通拍', () => {
    const context = {
      sampleRate: 48000,
      createBuffer: (channels: number, length: number, sampleRate: number) =>
        new FakeAudioBuffer(length, sampleRate),
    } as unknown as WechatMiniprogram.WebAudioContext;
    const synthesizer = new ClickSynthesizer(context);
    synthesizer.render();

    for (const sound of ['mechanical', 'electronic', 'drums', 'cowbell', 'clapper'] as const) {
      const peak = (strength: 'accent' | 'secondary' | 'normal') => {
        const data = synthesizer.get(sound, strength)?.getChannelData(0) ?? [];
        return Math.max(...Array.from(data, (sample) => Math.abs(sample)));
      };
      expect(peak('accent')).toBeGreaterThan(peak('secondary'));
      expect(peak('secondary')).toBeGreaterThan(peak('normal'));
    }
  });
});
