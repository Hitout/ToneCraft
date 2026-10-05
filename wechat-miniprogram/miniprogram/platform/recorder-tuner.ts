import { detectPitch } from '../core/tuner/yin-detector';
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
  private readonly pitchTracker = new PitchTracker();
  private writeIndex = 0;
  private sampleCount = 0;
  private samplesSinceAnalysis = 0;
  private danglingByte: number | null = null;
  private listening = false;
  private lastAnalysisAt = 0;
  private interrupted = false;

  constructor() {
    this.recorder.onFrameRecorded(({ frameBuffer }) => this.consumePcm(frameBuffer));
    this.recorder.onError((error) => {
      // stop() 或系统中断会主动结束录音；这些结束回调不应被误判为麦克风故障。
      const shouldNotify = this.listening && !this.interrupted;
      // 保留原生错误码，便于定位真机上启动录音失败的具体原因；页面只展示统一的轻量提示。
      console.warn('[tuner-recorder] 录音启动失败', error?.errMsg || error);
      this.listening = false;
      if (!this.interrupted) this.interrupted = false;
      this.pitchTracker.reset();
      if (shouldNotify) this.callbacks?.onUnavailable(error?.errMsg);
    });
    this.recorder.onInterruptionBegin(() => {
      if (!this.listening) return;
      // 系统中断后旧 PCM 流通常已经失效，先清空状态，等待结束事件重建。
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
        audioSource: 'auto',
      });
      this.listening = true;
    } catch (_) {
      this.callbacks?.onUnavailable();
    }
  }

  stop(): void {
    const hadSession = this.listening || this.interrupted;
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
    if (this.sampleCount < ANALYSIS_WINDOW_SIZE || this.samplesSinceAnalysis < ANALYSIS_HOP_SIZE) return;
    this.samplesSinceAnalysis = 0;

    // 控制分析频率，避免低端设备的 JS 线程被 YIN 循环持续占用。
    const now = Date.now();
    if (now - this.lastAnalysisAt < MINIMUM_ANALYSIS_INTERVAL_MS) return;
    this.lastAnalysisAt = now;
    const window = new Float32Array(ANALYSIS_WINDOW_SIZE);
    for (let index = 0; index < ANALYSIS_WINDOW_SIZE; index++) {
      window[index] = this.ring[(this.writeIndex + index) % ANALYSIS_WINDOW_SIZE];
    }
    const pitch = detectPitch(window, SAMPLE_RATE);
    if (pitch === null) return;
    const tracked = this.pitchTracker.process(
      pitch.frequencyHz,
      pitch.confidence,
      pitch.rms,
      now,
    );
    if (tracked !== null) this.callbacks?.onPitch(tracked);
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
