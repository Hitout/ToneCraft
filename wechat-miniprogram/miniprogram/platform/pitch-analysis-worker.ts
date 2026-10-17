import type { PitchDetection } from '../core/tuner/yin-detector';

interface WorkerCallbacks {
  onReady: () => void;
  onPitch: (pitch: PitchDetection | null, capturedAt: number) => void;
  onError: (error: Error) => void;
}

interface WorkerReply {
  type: 'ready' | 'result' | 'error';
  id?: number;
  pitch?: PitchDetection | null;
  error?: string;
}

/** 一个会话只允许一个在途窗口；未就绪、忙碌时由录音层保留最新 PCM。 */
export class PitchAnalysisWorker {
  private readonly worker: WechatMiniprogram.Worker;
  private state: 'starting' | 'idle' | 'busy' | 'closed' = 'starting';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private requestId = 0;
  private capturedAt = 0;

  constructor(private readonly callbacks: WorkerCallbacks) {
    this.worker = wx.createWorker('workers/tuner/index.js');
    try {
      this.worker.onMessage((raw) => {
        const message = ((raw as { message?: WorkerReply }).message ?? raw) as WorkerReply;
        if (this.state === 'closed') return;
        if (message.type === 'ready' && this.state === 'starting') {
          clearTimeout(this.timer);
          this.state = 'idle';
          callbacks.onReady();
        } else if (message.type === 'result' && this.state === 'busy' && message.id === this.requestId) {
          clearTimeout(this.timer);
          this.state = 'idle';
          callbacks.onPitch(message.pitch ?? null, this.capturedAt);
        } else if (message.type === 'error') {
          this.fail(new Error(message.error));
        }
      });
      this.worker.onProcessKilled?.(() => this.fail(new Error('计算线程被系统回收')));
      this.armTimeout();
      this.worker.postMessage({ type: 'init' });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  get ready(): boolean { return this.state === 'idle'; }

  analyze(samples: Float32Array, sampleRate: number, capturedAt: number): void {
    if (!this.ready) return;
    this.state = 'busy';
    this.capturedAt = capturedAt;
    this.armTimeout();
    try {
      // 使用普通数组跨线程传输，避免依赖真机调试对 ArrayBuffer 的转发能力。
      this.worker.postMessage({ type: 'analyze', id: ++this.requestId, samples: Array.from(samples), sampleRate });
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)));
    }
  }

  dispose(): void {
    if (this.state === 'closed') return;
    this.state = 'closed';
    clearTimeout(this.timer);
    try { this.worker.terminate(); } catch (_) { /* 系统回收后的终止操作无需重试。 */ }
  }

  private armTimeout(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.fail(new Error('计算线程未响应')), 2000);
  }

  private fail(error: Error): void {
    if (this.state === 'closed') return;
    this.dispose();
    this.callbacks.onError(error);
  }
}
