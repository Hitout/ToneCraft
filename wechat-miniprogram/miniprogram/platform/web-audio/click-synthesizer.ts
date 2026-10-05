import {
  BeatStrength,
  MetronomeSound,
} from '../../core/metronome/metronome-config';

type AudioContextLike = WechatMiniprogram.WebAudioContext;
type AudioBufferLike = WechatMiniprogram.AudioBuffer;

interface Mode {
  frequency: number;
  gain: number;
  decay: number;
}

interface Impulse {
  time: number;
  gain: number;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

const TAU = Math.PI * 2;
const OUTPUT_GAIN = 0.5;
const RENDER_STRENGTHS: readonly BeatStrength[] = [
  'accent',
  'secondary',
  'normal',
];

/**
 * 在播放开始前按音频上下文的实际采样率生成所有音色。
 * 播放过程中只读取 AudioBuffer，不做振荡、滤波或内存分配，避免调度线程
 * 把 CPU 峰值和垃圾回收抖动带入节拍时钟。
 */
export class ClickSynthesizer {
  private readonly buffers = new Map<string, AudioBufferLike>();
  private renderedSampleRate: number | null = null;

  constructor(private readonly context: AudioContextLike) {}

  render(): void {
    if (this.renderedSampleRate === this.context.sampleRate && this.buffers.size > 0) return;
    this.buffers.clear();
    for (const sound of [
      'mechanical',
      'electronic',
      'drums',
      'cowbell',
      'clapper',
    ] as const) {
      for (const strength of RENDER_STRENGTHS) {
        const samples = this.synthesize(sound, strength);
        const buffer = this.context.createBuffer(
          1,
          samples.length,
          this.context.sampleRate,
        );
        buffer.getChannelData(0).set(samples);
        this.buffers.set(this.key(sound, strength), buffer);
      }
    }
    this.renderedSampleRate = this.context.sampleRate;
  }

  get(sound: MetronomeSound, strength: BeatStrength): AudioBufferLike | null {
    if (strength === 'muted') return null;
    return this.buffers.get(this.key(sound, strength)) ?? null;
  }

  private key(sound: MetronomeSound, strength: BeatStrength): string {
    return `${sound}:${strength}`;
  }

  private synthesize(sound: MetronomeSound, strength: BeatStrength): Float32Array {
    switch (sound) {
      case 'mechanical':
        return this.finalize(
          this.modalStrike(
            strength === 'accent'
              ? 0.023
              : strength === 'secondary'
                ? 0.026
                : 0.022,
            strength === 'accent'
              ? [
                  [2320, 1, 0.0038],
                  [3680, 0.42, 0.003],
                  [5020, 0.16, 0.0017],
                ]
              : strength === 'secondary'
                ? [
                    [1280, 1, 0.0075],
                    [1990, 0.38, 0.0055],
                    [2860, 0.13, 0.003],
                  ]
                : [
                    [1780, 1, 0.0055],
                    [2710, 0.32, 0.0042],
                    [3890, 0.11, 0.0022],
                  ],
            [
              [0, 1],
              [0.00032, -0.16],
            ],
          ),
          strength,
        );
      case 'electronic':
        return this.finalize(this.electronic(strength), strength);
      case 'drums':
        return this.finalize(this.drums(strength), strength);
      case 'cowbell':
        return this.finalize(this.cowbell(strength), strength);
      case 'clapper':
        return this.finalize(
          this.modalStrike(
            0.039,
            (() => {
              const base = strength === 'accent'
                ? 1420
                : strength === 'secondary'
                  ? 1120
                  : 880;
              return [
                [base, 1, 0.0063],
                [base * 1.59, 0.48, 0.0051],
                [base * 2.13, 0.22, 0.004],
                [base * 3.37, 0.08, 0.0021],
              ] as const;
            })(),
            [
              [0, 1],
              [0.00115, -0.34],
              [0.00265, 0.22],
            ],
          ),
          strength,
        );
    }
  }

  private modalStrike(
    duration: number,
    modeValues: readonly (readonly [number, number, number])[],
    impulseValues: readonly (readonly [number, number])[],
  ): Float32Array {
    const sampleRate = this.context.sampleRate;
    const samples = new Float32Array(Math.max(1, Math.round(duration * sampleRate)));
    const modes: Mode[] = modeValues.map(([frequency, gain, decay]) => ({
      frequency,
      gain,
      decay,
    }));
    const impulses: Impulse[] = impulseValues.map(([time, gain]) => ({ time, gain }));
    for (let index = 0; index < samples.length; index += 1) {
      const time = index / sampleRate;
      let value = 0;
      for (const impulse of impulses) {
        const localTime = time - impulse.time;
        if (localTime < 0) continue;
        for (const mode of modes) {
          value += impulse.gain * mode.gain * Math.sin(TAU * mode.frequency * localTime)
            * Math.exp(-localTime / mode.decay);
        }
      }
      samples[index] = value;
    }
    return samples;
  }

