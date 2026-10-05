import { clampInt, MAXIMUM_BPM, MINIMUM_BPM } from './metronome-config';

/**
 * Tap Tempo 只保存最近几次点击的单调时间，避免把偶发的长停顿带入平均值。
 * 时间计算与页面事件解耦，便于使用假时钟做边界测试。
 */
export class TapTempoTracker {
  private readonly taps: number[] = [];

  addTap(elapsedMilliseconds: number): number | null {
    const previous = this.taps[this.taps.length - 1];
    if (previous !== undefined && elapsedMilliseconds - previous > 2000) {
      this.taps.length = 0;
    }
    this.taps.push(elapsedMilliseconds);
    if (this.taps.length > 5) this.taps.shift();
    if (this.taps.length < 2) return null;

    let total = 0;
    for (let index = 1; index < this.taps.length; index += 1) {
      total += this.taps[index] - this.taps[index - 1];
    }
    const average = total / (this.taps.length - 1);
    return clampInt(60000 / average, MINIMUM_BPM, MAXIMUM_BPM);
  }

  reset(): void {
    this.taps.length = 0;
  }
}
