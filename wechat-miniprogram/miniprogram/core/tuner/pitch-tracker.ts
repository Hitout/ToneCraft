export interface PitchTrackUpdate {
  readonly frequencyHz: number;
  readonly confidence: number;
  readonly rms: number;
  readonly capturedAt: number;
  readonly startsNewTrack: boolean;
}

export interface PitchTrackerConfig {
  readonly trackingRadiusCents?: number;
  readonly candidateRadiusCents?: number;
  readonly candidateWindowMs?: number;
  readonly highConfidenceAcquisitionMs?: number;
  readonly normalAcquisitionMs?: number;
  readonly smoothingWindowMs?: number;
  readonly smoothingTimeConstantMs?: number;
  readonly silenceResetMs?: number;
}

interface PitchObservation {
  frequencyHz: number;
  confidence: number;
  rms: number;
  capturedAt: number;
}

const DEFAULT_CONFIG = {
  trackingRadiusCents: 45,
  candidateRadiusCents: 60,
  candidateWindowMs: 220,
  highConfidenceAcquisitionMs: 20,
  normalAcquisitionMs: 45,
  smoothingWindowMs: 120,
  smoothingTimeConstantMs: 85,
  silenceResetMs: 350,
};

function centsBetween(frequencyHz: number, targetFrequencyHz: number): number {
  return 1200 * Math.log(frequencyHz / targetFrequencyHz) / Math.LN2;
}

/**
 * 将逐帧 YIN 结果整理成稳定的单音轨迹。
 *
 * 新音需要短暂的候选确认，同一条轨迹只在邻近范围内做中值与 EMA 平滑；
 * 这样可以过滤单帧倍频和环境噪声，又不会在换弦时画出不存在的中间频率。
 */
export class PitchTracker {
  private readonly config: Required<PitchTrackerConfig>;
  private readonly candidateObservations: PitchObservation[] = [];
  private readonly trackingObservations: PitchObservation[] = [];
  private trackedFrequencyHz: number | null = null;
  private lastObservationAt: number | null = null;
  private lastOutputAt: number | null = null;

  constructor(config: PitchTrackerConfig = {}) {
    this.config = {
      trackingRadiusCents: config.trackingRadiusCents ?? DEFAULT_CONFIG.trackingRadiusCents,
      candidateRadiusCents: config.candidateRadiusCents ?? DEFAULT_CONFIG.candidateRadiusCents,
      candidateWindowMs: config.candidateWindowMs ?? DEFAULT_CONFIG.candidateWindowMs,
      highConfidenceAcquisitionMs: config.highConfidenceAcquisitionMs ?? DEFAULT_CONFIG.highConfidenceAcquisitionMs,
      normalAcquisitionMs: config.normalAcquisitionMs ?? DEFAULT_CONFIG.normalAcquisitionMs,
      smoothingWindowMs: config.smoothingWindowMs ?? DEFAULT_CONFIG.smoothingWindowMs,
      smoothingTimeConstantMs: config.smoothingTimeConstantMs ?? DEFAULT_CONFIG.smoothingTimeConstantMs,
      silenceResetMs: config.silenceResetMs ?? DEFAULT_CONFIG.silenceResetMs,
    };
  }

  process(
    frequencyHz: number,
    confidence: number,
    rms: number,
    capturedAt: number,
  ): PitchTrackUpdate | null {
    if (!Number.isFinite(frequencyHz) || frequencyHz <= 0 || !Number.isFinite(capturedAt)) return null;
    const observation: PitchObservation = {
      frequencyHz,
      confidence: Math.max(0, Math.min(1, confidence)),
      rms,
      capturedAt,
    };

    const previousObservationAt = this.lastObservationAt;
    this.lastObservationAt = capturedAt;
    if (
      previousObservationAt !== null &&
      (capturedAt < previousObservationAt || capturedAt - previousObservationAt > this.config.silenceResetMs)
    ) {
      // 长时间没有可信音高时，下一次拨弦必须重新起音，不能沿用旧轨迹平滑。
      this.clearTrackingState();
    }

    if (
      this.trackedFrequencyHz !== null &&
      Math.abs(centsBetween(frequencyHz, this.trackedFrequencyHz)) <= this.config.trackingRadiusCents
    ) {
      return this.updateTrackedPitch(observation);
    }
    return this.tryAcquirePitch(observation);
  }

