import { detectPitchAsync } from '../core/tuner/yin-detector';
import { PitchTrackUpdate, PitchTracker } from '../core/tuner/pitch-tracker';

export interface RecorderTunerCallbacks {
  onPitch: (pitch: PitchTrackUpdate) => void;
  onUnavailable: (reason?: string) => void;
  onInterrupted: (interrupted: boolean) => void;
}

// 调音器只需覆盖乐器基频，16kHz 已足够识别最低音到高音弦，并且是真机兼容性更好的录音档位。
const SAMPLE_RATE = 16000;
const ANALYSIS_WINDOW_SIZE = 4096;
const ANALYSIS_HOP_SIZE = 2048;
const MINIMUM_ANALYSIS_INTERVAL_MS = 60;

/**
 * 小程序只允许一个全局 RecorderManager，因此此适配器也只保留一个实例。
 * 页面离开时解绑回调而非重复注册底层事件，避免调音器来回切换后同一段 PCM
 * 被多个已销毁页面重复处理。
 */
export class RecorderTuner {
  private readonly recorder = wx.getRecorderManager();
  private callbacks: RecorderTunerCallbacks | null = null;
  private readonly ring = new Float32Array(ANALYSIS_WINDOW_SIZE);
  private readonly pitchTracker = new PitchTracker({
    // 中等置信度需要三次候选；窗口需覆盖 iOS 上约 300ms 的检测间隔。
    candidateWindowMs: 900,
    silenceResetMs: 1200,
  });
  private writeIndex = 0;
  private sampleCount = 0;
  private samplesSinceAnalysis = 0;
  private danglingByte: number | null = null;
  private listening = false;
  private analysisInProgress = false;
  private analysisGeneration = 0;
  private lastAnalysisAt = 0;
  private interrupted = false;
  private diagnosticTimer: ReturnType<typeof setInterval> | null = null;
  private diagnosticFrameCount = 0;
  private diagnosticByteCount = 0;
  private diagnosticSampleCount = 0;
  private diagnosticSum = 0;
  private diagnosticEnergy = 0;
  private diagnosticPeak = 0;
  private diagnosticWindowCount = 0;
  private diagnosticWindowRmsTotal = 0;
  private diagnosticWindowRmsMinimum = Number.POSITIVE_INFINITY;
  private diagnosticWindowRmsMaximum = 0;
  private diagnosticAnalysisDurationTotalMs = 0;
  private diagnosticAnalysisDurationMaximumMs = 0;
  private diagnosticLastAnalysisDurationMs: number | null = null;
  private diagnosticYinHitCount = 0;
  private diagnosticTrackedCount = 0;
  private diagnosticLastYinFrequencyHz: number | null = null;
  private diagnosticLastYinConfidence: number | null = null;
  private diagnosticLastTrackedFrequencyHz: number | null = null;
  private diagnosticLastFlushAt = 0;

  constructor() {
    this.recorder.onFrameRecorded(({ frameBuffer }) => this.consumePcm(frameBuffer));
    this.recorder.onError((error) => {
      // stop() 或系统中断会主动结束录音；这些结束回调不应被误判为麦克风故障。
      const shouldNotify = this.listening && !this.interrupted;
      // 保留原生错误码，便于定位真机上启动录音失败的具体原因；页面只展示统一的轻量提示。
      this.flushDiagnostics();
      this.clearDiagnosticTimer();
      console.warn('[tuner-recorder] 录音启动失败 ' + (error?.errMsg || String(error)));
      this.invalidateAnalysis();
      this.listening = false;
      if (!this.interrupted) this.interrupted = false;
      this.pitchTracker.reset();
      if (shouldNotify) this.callbacks?.onUnavailable(error?.errMsg);
    });
    this.recorder.onInterruptionBegin(() => {
      if (!this.listening) return;
      // 系统中断后旧 PCM 流通常已经失效，先清空状态，等待结束事件重建。
      this.flushDiagnostics();
      this.clearDiagnosticTimer();
      this.invalidateAnalysis();
      this.listening = false;
      this.interrupted = true;
      this.resetBuffer();
      try {
        this.recorder.stop();
      } catch (_) {
        // 系统已经回收录音会话时，结束中断仍可继续走重建流程。
      }
      this.callbacks?.onInterrupted(true);
    });
    this.recorder.onInterruptionEnd(() => {
      if (!this.interrupted) return;
      this.interrupted = false;
      this.callbacks?.onInterrupted(false);
    });
  }

