import {
  BeatStrength,
  MetronomeConfig,
  isRestAt,
  normalizedConfig,
  numerator,
  partsPerBeat,
  subdivisionDurationSeconds,
  subdivisionForBeat,
} from './metronome-config';

export interface MetronomeTick {
  readonly at: number;
  readonly beatIndex: number;
  readonly subdivisionIndex: number;
  readonly strength: BeatStrength;
  readonly audible: boolean;
  readonly config: MetronomeConfig;
}

/**
 * 以音频时钟为唯一时间轴。
 *
 * BPM、音色和强弱属于当前拍点的即时属性；拍号、统一细分和逐拍细分属于小节结构，
 * 必须等当前小节结束后再提交，避免半小节混用节拍结构。
 */
export class MetronomeTimeline {
  private config: MetronomeConfig = normalizedConfig({});
  private pendingConfig: MetronomeConfig | null = null;
  private previousAt = 0;
  private nextAt = 0;
  private beatIndex = 0;
  private subdivisionIndex = 0;
  private started = false;

  reset(startAt: number, config: MetronomeConfig): void {
    this.config = normalizedConfig(config);
    this.pendingConfig = null;
    this.previousAt = startAt;
    this.nextAt = startAt;
    this.beatIndex = 0;
    this.subdivisionIndex = 0;
    this.started = true;
  }

  queueConfig(config: MetronomeConfig, currentTime?: number): void {
    const pending = normalizedConfig(config);
    if (!this.started) {
      this.config = pending;
      return;
    }

    const bpmChanged = pending.bpm !== this.config.bpm;
    const structureChanged = pending.timeSignature !== this.config.timeSignature ||
      pending.subdivision !== this.config.subdivision ||
      pending.customSubdivisionEnabled !== this.config.customSubdivisionEnabled ||
      pending.beatSubdivisions.length !== this.config.beatSubdivisions.length ||
      pending.beatSubdivisions.some(
        (subdivision, index) => subdivision !== this.config.beatSubdivisions[index],
      );
    const canApplyStrengthsImmediately =
      pending.beatStrengths.length === this.config.beatStrengths.length;
    // 强弱长度与当前拍号一致时立即进入活动快照；拍号和细分保留到小节边界切换。
    this.config = {
      ...this.config,
      bpm: pending.bpm,
      sound: pending.sound,
      timerMinutes: pending.timerMinutes,
      ...(canApplyStrengthsImmediately ? { beatStrengths: pending.beatStrengths } : {}),
    };
    this.pendingConfig = structureChanged || !canApplyStrengthsImmediately ? pending : null;

    if (
      !bpmChanged ||
      currentTime === undefined ||
      !Number.isFinite(currentTime) ||
      this.nextAt <= currentTime
    ) {
      return;
    }
    // BPM 改变时保持当前细分内的相位，只重算下一拍的剩余距离；这样拖动
    // 旋钮不会把下一拍突然拉回一个完整间隔，也不会积累每次取整误差。
    const oldSpan = this.nextAt - this.previousAt;
    if (oldSpan <= 1e-9) return;
    const elapsed = Math.min(oldSpan, Math.max(0, currentTime - this.previousAt));
    const remainingRatio = 1 - elapsed / oldSpan;
    const interval = subdivisionDurationSeconds(this.config, this.beatIndex);
    this.previousAt = currentTime - interval * (1 - remainingRatio);
    this.nextAt = currentTime + interval * remainingRatio;
  }

  discardBefore(time: number): void {
    // JS 调度器长时间被系统挂起时，过期拍点不能被一次性“补播”；音频时钟只应继续
    // 从当前未来窗口排程，否则会出现连续重音。丢弃时仍推进拍号，保持下一拍位置正确。
    while (this.nextAt < time) {
      this.advanceTimeline();
    }
  }

  collect(until: number): MetronomeTick[] {
    const ticks: MetronomeTick[] = [];
    while (this.nextAt < until) {
      const config = this.config;
      const subdivision = subdivisionForBeat(config, this.beatIndex);
      const strength =
        this.subdivisionIndex === 0
          ? config.beatStrengths[this.beatIndex] ?? 'normal'
          : 'normal';
      ticks.push({
        at: this.nextAt,
        beatIndex: this.beatIndex,
        subdivisionIndex: this.subdivisionIndex,
        strength,
        audible: !isRestAt(subdivision, this.subdivisionIndex) && strength !== 'muted',
        config,
      });

      this.advanceTimeline();
    }
    return ticks;
  }

  private advance(): void {
    this.subdivisionIndex += 1;
    if (
      this.subdivisionIndex >=
      partsPerBeat(subdivisionForBeat(this.config, this.beatIndex))
    ) {
      this.subdivisionIndex = 0;
      this.beatIndex = (this.beatIndex + 1) % numerator(this.config.timeSignature);
    }
  }

  private advanceTimeline(): void {
    const currentAt = this.nextAt;
    // 下一拍之前的间隔属于当前拍，即使当前拍是该小节最后一拍，也不能提前
    // 使用下一小节或下一拍的细分数量。
    const interval = subdivisionDurationSeconds(this.config, this.beatIndex);
    this.advance();
    this.applyPendingAtBarBoundary();
    this.previousAt = currentAt;
    this.nextAt = currentAt + interval;
  }

  private applyPendingAtBarBoundary(): void {
    if (
      this.pendingConfig !== null &&
      this.beatIndex === 0 &&
      this.subdivisionIndex === 0
    ) {
      this.config = this.pendingConfig;
      this.pendingConfig = null;
    }
  }
}