  private electronic(strength: BeatStrength): Float32Array {
    const sampleRate = this.context.sampleRate;
    const base = strength === 'accent' ? 2050 : strength === 'secondary' ? 1490 : 1050;
    const duration = strength === 'accent' ? 0.024 : strength === 'secondary' ? 0.027 : 0.029;
    const samples = new Float32Array(Math.round(duration * sampleRate));
    let phase = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const time = index / sampleRate;
      const frequency = base * (1 + 0.13 * Math.exp(-time / 0.003));
      phase += TAU * frequency / sampleRate;
      const attack = 1 - Math.exp(-time / 0.00018);
      const decay = Math.exp(-time / 0.0062);
      samples[index] = attack * decay
        * (Math.sin(phase) + 0.18 * Math.sin(2 * phase + 0.25));
    }
    return this.biquad(
      samples,
      this.bandPass(base * 1.08, 1.15),
    );
  }

  private drums(strength: BeatStrength): Float32Array {
    if (strength === 'accent') {
      const kick = this.kick();
      const hat = this.closedHat();
      for (let index = 0; index < hat.length; index += 1) kick[index] += 0.42 * hat[index];
      return kick;
    }
    if (strength === 'secondary') {
      const snare = this.snare();
      const hat = this.closedHat();
      for (let index = 0; index < hat.length; index += 1) snare[index] += 0.32 * hat[index];
      return snare;
    }
    return this.closedHat();
  }

  private kick(): Float32Array {
    const sampleRate = this.context.sampleRate;
    const duration = 0.135;
    const samples = new Float32Array(Math.round(duration * sampleRate));
    const noise = this.deterministicNoise(samples.length, 0x41a7);
    const click = this.biquad(
      this.biquad(noise, this.highPass(1150, 0.75)),
      this.lowPass(3900, 0.72),
    );
    let phase = 0;
    for (let index = 0; index < samples.length; index += 1) {
      const time = index / sampleRate;
      const frequency = 80 + (168 - 80) * Math.exp(-time / 0.024);
      phase += TAU * frequency / sampleRate;
      const body = Math.sin(phase) + 0.3 * Math.sin(2 * phase - 0.15);
      const envelope = (1 - Math.exp(-time / 0.0009)) * Math.exp(-time / 0.047);
      samples[index] = body * envelope + 0.11 * click[index] * Math.exp(-time / 0.0032);
    }
    return samples;
  }

  private snare(): Float32Array {
    const sampleRate = this.context.sampleRate;
    const samples = new Float32Array(Math.round(0.072 * sampleRate));
    const noise = this.deterministicNoise(samples.length, 0x91d3);
    const wires = this.biquad(
      this.biquad(noise, this.highPass(700, 0.72)),
      this.lowPass(4800, 0.70),
    );
    const stick = this.biquad(
      this.biquad(noise, this.highPass(1200, 0.75)),
      this.lowPass(4500, 0.72),
    );
    for (let index = 0; index < samples.length; index += 1) {
      const time = index / sampleRate;
      const attack = 1 - Math.exp(-time / 0.00025);
      const shell = 0.52 * Math.sin(TAU * 188 * time)
        + 0.23 * Math.sin(TAU * 326 * time + 0.4)
        + 0.10 * Math.sin(TAU * 468 * time - 0.2);
      const crack = 0.14 * Math.sin(TAU * 890 * time + 0.15) * Math.exp(-time / 0.012);
      samples[index] = attack * (
        0.72 * shell * Math.exp(-time / 0.032)
        + 0.34 * wires[index] * Math.exp(-time / 0.022)
        + crack
      ) + 0.06 * stick[index]
        * (1 - Math.exp(-time / 0.00008))
        * Math.exp(-time / 0.0022);
    }
    return samples;
  }

  private closedHat(): Float32Array {
    const sampleRate = this.context.sampleRate;
    const samples = new Float32Array(Math.round(0.043 * sampleRate));
    const noise = this.deterministicNoise(samples.length, 0xc531);
    const hiss = this.biquad(noise, this.highPass(5200, 0.68));
    const frequencies = [4980, 6410, 8020, 9730, 11760, 13940];
    for (let index = 0; index < samples.length; index += 1) {
      const time = index / sampleRate;
      let metal = 0;
      for (let mode = 0; mode < frequencies.length; mode += 1) {
        metal += Math.sin(TAU * frequencies[mode] * time + mode * 0.73);
      }
      metal /= frequencies.length;
      const attack = 1 - Math.exp(-time / 0.00012);
      samples[index] = attack * Math.exp(-time / 0.0095) * (0.58 * metal + 0.34 * hiss[index]);
    }
    return samples;
  }

  private cowbell(strength: BeatStrength): Float32Array {
    const sampleRate = this.context.sampleRate;
    const base = strength === 'accent' ? 610 : strength === 'secondary' ? 565 : 520;
    const duration = strength === 'accent' ? 0.068 : strength === 'secondary' ? 0.061 : 0.055;
    const decay = strength === 'accent' ? 0.027 : strength === 'secondary' ? 0.024 : 0.021;
    const samples = new Float32Array(Math.round(duration * sampleRate));
    for (let index = 0; index < samples.length; index += 1) {
      const time = index / sampleRate;
      const first = Math.sin(TAU * base * time);
      const second = Math.sin(TAU * base * 1.47 * time + 0.18);
      const upper = 0.15 * Math.sin(TAU * base * 2.12 * time - 0.30) * Math.exp(-time / 0.010)
        + 0.07 * Math.sin(TAU * base * 2.73 * time + 0.44) * Math.exp(-time / 0.0065);
      const attack = 1 - Math.exp(-time / 0.00055);
      samples[index] = attack * ((first + 0.72 * second) * Math.exp(-time / decay) + upper);
    }
    return this.biquad(samples, this.lowPass(3200, 0.72));
  }