  setCallbacks(callbacks: RecorderTunerCallbacks | null): void {
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.listening) return;
    this.invalidateAnalysis();
    this.resetBuffer();
    this.pitchTracker.reset();
    this.interrupted = false;
    this.resetDiagnostics();
    this.diagnosticLastFlushAt = Date.now();
    const audioSource = wx.getSystemInfoSync().platform === 'ios' ? 'buildInMic' : 'auto';
    console.log('[tuner-debug] 正在启动录音 ' + JSON.stringify({
      sampleRate: SAMPLE_RATE,
      frameSizeKB: 4,
      channels: 1,
      format: 'PCM',
      audioSource,
    }));
    try {
      this.recorder.start({
        duration: 600000,
        format: 'PCM',
        // 4KB PCM 帧兼顾首次出帧延迟和 YIN 分析窗口的重叠。
        frameSize: 4,
        numberOfChannels: 1,
        sampleRate: SAMPLE_RATE,
        // 显式设置与 16kHz 匹配的码率，避免部分机型使用默认参数时拒绝启动。
        encodeBitRate: 48000,
        audioSource,
      });
      this.listening = true;
      console.log('[tuner-debug] RecorderManager.start() 已调用');
      this.diagnosticTimer = setInterval(() => this.flushDiagnostics(), 1000);
    } catch (error) {
      console.warn('[tuner-debug] RecorderManager.start() 同步失败 ' + String(error));
      this.callbacks?.onUnavailable();
    }
  }

  stop(): void {
    const hadSession = this.listening || this.interrupted;
    if (hadSession || this.diagnosticTimer !== null) this.flushDiagnostics();
    this.clearDiagnosticTimer();
    this.invalidateAnalysis();
    this.listening = false;
    this.interrupted = false;
    this.pitchTracker.reset();
    if (hadSession) {
      try {
        this.recorder.stop();
      } catch (_) {
        // 已被系统回收的录音会话再次 stop 时无需向页面报告错误。
      }
    }
    this.resetBuffer();
  }

  restartAfterInterruption(): void {
    // 中断结束后旧录音会话在部分机型上不会自动恢复，显式重建 PCM 流。
    this.stop();
    this.start();
  }

  private consumePcm(frameBuffer: ArrayBuffer): void {
    if (!this.listening || this.callbacks === null) return;
    this.diagnosticFrameCount++;
    this.diagnosticByteCount += frameBuffer.byteLength;
    if (frameBuffer.byteLength === 0) return;
    const pcm = new DataView(frameBuffer);
    let offset = 0;
    // 极少数设备会把一个 16 位样本拆到相邻两个回调，保留尾字节避免破坏周期。
    if (this.danglingByte !== null) {
      if (pcm.byteLength === 0) return;
      const raw = this.danglingByte | (pcm.getUint8(0) << 8);
      this.appendPcmSample(raw >= 0x8000 ? raw - 0x10000 : raw);
      this.danglingByte = null;
      offset = 1;
    }
    for (; offset + 1 < pcm.byteLength; offset += 2) {
      this.appendPcmSample(pcm.getInt16(offset, true));
    }
    if (offset < pcm.byteLength) {
      this.danglingByte = pcm.getUint8(offset);
    }
    this.analyzeLatestWindow();
  }

  private appendPcmSample(sample: number): void {
    const normalized = sample / 32768;
    this.diagnosticSampleCount++;
    this.diagnosticSum += normalized;
    this.diagnosticEnergy += normalized * normalized;
    this.diagnosticPeak = Math.max(this.diagnosticPeak, Math.abs(normalized));
    this.ring[this.writeIndex] = normalized;
    this.writeIndex = (this.writeIndex + 1) % ANALYSIS_WINDOW_SIZE;
    this.sampleCount = Math.min(this.sampleCount + 1, ANALYSIS_WINDOW_SIZE);
    this.samplesSinceAnalysis++;
  }

  private analyzeLatestWindow(): void {
    if (this.sampleCount < ANALYSIS_WINDOW_SIZE || this.samplesSinceAnalysis < ANALYSIS_HOP_SIZE) return;
    if (this.analysisInProgress) return;
    this.samplesSinceAnalysis = 0;

    // 控制分析频率，避免低端设备的 JS 线程被 YIN 循环持续占用。
    const now = Date.now();
    if (now - this.lastAnalysisAt < MINIMUM_ANALYSIS_INTERVAL_MS) return;
    this.lastAnalysisAt = now;
    const window = new Float32Array(ANALYSIS_WINDOW_SIZE);
    for (let index = 0; index < ANALYSIS_WINDOW_SIZE; index++) {
      window[index] = this.ring[(this.writeIndex + index) % ANALYSIS_WINDOW_SIZE];
    }
    const windowRms = this.measureRms(window);
    this.diagnosticWindowCount++;
    this.diagnosticWindowRmsTotal += windowRms;
    this.diagnosticWindowRmsMinimum = Math.min(this.diagnosticWindowRmsMinimum, windowRms);
    this.diagnosticWindowRmsMaximum = Math.max(this.diagnosticWindowRmsMaximum, windowRms);
    const analysisStartedAt = Date.now();
    const generation = this.analysisGeneration;
    this.analysisInProgress = true;
    void detectPitchAsync(window, SAMPLE_RATE)
      .then((pitch) => {
        if (generation !== this.analysisGeneration || !this.listening || pitch === null) return;
        this.diagnosticYinHitCount++;
        this.diagnosticLastYinFrequencyHz = pitch.frequencyHz;
        this.diagnosticLastYinConfidence = pitch.confidence;
        const tracked = this.pitchTracker.process(
          pitch.frequencyHz,
          pitch.confidence,
          pitch.rms,
          Date.now(),
        );
        if (tracked !== null) {
          this.diagnosticTrackedCount++;
          this.diagnosticLastTrackedFrequencyHz = tracked.frequencyHz;
          this.callbacks?.onPitch(tracked);
        }
      })
      .catch((error: unknown) => {
        if (generation === this.analysisGeneration) {
          console.warn('[tuner-debug] 音高分析失败 ' + String(error));
        }
      })
      .finally(() => {
        if (generation !== this.analysisGeneration) return;
        const analysisDurationMs = Date.now() - analysisStartedAt;
        this.diagnosticAnalysisDurationTotalMs += analysisDurationMs;
        this.diagnosticAnalysisDurationMaximumMs = Math.max(
          this.diagnosticAnalysisDurationMaximumMs,
          analysisDurationMs,
        );
        this.diagnosticLastAnalysisDurationMs = analysisDurationMs;
        this.analysisInProgress = false;
        this.analyzeLatestWindow();
      });
  }

  private invalidateAnalysis(): void {
    this.analysisGeneration++;
    this.analysisInProgress = false;
  }

  private measureRms(samples: Float32Array): number {
    let mean = 0;
    for (let index = 0; index < samples.length; index++) mean += samples[index];
    mean /= samples.length;

    let energy = 0;
    for (let index = 0; index < samples.length; index++) {
      const centered = samples[index] - mean;
      energy += centered * centered;
    }
    return Math.sqrt(energy / samples.length);
  }

  private flushDiagnostics(): void {
    const now = Date.now();
    const intervalMs = this.diagnosticLastFlushAt > 0 ? now - this.diagnosticLastFlushAt : null;
    this.diagnosticLastFlushAt = now;
    const frameMean = this.diagnosticSampleCount > 0
      ? this.diagnosticSum / this.diagnosticSampleCount
      : 0;
    const frameRms = this.diagnosticSampleCount > 0
      ? Math.sqrt(Math.max(0, this.diagnosticEnergy / this.diagnosticSampleCount - frameMean * frameMean))
      : null;
    const averageWindowRms = this.diagnosticWindowCount > 0
      ? this.diagnosticWindowRmsTotal / this.diagnosticWindowCount
      : null;
    const statistics = {
      intervalMs,
      listening: this.listening,
      frames: this.diagnosticFrameCount,
      bytes: this.diagnosticByteCount,
      samples: this.diagnosticSampleCount,
      frameRms,
      framePeak: this.diagnosticSampleCount > 0 ? this.diagnosticPeak : null,
      analysisWindows: this.diagnosticWindowCount,
      averageWindowRms,
      minimumWindowRms: this.diagnosticWindowCount > 0 ? this.diagnosticWindowRmsMinimum : null,
      maximumWindowRms: this.diagnosticWindowCount > 0 ? this.diagnosticWindowRmsMaximum : null,
      totalAnalysisDurationMs: this.diagnosticAnalysisDurationTotalMs,
      maximumAnalysisDurationMs: this.diagnosticAnalysisDurationMaximumMs,
      lastAnalysisDurationMs: this.diagnosticLastAnalysisDurationMs,
      yinHits: this.diagnosticYinHitCount,
      lastYinFrequencyHz: this.diagnosticLastYinFrequencyHz,
      lastYinConfidence: this.diagnosticLastYinConfidence,
      trackedOutputs: this.diagnosticTrackedCount,
      lastTrackedFrequencyHz: this.diagnosticLastTrackedFrequencyHz,
    };
    console.log('[tuner-debug] 音频流统计（静音时也会打印） ' + JSON.stringify(statistics));
    this.resetDiagnostics();
  }

  private resetDiagnostics(): void {
    this.diagnosticFrameCount = 0;
    this.diagnosticByteCount = 0;
    this.diagnosticSampleCount = 0;
    this.diagnosticSum = 0;
    this.diagnosticEnergy = 0;
    this.diagnosticPeak = 0;
    this.diagnosticWindowCount = 0;
    this.diagnosticWindowRmsTotal = 0;
    this.diagnosticWindowRmsMinimum = Number.POSITIVE_INFINITY;
    this.diagnosticWindowRmsMaximum = 0;
    this.diagnosticAnalysisDurationTotalMs = 0;
    this.diagnosticAnalysisDurationMaximumMs = 0;
    this.diagnosticLastAnalysisDurationMs = null;
    this.diagnosticYinHitCount = 0;
    this.diagnosticTrackedCount = 0;
    this.diagnosticLastYinFrequencyHz = null;
    this.diagnosticLastYinConfidence = null;
    this.diagnosticLastTrackedFrequencyHz = null;
  }

  private clearDiagnosticTimer(): void {
    if (this.diagnosticTimer === null) return;
    clearInterval(this.diagnosticTimer);
    this.diagnosticTimer = null;
  }

  private resetBuffer(): void {
    this.ring.fill(0);
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.samplesSinceAnalysis = 0;
    this.danglingByte = null;
    this.lastAnalysisAt = 0;
  }
}

export const recorderTuner = new RecorderTuner();
