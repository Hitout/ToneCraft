import {
  BeatStrength,
  MetronomeConfig,
  MetronomeSound,
} from '../../core/metronome/metronome-config';
import { MetronomeTick, MetronomeTimeline } from '../../core/metronome/metronome-timeline';
import { ClickSynthesizer } from './click-synthesizer';

type AudioContextLike = WechatMiniprogram.WebAudioContext;
type AudioBufferSourceLike = WechatMiniprogram.BufferSourceNode;

export type MetronomeAudioStatus = 'stopped' | 'playing' | 'interrupted' | 'error';

export interface ScheduledBeatEvent {
  readonly at: number;
  readonly beatIndex: number;
  readonly subdivisionIndex: number;
  /** 音频时间线在该拍点实际使用的配置，用于在小节边界同步页面状态。 */
  readonly config?: MetronomeConfig;
  readonly strength: BeatStrength;
  readonly sound: MetronomeSound;
  readonly audible: boolean;
  readonly audibleDurationMs: number;
}

export interface WebAudioMetronomeOptions {
  onBeat?: (event: ScheduledBeatEvent) => void;
  onStatus?: (status: MetronomeAudioStatus) => void;
}

interface ScheduledSource {
  readonly source: AudioBufferSourceLike;
  readonly at: number;
}

const SCHEDULE_INTERVAL_MS = 25;
const SCHEDULE_AHEAD_SECONDS = 0.15;
const FIRST_BEAT_DELAY_SECONDS = 0.08;

function createWebAudioContext(): AudioContextLike {
  const api = wx as unknown as {
    createWebAudioContext: () => AudioContextLike;
  };
  return api.createWebAudioContext();
}

/**
 * WebAudio 节拍器只用 JS 定时器维护未来调度窗口，真正的发声时间由
 * AudioContext.currentTime 和 AudioBufferSourceNode.start(when) 决定。
 * 因此页面卡顿不会把定时器抖动直接变成听得见的节拍抖动。
 */
export class WebAudioMetronome {
  private readonly timeline = new MetronomeTimeline();
  private readonly sources = new Set<ScheduledSource>();
  private readonly beatTimers = new Map<ReturnType<typeof setTimeout>, number>();
  private context: AudioContextLike | null = null;
  private synthesizer: ClickSynthesizer | null = null;
  private schedulerTimer: ReturnType<typeof setInterval> | null = null;
  private stopAt: number | null = null;
  private generation = 0;
  private playing = false;
  private options: WebAudioMetronomeOptions;

  constructor(options: WebAudioMetronomeOptions = {}) {
    this.options = options;
  }