  private biquad(input: Float32Array, filter: Biquad): Float32Array {
    const output = new Float32Array(input.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let index = 0; index < input.length; index += 1) {
      const x0 = input[index];
      const y0 = filter.b0 * x0 + filter.b1 * x1 + filter.b2 * x2
        - filter.a1 * y1 - filter.a2 * y2;
      output[index] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
    return output;
  }

  private lowPass(frequency: number, q: number): Biquad {
    return this.coefficients(frequency, q, false);
  }

  private highPass(frequency: number, q: number): Biquad {
    return this.coefficients(frequency, q, true);
  }

  private bandPass(frequency: number, q: number): Biquad {
    const omega = TAU * frequency / this.context.sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * q);
    const a0 = 1 + alpha;
    return {
      b0: alpha / a0,
      b1: 0,
      b2: -alpha / a0,
      a1: -2 * cosine / a0,
      a2: (1 - alpha) / a0,
    };
  }

  private coefficients(frequency: number, q: number, highPass: boolean): Biquad {
    const omega = TAU * frequency / this.context.sampleRate;
    const cosine = Math.cos(omega);
    const alpha = Math.sin(omega) / (2 * q);
    const a0 = 1 + alpha;
    const sign = highPass ? 1 : -1;
    const b0 = (1 + sign * cosine) / 2 / a0;
    const b1 = -(sign + cosine) / a0;
    return {
      b0,
      b1,
      b2: b0,
      a1: -2 * cosine / a0,
      a2: (1 - alpha) / a0,
    };
  }

  private finalize(input: Float32Array, strength: BeatStrength): Float32Array {
    const output = input.slice();
    let mean = 0;
    for (const sample of output) mean += sample;
    mean /= output.length;
    for (let index = 0; index < output.length; index += 1) output[index] -= mean;

    const fadeIn = Math.max(1, Math.round(this.context.sampleRate * 0.0002));
    const fadeOut = Math.min(output.length, Math.round(this.context.sampleRate * 0.004));
    for (let index = 0; index < output.length; index += 1) {
      const attack = index < fadeIn ? index / fadeIn : 1;
      const remaining = output.length - 1 - index;
      const release = remaining < fadeOut ? remaining / fadeOut : 1;
      output[index] *= Math.min(attack, release);
    }
    // 淡入淡出会重新引入极小直流分量，在滤波校准前再移除一次，
    // 避免不同音色连续播放时扬声器出现可感知的低频偏移。
    let fadedMean = 0;
    for (const sample of output) fadedMean += sample;
    fadedMean /= output.length;
    for (let index = 0; index < output.length; index += 1) output[index] -= fadedMean;

    // 使用同一段 100Hz–12kHz 加权能量校准响度，避免不同音色因直流分量或
    // 高频噪声偏多而被错误地拉大，确保不同音色的主增益保持一致。
    const weighted = this.biquad(
      this.biquad(output, this.highPass(100, 0.707)),
      this.lowPass(12000, 0.707),
    );
    const window = Math.min(output.length, Math.round(this.context.sampleRate * 0.05));
    let energy = 0;
    let peak = 0;
    for (let index = 0; index < window; index += 1) {
      energy += weighted[index] * weighted[index];
    }
    for (let index = 0; index < output.length; index += 1) {
      peak = Math.max(peak, Math.abs(output[index]));
    }
    const rms = Math.sqrt(energy / Math.max(1, window));
    const targetRms = strength === 'accent' ? 0.20 : strength === 'secondary' ? 0.135 : 0.10;
    const peakCeiling = strength === 'accent' ? 0.69 : strength === 'secondary' ? 0.48 : 0.42;
    const gain = Math.min(targetRms / Math.max(rms, 1e-9), peakCeiling / Math.max(peak, 1e-9));
    for (let index = 0; index < output.length; index += 1) {
      output[index] *= gain * OUTPUT_GAIN;
    }
    output[0] = 0;
    output[output.length - 1] = 0;
    return output;
  }

  private deterministicNoise(length: number, seed: number): Float32Array {
    let state = seed & 0x7fffffff;
    const output = new Float32Array(length);
    for (let index = 0; index < length; index += 1) {
      // 使用 Math.imul 保留 32 位乘法的低位，等价于原生实现的 31 位 LCG，
      // 避免 JavaScript Number 在大整数乘法时丢失低位而改变音色纹理。
      state = (Math.imul(1103515245, state) + 12345) & 0x7fffffff;
      output[index] = state / 0x3fffffff - 1;
    }
    return output;
  }
}