  reset(): void {
    this.clearTrackingState();
    this.lastObservationAt = null;
  }

  private updateTrackedPitch(observation: PitchObservation): PitchTrackUpdate {
    this.candidateObservations.length = 0;
    this.trackingObservations.push(observation);
    this.removeOlderThan(
      this.trackingObservations,
      observation.capturedAt - this.config.smoothingWindowMs,
    );

    const median = this.medianFrequency(this.trackingObservations);
    const previousOutputAt = this.lastOutputAt;
    const elapsedMs = previousOutputAt === null
      ? this.config.smoothingTimeConstantMs
      : Math.max(0, observation.capturedAt - previousOutputAt);
    const alpha = Math.max(
      0.12,
      Math.min(0.65, 1 - Math.exp(-elapsedMs / this.config.smoothingTimeConstantMs)),
    );
    const trackedFrequencyHz = this.trackedFrequencyHz as number;
    this.trackedFrequencyHz = trackedFrequencyHz + alpha * (median - trackedFrequencyHz);
    this.lastOutputAt = observation.capturedAt;
    return this.buildUpdate(observation, false);
  }

  private tryAcquirePitch(observation: PitchObservation): PitchTrackUpdate | null {
    this.candidateObservations.push(observation);
    this.removeOlderThan(
      this.candidateObservations,
      observation.capturedAt - this.config.candidateWindowMs,
    );

    const cluster: PitchObservation[] = [];
    for (const candidate of this.candidateObservations) {
      if (
        Math.abs(centsBetween(candidate.frequencyHz, observation.frequencyHz)) <=
        this.config.candidateRadiusCents
      ) {
        cluster.push(candidate);
      }
    }
    if (cluster.length < 2) return null;

    let firstAt = cluster[0].capturedAt;
    let confidenceTotal = 0;
    for (const item of cluster) {
      firstAt = Math.min(firstAt, item.capturedAt);
      confidenceTotal += item.confidence;
    }
    const averageConfidence = confidenceTotal / cluster.length;
    const highConfidence = averageConfidence >= 0.85;
    const requiredDuration = highConfidence
      ? this.config.highConfidenceAcquisitionMs
      : this.config.normalAcquisitionMs;
    const requiredEvidence = highConfidence ? 2 : 3;
    if (
      cluster.length < requiredEvidence ||
      observation.capturedAt - firstAt < requiredDuration
    ) {
      return null;
    }

    this.trackedFrequencyHz = this.medianFrequency(cluster);
    this.trackingObservations.length = 0;
    for (const item of cluster) this.trackingObservations.push(item);
    this.candidateObservations.length = 0;
    this.lastOutputAt = observation.capturedAt;
    return this.buildUpdate(observation, true);
  }

  private buildUpdate(observation: PitchObservation, startsNewTrack: boolean): PitchTrackUpdate {
    return {
      frequencyHz: this.trackedFrequencyHz as number,
      confidence: observation.confidence,
      rms: observation.rms,
      capturedAt: observation.capturedAt,
      startsNewTrack,
    };
  }

  private removeOlderThan(observations: PitchObservation[], cutoff: number): void {
    let firstValid = 0;
    while (firstValid < observations.length && observations[firstValid].capturedAt < cutoff) {
      firstValid++;
    }
    if (firstValid > 0) observations.splice(0, firstValid);
  }

  private medianFrequency(observations: PitchObservation[]): number {
    const frequencies: number[] = [];
    for (const observation of observations) frequencies.push(observation.frequencyHz);
    frequencies.sort((left, right) => left - right);
    const middle = Math.floor(frequencies.length / 2);
    if (frequencies.length % 2 === 1) return frequencies[middle];
    return (frequencies[middle - 1] + frequencies[middle]) / 2;
  }

  private clearTrackingState(): void {
    this.candidateObservations.length = 0;
    this.trackingObservations.length = 0;
    this.trackedFrequencyHz = null;
    this.lastOutputAt = null;
  }
}