  setListeners(options: WebAudioMetronomeOptions): void {
    this.options = options;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  async start(config: MetronomeConfig, timerSeconds: number | null = null): Promise<void> {
    this.clearSession();
    // resume() 在 iOS 上可能异步完成；记录本次启动的 generation，避免用户在
    // 等待期间点击停止或触发新会话后，旧启动继续创建调度器。
    const sessionGeneration = this.generation;
    try {
      const context = this.ensureContext();
      // iOS 需要在用户点击触发的调用栈内恢复上下文，不能把 resume 延后到
      // 普通定时器，否则首拍可能被系统静默丢弃。
      if (context.state === 'suspended') await context.resume();
      if (this.generation !== sessionGeneration) return;
      this.synthesizer ??= new ClickSynthesizer(context);
      if (this.synthesizer) this.synthesizer.render();
      if (this.generation !== sessionGeneration) return;

      const startAt = context.currentTime + FIRST_BEAT_DELAY_SECONDS;
      this.timeline.reset(startAt, config);
      this.stopAt = timerSeconds == null ? null : startAt + Math.max(0, timerSeconds);
      this.playing = true;
      this.schedulerTimer = setInterval(
        () => this.scheduleCurrentSession(),
        SCHEDULE_INTERVAL_MS,
      );
      this.scheduleCurrentSession();
      this.options.onStatus?.('playing');
    } catch (error) {
      // 旧启动被 stop()/dispose() 取消时，不应把取消过程误报成音频错误。
      if (this.generation !== sessionGeneration) return;
      this.clearSession();
      this.options.onStatus?.('error');
      throw error;
    }
  }

  update(config: MetronomeConfig, timerSeconds?: number | null): void {
    this.timeline.queueConfig(config, this.context?.currentTime);
    if (timerSeconds !== undefined && this.context !== null && this.playing) {
      this.stopAt = timerSeconds == null
        ? null
        : this.context.currentTime + Math.max(0, timerSeconds);
      this.removeSourcesAfter(this.stopAt);
    }
  }

  stop(): void {
    const wasPlaying = this.playing;
    this.clearSession();
    if (wasPlaying) this.options.onStatus?.('stopped');
  }

  dispose(): void {
    this.clearSession();
    this.context?.close();
    this.context = null;
    this.synthesizer = null;
  }

  private ensureContext(): AudioContextLike {
    const existing = this.context;
    if (existing !== null && existing.state !== 'closed') return existing;
    const context = createWebAudioContext();
    this.context = context;
    context.onstatechange = () => {
      if (this.playing && this.context?.state === 'suspended') {
        // 系统音频中断或页面切后台时，不能让已经排入的节点在恢复后“追赶式”发声。
        // 先清理当前会话，再通知 Model 保留可恢复的业务状态，后续由用户重新点击播放。
        this.clearSession();
        this.options.onStatus?.('interrupted');
      }
    };
    return context;
  }

  private scheduleCurrentSession(): void {
    const context = this.context;
    if (!this.playing || context === null) return;
    const now = context.currentTime;
    if (this.stopAt !== null && now >= this.stopAt) {
      this.stop();
      return;
    }

    this.timeline.discardBefore(now);
    const horizon = this.stopAt === null
      ? now + SCHEDULE_AHEAD_SECONDS
      : Math.min(now + SCHEDULE_AHEAD_SECONDS, this.stopAt);
    const ticks = this.timeline.collect(horizon);
    for (const tick of ticks) {
      if (this.stopAt !== null && tick.at >= this.stopAt) break;
      this.scheduleTick(tick, now);
    }
  }

  private scheduleTick(tick: MetronomeTick, now: number): void {
    const context = this.context;
    const synthesizer = this.synthesizer;
    if (context === null || synthesizer === null) return;

    if (tick.audible) {
      const buffer = synthesizer.get(tick.config.sound, tick.strength);
      if (buffer !== null) {
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const scheduled: ScheduledSource = { source, at: tick.at };
        this.sources.add(scheduled);
        source.onended = () => this.sources.delete(scheduled);
        source.start(tick.at);
      }
    }

    const delay = Math.max(0, (tick.at - now) * 1000);
    const generation = this.generation;
    const timer = setTimeout(() => {
      this.beatTimers.delete(timer);
      if (!this.playing || generation !== this.generation) return;
      const buffer = tick.audible
        ? synthesizer.get(tick.config.sound, tick.strength)
        : null;
      this.options.onBeat?.({
        at: tick.at,
        beatIndex: tick.beatIndex,
        subdivisionIndex: tick.subdivisionIndex,
        config: tick.config,
        strength: tick.strength,
        sound: tick.config.sound,
        audible: tick.audible,
        audibleDurationMs: buffer === null ? 24 : Math.max(1, Math.round(buffer.duration * 1000)),
      });
    }, delay);
    this.beatTimers.set(timer, tick.at);
  }

  private removeSourcesAfter(deadline: number | null): void {
    if (deadline === null) return;
    const now = this.context?.currentTime ?? 0;
    for (const scheduled of this.sources) {
      if (scheduled.at < deadline) continue;
      try {
        scheduled.source.stop(now);
      } catch (_) {
        // 已经自然结束的 BufferSource 再 stop 会抛异常，资源本身无需处理。
      }
      this.sources.delete(scheduled);
    }
    // 倒计时缩短时，已经排入 JS 的 UI 回调也必须同步取消，避免声音停止后
    // 页面仍然短暂高亮节拍。声音本身由 AudioBufferSourceNode 负责精确播放，
    // 这里仅维护视觉反馈的生命周期。
    for (const [timer, at] of this.beatTimers) {
      if (at < deadline) continue;
      clearTimeout(timer);
      this.beatTimers.delete(timer);
    }
  }

  private clearSession(): void {
    this.playing = false;
    this.generation += 1;
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    for (const timer of this.beatTimers.keys()) clearTimeout(timer);
    this.beatTimers.clear();
    const now = this.context?.currentTime ?? 0;
    for (const scheduled of this.sources) {
      try {
        scheduled.source.stop(now);
      } catch (_) {
        // 同上，忽略已经结束的短音频节点。
      }
    }
    this.sources.clear();
    this.stopAt = null;
  }
}
