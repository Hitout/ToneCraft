import { describe, expect, it } from 'vitest';

import {
  centsBetween,
  mapFrequency,
  readingColor,
  targetFromMidi,
  tuningPreset,
} from '../../miniprogram/core/tuner/tuning';
import { PitchTracker } from '../../miniprogram/core/tuner/pitch-tracker';
import { detectPitch } from '../../miniprogram/core/tuner/yin-detector';

function sineWave(frequencyHz: number, sampleRate: number, size: number): Float32Array {
  const samples = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    samples[index] = Math.sin((2 * Math.PI * frequencyHz * index) / sampleRate) * 0.35;
  }
  return samples;
}

function harmonicWave(frequencyHz: number, sampleRate: number, size: number): Float32Array {
  const samples = new Float32Array(size);
  for (let index = 0; index < size; index++) {
    const phase = (2 * Math.PI * frequencyHz * index) / sampleRate;
    samples[index] =
      Math.sin(phase) * 0.55 +
      Math.sin(phase * 2) * 0.32 +
      Math.sin(phase * 3) * 0.18;
  }
  return samples;
}

describe('调音器音高映射', () => {
  it('按十二平均律计算目标频率与音分偏差', () => {
    expect(targetFromMidi(69).frequencyHz).toBeCloseTo(440);
    expect(centsBetween(440 * 2 ** (25 / 1200), 440)).toBeCloseTo(25);
  });

  it('自动模式选择音分距离最近的目标弦', () => {
    const preset = tuningPreset('standard');
    const reading = mapFrequency(110, 0.9, preset);
    expect(reading.noteName).toBe('A');
    expect(reading.octave).toBe(2);
    expect(reading.targetIndex).toBe(1);
    expect(reading.cents).toBeCloseTo(0);
  });

  it('手动模式始终锁定用户选中的弦', () => {
    const preset = tuningPreset('standard');
    const reading = mapFrequency(110, 0.9, preset, 0);
    expect(reading.targetIndex).toBe(0);
    expect(reading.cents).toBe(50);
  });

  it('状态色按参考 APP 的绿橙红连续渐变', () => {
    expect(readingColor(0)).toBe('#72e85c');
    expect(readingColor(50)).toBe('#fe0301');
    expect(readingColor(-20)).toBe(readingColor(20));
  });
});

describe('YIN 音高检测', () => {
  it('从标准 A4 PCM 窗口中识别稳定音高', () => {
    const detected = detectPitch(sineWave(440, 48000, 4096), 48000);
    expect(detected).not.toBeNull();
    expect(detected?.frequencyHz).toBeCloseTo(440, 0);
    expect(detected?.confidence).toBeGreaterThan(0.8);
  });

  it('静音窗口不产生错误读数', () => {
    expect(detectPitch(new Float32Array(4096), 48000)).toBeNull();
  });

  it('可以识别轻拨和带泛音的琴弦', () => {
    const quiet = sineWave(329.63, 48000, 4096);
    for (let index = 0; index < quiet.length; index++) quiet[index] *= 0.004 / 0.35;
    const quietReading = detectPitch(quiet, 48000);
    expect(quietReading).not.toBeNull();
    expect(quietReading?.frequencyHz).toBeCloseTo(329.63, 0);

    const harmonicReading = detectPitch(harmonicWave(110, 48000, 4096), 48000);
    expect(harmonicReading).not.toBeNull();
    expect(harmonicReading?.frequencyHz).toBeCloseTo(110, 0);
  });
});

describe('调音器音高追踪', () => {
  it('新音需要短暂确认，同一轨迹才做平滑', () => {
    const tracker = new PitchTracker();
    expect(tracker.process(110, 0.92, 0.05, 0)).toBeNull();
    expect(tracker.process(110.1, 0.92, 0.05, 8)).toBeNull();
    const acquired = tracker.process(109.9, 0.92, 0.05, 25);
    expect(acquired).not.toBeNull();
    expect(acquired?.startsNewTrack).toBe(true);

    const tracked = tracker.process(109.8, 0.92, 0.05, 50);
    expect(tracked).not.toBeNull();
    expect(tracked?.startsNewTrack).toBe(false);
    expect(tracked?.frequencyHz).toBeCloseTo(110, 1);
  });

  it('静音后重新起音不会沿用旧轨迹', () => {
    const tracker = new PitchTracker();
    tracker.process(110, 0.92, 0.05, 0);
    expect(tracker.process(110, 0.92, 0.05, 25)).not.toBeNull();
    expect(tracker.process(659.25, 0.92, 0.05, 500)).toBeNull();
    const violin = tracker.process(659.4, 0.92, 0.05, 525);
    expect(violin).not.toBeNull();
    expect(violin?.startsNewTrack).toBe(true);
  });
});
