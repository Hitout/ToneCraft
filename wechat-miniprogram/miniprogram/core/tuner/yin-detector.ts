export interface PitchDetection {
  readonly frequencyHz: number;
  readonly confidence: number;
  readonly rms: number;
}

// 允许带中等底噪的真实琴弦声进入追踪，再由跨帧候选确认过滤随机噪声。
const YIN_THRESHOLD = 0.20;
const MINIMUM_FREQUENCY_HZ = 32;
const MAXIMUM_FREQUENCY_HZ = 1200;
const MINIMUM_RMS = 0.0025;
// 8192 点 FFT 共 13 层；每次定时回调执行完整变换，避免 iOS 定时器逐层增加延迟。
const FFT_STAGES_PER_BATCH = 13;

interface PreparedDetection {
  readonly centered: Float32Array;
  readonly rms: number;
  readonly minimumTau: number;
  readonly maximumTau: number;
}

/**
 * 在固定 PCM 窗口上执行 YIN 自相关检测。
 *
 * 下限覆盖降 D 贝斯的约 37Hz；先去除直流偏置，再用能量门限和置信度过滤
 * 静音、低能量噪声与低置信度倍频结果，避免表盘在环境噪音下频繁跳动。
 */
export function detectPitch(samples: Float32Array, sampleRate: number): PitchDetection | null {
  const prepared = prepareDetection(samples, sampleRate);
  if (prepared === null) return null;

  const yin = new Float32Array(prepared.maximumTau + 1);
  fillYinRange(prepared.centered, yin, 1, prepared.maximumTau, 0);
  return finishDetection(yin, prepared.rms, sampleRate, prepared.minimumTau, prepared.maximumTau);
}

/**
 * 通过 FFT 自相关计算 YIN 差分，并在变换阶段之间让出小程序 JS 线程。
 * 该计算与逐点差分使用相同的能量恒等式，避免低频窗口的平方级循环。
 */
export function detectPitchAsync(samples: Float32Array, sampleRate: number): Promise<PitchDetection | null> {
  const prepared = prepareDetection(samples, sampleRate);
  if (prepared === null) return Promise.resolve(null);

  return calculateYinAsync(prepared.centered, prepared.maximumTau).then((yin) => finishDetection(
    yin,
    prepared.rms,
    sampleRate,
    prepared.minimumTau,
    prepared.maximumTau,
  ));
}

function prepareDetection(samples: Float32Array, sampleRate: number): PreparedDetection | null {
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

  return { centered, rms, minimumTau, maximumTau };
}

function fillYinRange(
  centered: Float32Array,
  yin: Float32Array,
  firstTau: number,
  finalTau: number,
  initialRunningSum: number,
): number {
  let runningSum = initialRunningSum;
  for (let tau = firstTau; tau <= finalTau; tau++) {
    let difference = 0;
    for (let index = 0; index + tau < centered.length; index++) {
      const delta = centered[index] - centered[index + tau];
      difference += delta * delta;
    }
    runningSum += difference;
    yin[tau] = runningSum === 0 ? 1 : difference * tau / runningSum;
  }
  return runningSum;
}

function calculateYinAsync(centered: Float32Array, maximumTau: number): Promise<Float32Array> {
  let fftSize = 1;
  while (fftSize < centered.length * 2) fftSize *= 2;

  const real = new Float64Array(fftSize);
  const imaginary = new Float64Array(fftSize);
  const energyPrefix = new Float64Array(centered.length + 1);
  for (let index = 0; index < centered.length; index++) {
    real[index] = centered[index];
    energyPrefix[index + 1] = energyPrefix[index] + centered[index] * centered[index];
  }

  return transformAsync(real, imaginary, false)
    .then(() => {
      for (let index = 0; index < fftSize; index++) {
        real[index] = real[index] * real[index] + imaginary[index] * imaginary[index];
        imaginary[index] = 0;
      }
      return transformAsync(real, imaginary, true);
    })
    .then(() => {
      const yin = new Float32Array(maximumTau + 1);
      let runningSum = 0;
      for (let tau = 1; tau <= maximumTau; tau++) {
        const firstEnergy = energyPrefix[centered.length - tau];
        const secondEnergy = energyPrefix[centered.length] - energyPrefix[tau];
        const difference = Math.max(0, firstEnergy + secondEnergy - 2 * real[tau]);
        runningSum += difference;
        yin[tau] = runningSum === 0 ? 1 : difference * tau / runningSum;
      }
      return yin;
    });
}

function transformAsync(real: Float64Array, imaginary: Float64Array, inverse: boolean): Promise<void> {
  const size = real.length;
  let reversed = 0;
  for (let index = 1; index < size; index++) {
    let bit = size >> 1;
    while ((reversed & bit) !== 0) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      const realValue = real[index];
      real[index] = real[reversed];
      real[reversed] = realValue;
      const imaginaryValue = imaginary[index];
      imaginary[index] = imaginary[reversed];
      imaginary[reversed] = imaginaryValue;
    }
  }

  return new Promise((resolve) => {
    let stageLength = 2;
    const processStages = (): void => {
      for (let batchIndex = 0; batchIndex < FFT_STAGES_PER_BATCH && stageLength <= size; batchIndex++) {
        applyFftStage(real, imaginary, size, stageLength, inverse);
        stageLength *= 2;
      }

      if (stageLength <= size) {
        setTimeout(processStages, 0);
        return;
      }

      if (inverse) {
        for (let index = 0; index < size; index++) {
          real[index] /= size;
          imaginary[index] /= size;
        }
      }
      resolve();
    };

    setTimeout(processStages, 0);
  });
}

function applyFftStage(
  real: Float64Array,
  imaginary: Float64Array,
  size: number,
  stageLength: number,
  inverse: boolean,
): void {
  const halfLength = stageLength / 2;
  const angle = (inverse ? 2 : -2) * Math.PI / stageLength;
  const rootReal = Math.cos(angle);
  const rootImaginary = Math.sin(angle);

  for (let blockStart = 0; blockStart < size; blockStart += stageLength) {
    let twiddleReal = 1;
    let twiddleImaginary = 0;
    for (let offset = 0; offset < halfLength; offset++) {
      const evenIndex = blockStart + offset;
      const oddIndex = evenIndex + halfLength;
      const oddReal = real[oddIndex] * twiddleReal - imaginary[oddIndex] * twiddleImaginary;
      const oddImaginary = real[oddIndex] * twiddleImaginary + imaginary[oddIndex] * twiddleReal;
      const evenReal = real[evenIndex];
      const evenImaginary = imaginary[evenIndex];
      real[evenIndex] = evenReal + oddReal;
      imaginary[evenIndex] = evenImaginary + oddImaginary;
      real[oddIndex] = evenReal - oddReal;
      imaginary[oddIndex] = evenImaginary - oddImaginary;

      const nextTwiddleReal = twiddleReal * rootReal - twiddleImaginary * rootImaginary;
      twiddleImaginary = twiddleReal * rootImaginary + twiddleImaginary * rootReal;
      twiddleReal = nextTwiddleReal;
    }
  }
}

function finishDetection(
  yin: Float32Array,
  rms: number,
  sampleRate: number,
  minimumTau: number,
  maximumTau: number,
): PitchDetection | null {
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
