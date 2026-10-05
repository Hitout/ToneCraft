export interface PitchDetection {
  readonly frequencyHz: number;
  readonly confidence: number;
  readonly rms: number;
}

const YIN_THRESHOLD = 0.12;
const MINIMUM_FREQUENCY_HZ = 32;
const MAXIMUM_FREQUENCY_HZ = 1200;
const MINIMUM_RMS = 0.0025;

/**
 * 在固定 PCM 窗口上执行 YIN 自相关检测。
 *
 * 下限覆盖降 D 贝斯的约 37Hz；先去除直流偏置，再用能量门限和置信度过滤
 * 静音、低能量噪声与低置信度倍频结果，避免表盘在环境噪音下频繁跳动。
 */
export function detectPitch(samples: Float32Array, sampleRate: number): PitchDetection | null {
  if (samples.length < 1024 || sampleRate <= 0) return null;
  let mean = 0;
  for (let index = 0; index < samples.length; index++) mean += samples[index];
  mean /= samples.length;

  const centered = new Float32Array(samples.length);
  let energy = 0;
  for (let index = 0; index < samples.length; index++) {
    const value = samples[index] - mean;
    centered[index] = value;
    energy += value * value;
  }
  const rms = Math.sqrt(energy / samples.length);
  if (rms < MINIMUM_RMS) return null;

  const minimumTau = Math.max(2, Math.floor(sampleRate / MAXIMUM_FREQUENCY_HZ));
  const maximumTau = Math.min(
    Math.floor(sampleRate / MINIMUM_FREQUENCY_HZ),
    Math.floor(samples.length / 2),
  );
  if (maximumTau <= minimumTau) return null;

  const yin = new Float32Array(maximumTau + 1);
  let runningSum = 0;
  for (let tau = 1; tau <= maximumTau; tau++) {
    let difference = 0;
    for (let index = 0; index + tau < centered.length; index++) {
      const delta = centered[index] - centered[index + tau];
      difference += delta * delta;
    }
    runningSum += difference;
    yin[tau] = runningSum === 0 ? 1 : difference * tau / runningSum;
  }

  let tauEstimate = -1;
  for (let tau = minimumTau; tau < maximumTau; tau++) {
    if (yin[tau] < YIN_THRESHOLD) {
      tauEstimate = tau;
      while (tauEstimate + 1 < maximumTau && yin[tauEstimate + 1] < yin[tauEstimate]) {
        tauEstimate++;
      }
      break;
    }
  }
  if (tauEstimate < 0) return null;

  const left = yin[Math.max(1, tauEstimate - 1)];
  const center = yin[tauEstimate];
  const right = yin[Math.min(maximumTau, tauEstimate + 1)];
  const denominator = 2 * (2 * center - left - right);
  const adjustment = Math.abs(denominator) > 1e-8 ? (right - left) / denominator : 0;
  const refinedTau = tauEstimate + Math.max(-1, Math.min(1, adjustment));
  const frequencyHz = sampleRate / refinedTau;
  if (!Number.isFinite(frequencyHz) || frequencyHz < MINIMUM_FREQUENCY_HZ || frequencyHz > MAXIMUM_FREQUENCY_HZ) {
    return null;
  }

  const confidence = Math.max(0, Math.min(1, 1 - center));
  if (confidence < 0.55) return null;

  return {
    frequencyHz,
    confidence,
    rms,
  };
}
