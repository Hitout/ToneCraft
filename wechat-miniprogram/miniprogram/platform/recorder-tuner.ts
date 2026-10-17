import { detectPitch, PitchDetection } from '../core/tuner/yin-detector';
import { PitchTrackUpdate, PitchTracker } from '../core/tuner/pitch-tracker';
import { PitchAnalysisWorker } from './pitch-analysis-worker';

export interface RecorderTunerCallbacks {
  onPitch: (pitch: PitchTrackUpdate) => void;
  onUnavailable: (reason?: string) => void;
  onInterrupted: (interrupted: boolean) => void;
}

// 调音器只需覆盖乐器基频，16kHz 已足够识别最低音到高音弦，并且是真机兼容性更好的录音档位。
const SAMPLE_RATE = 16000;
const ANALYSIS_WINDOW_SIZE = 4096;
const ANALYSIS_HOP_SIZE = 2048;
const IOS_ANALYSIS_HOP_SIZE = 1024;
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
  private readonly pitchTracker = new PitchTracker();
  private writeIndex = 0;
  private sampleCount = 0;
  private samplesSinceAnalysis = 0;
  private danglingByte: number | null = null;
  private listening = false;
  private lastAnalysisAt = 0;
  private lastProcessedAt: number | null = null;
  private lastAnalysisDurationMs = 0;
  private interrupted = false;
  private analysisWorker: PitchAnalysisWorker | null = null;
  private isIos = false;

  constructor() {
    this.recorder.onFrameRecorded(({ frameBuffer }) => this.consumePcm(frameBuffer));
    this.recorder.onError((error) => {
      // stop() 或系统中断会主动结束录音；这些结束回调不应被误判为麦克风故障。
      const shouldNotify = this.listening && !this.interrupted;
      // 保留原生错误码，便于定位真机上启动录音失败的具体原因；页面只展示统一的轻量提示。
      console.warn('[tuner-recorder] 录音启动失败', error?.errMsg || error);
      this.closeAnalysisWorker();
      this.listening = false;
      if (!this.interrupted) this.interrupted = false;
      this.pitchTracker.reset();
      if (shouldNotify) this.callbacks?.onUnavailable(error?.errMsg);
    });
    this.recorder.onInterruptionBegin(() => {
      if (!this.listening) return;
      // 系统中断后旧 PCM 流通常已经失效，先清空状态，等待结束事件重建。
      this.closeAnalysisWorker();
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
    this.resetBuffer();
    this.pitchTracker.reset();
    this.interrupted = false;
    this.isIos = wx.getSystemInfoSync().platform === 'ios';
    if (this.isIos) this.openAnalysisWorker();
    try {
      this.recorder.start({
        duration: 600000,
        format: 'PCM',
        // iOS 请求较小的原生帧，避免分析窗口被粗粒度回调限制更新频率。
        frameSize: this.isIos ? 1 : 4,
        numberOfChannels: 1,
        sampleRate: SAMPLE_RATE,
        // 显式设置与 16kHz 匹配的码率，避免部分机型使用默认参数时拒绝启动。
        encodeBitRate: 48000,
        audioSource: this.isIos ? 'buildInMic' : 'auto',
      });
      this.listening = true;
    } catch (_) {
      this.closeAnalysisWorker();
      this.callbacks?.onUnavailable();
    }
  }

  stop(): void {
    const hadSession = this.listening || this.interrupted;
    this.closeAnalysisWorker();
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
    if (!this.listening || this.callbacks === null || frameBuffer.byteLength === 0) return;
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
    this.ring[this.writeIndex] = sample / 32768;
    this.writeIndex = (this.writeIndex + 1) % ANALYSIS_WINDOW_SIZE;
    this.sampleCount = Math.min(this.sampleCount + 1, ANALYSIS_WINDOW_SIZE);
    this.samplesSinceAnalysis++;
  }

  private analyzeLatestWindow(): void {
    const hopSize = this.isIos ? IOS_ANALYSIS_HOP_SIZE : ANALYSIS_HOP_SIZE;
    if (this.sampleCount < ANALYSIS_WINDOW_SIZE || this.samplesSinceAnalysis < hopSize) return;
    if (this.analysisWorker !== null && !this.analysisWorker.ready) return;

    // 控制分析频率，避免低端设备的 JS 线程被 YIN 循环持续占用。
    const now = Date.now();
    if (now - this.lastAnalysisAt < MINIMUM_ANALYSIS_INTERVAL_MS) return;
    this.samplesSinceAnalysis = 0;
    this.lastAnalysisAt = now;
    const window = new Float32Array(ANALYSIS_WINDOW_SIZE);
    for (let index = 0; index < ANALYSIS_WINDOW_SIZE; index++) {
      window[index] = this.ring[(this.writeIndex + index) % ANALYSIS_WINDOW_SIZE];
    }
    if (this.analysisWorker !== null) {
      this.analysisWorker.analyze(window, SAMPLE_RATE, now);
    } else {
      this.acceptPitch(detectPitch(window, SAMPLE_RATE, this.isIos ? 0.20 : 0.12), now);
    }
  }

  private acceptPitch(pitch: PitchDetection | null, capturedAt: number): void {
    if (!this.listening) return;
    if (this.lastProcessedAt !== null && capturedAt <= this.lastProcessedAt) return;
    // 只补偿线程忙碌及等待下一步音频的时间，空闲或无数据时长仍按静音处理。
    // 静音窗口也更新时间，避免重新起音时将整段静音误当作线程降频。
    const observationIntervalMs = this.isIos && this.lastProcessedAt !== null
      ? Math.min(
        capturedAt - this.lastProcessedAt,
        this.lastAnalysisDurationMs + IOS_ANALYSIS_HOP_SIZE / SAMPLE_RATE * 1000,
      )
      : 0;
    this.lastProcessedAt = capturedAt;
    this.lastAnalysisDurationMs = Math.max(0, Date.now() - capturedAt);
    if (pitch === null) return;
    const tracked = this.pitchTracker.process(
      pitch.frequencyHz,
      pitch.confidence,
      pitch.rms,
      capturedAt,
      observationIntervalMs,
    );
    if (tracked !== null) this.callbacks?.onPitch(tracked);
  }

  private openAnalysisWorker(): void {
    try {
      this.analysisWorker = new PitchAnalysisWorker({
        onReady: () => {
          console.info('[tuner] iOS 计算线程就绪');
          if (this.listening) this.analyzeLatestWindow();
        },
        onPitch: (pitch, capturedAt) => {
          this.acceptPitch(pitch, capturedAt);
          if (this.listening) this.analyzeLatestWindow();
        },
        onError: (error) => {
          this.analysisWorker = null;
          console.warn('[tuner] 计算线程不可用，使用快速检测', error);
          if (this.listening) this.analyzeLatestWindow();
        },
      });
    } catch (error) {
      console.warn('[tuner] 计算线程不可用，使用快速检测', error);
    }
  }

  private closeAnalysisWorker(): void {
    this.analysisWorker?.dispose();
    this.analysisWorker = null;
  }

  private resetBuffer(): void {
    this.ring.fill(0);
    this.writeIndex = 0;
    this.sampleCount = 0;
    this.samplesSinceAnalysis = 0;
    this.danglingByte = null;
    this.lastAnalysisAt = 0;
    this.lastProcessedAt = null;
    this.lastAnalysisDurationMs = 0;
  }
}

export const recorderTuner = new RecorderTuner();
