import {
  BEAT_STRENGTHS,
  BeatStrength,
  DEFAULT_CONFIG,
  DEFAULT_SPEED_TRAINER,
  MAXIMUM_BPM,
  MINIMUM_BPM,
  MetronomeConfig,
  MetronomeSound,
  SpeedTrainerConfig,
  Subdivision,
  TIME_SIGNATURES,
  TimeSignature,
  clampInt,
  normalizedConfig,
  normalizedTrainer,
  numerator,
  subdivisionForBeat,
} from './metronome-config';
import { TapTempoTracker } from './tap-tempo';
import {
  MetronomeAudioStatus,
  ScheduledBeatEvent,
  WebAudioMetronome,
} from '../../platform/web-audio/web-audio-metronome';
import { MetronomeStorageService } from '../../platform/storage-service';

export type MetronomeSessionState = 'stopped' | 'playing' | 'interrupted' | 'error';

export interface MetronomeUiState {
  readonly config: MetronomeConfig;
  readonly speedTrainer: SpeedTrainerConfig;
  readonly speedTrainerConfigured: boolean;
  readonly speedTrainerBarProgress: number;
  readonly speedTrainerCompleted: boolean;
  readonly session: MetronomeSessionState;
  readonly currentBeat: number | null;
  readonly remainingTimerSeconds: number | null;
}

export interface MetronomeAudioPort {
  readonly isPlaying: boolean;
  start(config: MetronomeConfig, timerSeconds: number | null): Promise<void>;
  update(config: MetronomeConfig, timerSeconds?: number | null): void;
  stop(): void;
  dispose(): void;
  setListeners(options: {
    onBeat: (event: ScheduledBeatEvent) => void;
    onStatus: (status: MetronomeAudioStatus) => void;
  }): void;
}

export interface MetronomeStoragePort {
  loadConfig(): MetronomeConfig;
  loadTrainer(): SpeedTrainerConfig;
  saveConfig(config: MetronomeConfig): void;
  saveTrainer(trainer: SpeedTrainerConfig): void;
}

function monotonicNow(): number {
  // performance.now() 不受系统时间校准影响，适合计算倒计时和点击间隔；老运行时
  // 没有 Performance API 时再退回 Date.now()，保证小程序仍能正常启动。
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

const EMPTY_STATE: MetronomeUiState = {
  config: normalizedConfig(DEFAULT_CONFIG),
  speedTrainer: normalizedTrainer(DEFAULT_SPEED_TRAINER),
  speedTrainerConfigured: false,
  speedTrainerBarProgress: 0,
  speedTrainerCompleted: false,
  session: 'stopped',
  currentBeat: null,
  remainingTimerSeconds: null,
};

/**
 * 节拍器 Model 只处理产品状态和时间线规则，音频采样与发声交给 WebAudio。
 * 页面只订阅不可变快照，因此不会直接触碰 wx API 或 AudioBuffer。
 */
export class MetronomeModel {
  private readonly audio: MetronomeAudioPort;
  private readonly storage: MetronomeStoragePort;
  private readonly tapTempo = new TapTempoTracker();
  private readonly listeners = new Set<(state: MetronomeUiState) => void>();
  private state: MetronomeUiState = EMPTY_STATE;
  private timerHandle: ReturnType<typeof setInterval> | null = null;
  private beatClearHandle: ReturnType<typeof setTimeout> | null = null;
  private countdownStartedAt: number | null = null;
  private countdownInitialSeconds: number | null = null;
  private configSaveHandle: ReturnType<typeof setTimeout> | null = null;
  private trainerSaveHandle: ReturnType<typeof setTimeout> | null = null;
  private configNeedsSave = false;
  private trainerNeedsSave = false;
  private trainerCompletedBars = 0;
  private trainerSawCurrentBar = false;
  private pauseRequested = false;
  private tapClockStartedAt = monotonicNow();
  // WebAudio 只把拍号和细分等结构配置延迟到下一小节，页面需要跟随这一边界同步显示。
  private pendingConfig: MetronomeConfig | null = null;
  private disposed = false;

  constructor(
    audio: MetronomeAudioPort = new WebAudioMetronome(),
    storage: MetronomeStoragePort = new MetronomeStorageService(),
  ) {
    this.audio = audio;
    this.storage = storage;
    this.audio.setListeners({
      onBeat: (event) => this.handleBeat(event),
      onStatus: (status) => this.handleStatus(status),
    });
  }

  get currentState(): MetronomeUiState {
    return this.state;
  }

  subscribe(listener: (state: MetronomeUiState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  initialize(): void {
    if (this.disposed) return;
    const config = this.storage.loadConfig();
    const trainer = this.storage.loadTrainer();
    this.setState({
      ...this.state,
      config,
      speedTrainer: trainer,
      speedTrainerConfigured: trainer.configured || trainer.enabled || trainer.startBpm !== 80 || trainer.targetBpm !== 120,
      remainingTimerSeconds: config.timerMinutes == null ? null : config.timerMinutes * 60,
    });
  }

  async togglePlayback(): Promise<void> {
    if (this.state.session === 'playing') {
      // 播放按钮是暂停：暂停需要保留倒计时和训练小节进度。
      this.pauseRequested = true;
      // 用户点击暂停的时刻可能落在两次 200ms 刷新之间，先用同一单调时钟
      // 校正一次，避免暂停后多保留一小段已经消耗的时间。
      this.refreshCountdown();
      this.stopCountdown();
      this.audio.stop();
      return;
    }
    const config = this.pendingConfig ?? this.state.config;
    if (this.pendingConfig !== null) {
      this.pendingConfig = null;
      this.setState({ ...this.state, config });
    }
    const timerSeconds = this.state.remainingTimerSeconds == null
      ? null
      : this.state.remainingTimerSeconds > 0
        ? this.state.remainingTimerSeconds
        : config.timerMinutes == null
          ? null
          : config.timerMinutes * 60;
    try {
      await this.audio.start(config, timerSeconds);
    } catch (_) {
      this.pauseRequested = false;
      if (!this.disposed) this.setState({ ...this.state, session: 'error' });
    }
  }

  stop(): void {
    this.pauseRequested = true;
    this.refreshCountdown();
    this.stopCountdown();
    this.audio.stop();
  }

  setBpm(bpm: number): void {
    this.disableTrainerForManualTempoChange();
    this.changeConfig({ bpm: clampInt(bpm, MINIMUM_BPM, MAXIMUM_BPM) });
  }

  adjustBpm(delta: number): void {
    this.setBpm(this.state.config.bpm + delta);
  }

  tap(): void {
    const bpm = this.tapTempo.addTap(monotonicNow() - this.tapClockStartedAt);
    if (bpm !== null) this.setBpm(bpm);
  }

  setTimeSignature(timeSignature: TimeSignature): void {
    if (!TIME_SIGNATURES.includes(timeSignature)) return;
    const count = numerator(timeSignature);
    const previous = (this.pendingConfig ?? this.state.config).beatStrengths;
    const beatStrengths = Array.from({ length: count }, (_, index) =>
      previous[index] ?? (index === 0 ? 'accent' : 'normal'),
    );
    this.changeConfig({ timeSignature, beatStrengths });
  }

  setSubdivision(subdivision: Subdivision): void {
    const base = this.pendingConfig ?? this.state.config;
    const beatSubdivisions = base.customSubdivisionEnabled
      ? base.beatSubdivisions
      : Array.from({ length: numerator(base.timeSignature) }, () => subdivision);
    this.changeConfig({ subdivision, beatSubdivisions });
  }

  /** 首次开启逐拍编辑时从当前统一细分展开；已有同拍数配置则继续保留。 */
  enableCustomSubdivision(): void {
    const base = this.pendingConfig ?? this.state.config;
    const count = numerator(base.timeSignature);
    const beatSubdivisions = base.beatSubdivisions.length === count
      ? base.beatSubdivisions.slice()
      : Array.from({ length: count }, (_, index) => subdivisionForBeat(base, index));
    this.changeConfig({
      customSubdivisionEnabled: true,
      beatSubdivisions,
    });
  }

  /** 关闭逐拍编辑只切回统一播放，不删除已经保存的逐拍配置。 */
  disableCustomSubdivision(): void {
    this.changeConfig({ customSubdivisionEnabled: false });
  }

  setBeatSubdivision(beatIndex: number, subdivision: Subdivision): void {
    const base = this.pendingConfig ?? this.state.config;
    const count = numerator(base.timeSignature);
    if (!base.customSubdivisionEnabled || beatIndex < 0 || beatIndex >= count) return;
    const beatSubdivisions = Array.from(
      { length: count },
      (_, index) => subdivisionForBeat(base, index),
    );
    beatSubdivisions[beatIndex] = subdivision;
    this.changeConfig({ beatSubdivisions });
  }

  /** 将当前选择的细分同步到整小节，并保留自定义模式开关状态。 */
  applySubdivisionToAll(subdivision: Subdivision): void {
    const base = this.pendingConfig ?? this.state.config;
    this.changeConfig({
      subdivision,
      beatSubdivisions: Array.from(
        { length: numerator(base.timeSignature) },
        () => subdivision,
      ),
    });
  }

  setSound(sound: MetronomeSound): void {
    this.changeConfig({ sound });
  }

  setTimerMinutes(minutes: number | null): void {
    this.changeConfig({ timerMinutes: minutes });
  }

  cycleBeatStrength(index: number): void {
    const config = this.pendingConfig ?? this.state.config;
    if (index < 0 || index >= config.beatStrengths.length) return;
    const current = config.beatStrengths[index];
    const nextIndex = (BEAT_STRENGTHS.indexOf(current) + 1) % BEAT_STRENGTHS.length;
    const beatStrengths = config.beatStrengths.slice();
    beatStrengths[index] = BEAT_STRENGTHS[nextIndex];
    this.changeConfig({ beatStrengths });
  }

  configureSpeedTrainer(values: Partial<SpeedTrainerConfig>): void {
    const trainer = normalizedTrainer({ ...this.state.speedTrainer, ...values, configured: true });
    this.trainerCompletedBars = 0;
    this.trainerSawCurrentBar = false;
    this.setState({
      ...this.state,
      speedTrainer: trainer,
      speedTrainerConfigured: true,
      speedTrainerBarProgress: 0,
      speedTrainerCompleted: false,
    });
    this.scheduleTrainerSave(trainer);
    if (trainer.enabled) this.changeConfig({ bpm: trainer.startBpm });
  }

  disableSpeedTrainer(): void {
    if (!this.state.speedTrainer.enabled) return;
    const trainer = { ...this.state.speedTrainer, enabled: false, configured: true };
    this.trainerCompletedBars = 0;
    this.trainerSawCurrentBar = false;
    this.setState({
      ...this.state,
      speedTrainer: trainer,
      speedTrainerBarProgress: 0,
      speedTrainerCompleted: false,
    });
    this.scheduleTrainerSave(trainer);
  }

  onHide(): void {
    // 小程序进入后台后不维持节拍会话；释放调度节点，回到前台时由用户重新点击。
    this.pauseRequested = true;
    this.refreshCountdown();
    this.stopCountdown();
    this.audio.stop();
    this.flushPendingSaves();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timerHandle !== null) clearInterval(this.timerHandle);
    if (this.beatClearHandle !== null) clearTimeout(this.beatClearHandle);
    if (this.configSaveHandle !== null) clearTimeout(this.configSaveHandle);
    if (this.trainerSaveHandle !== null) clearTimeout(this.trainerSaveHandle);
    this.timerHandle = null;
    this.configSaveHandle = null;
    this.trainerSaveHandle = null;
    this.countdownStartedAt = null;
    this.countdownInitialSeconds = null;
    // onHide 可能已经刷入待保存数据，销毁时只补刷仍未落盘的内容，避免切页时同步写两遍。
    this.flushPendingSaves();
    this.pendingConfig = null;
    this.audio.dispose();
    this.listeners.clear();
  }

  private changeConfig(patch: Partial<MetronomeConfig>): void {
    const baseConfig = this.pendingConfig ?? this.state.config;
    const timerChanged = patch.timerMinutes !== undefined &&
      patch.timerMinutes !== this.state.config.timerMinutes;
    const config = normalizedConfig({ ...baseConfig, ...patch });
    const strengthOnlyPatch = patch.beatStrengths !== undefined &&
      patch.timeSignature === undefined &&
      patch.subdivision === undefined;
    const deferStructure = this.audio.isPlaying &&
      this.state.session === 'playing' &&
      ((!strengthOnlyPatch && this.hasStructuralPatch(patch)) || this.pendingConfig !== null);
    const canShowImmediateStrengths = strengthOnlyPatch &&
      config.beatStrengths.length === this.state.config.beatStrengths.length;
    const visibleConfig = deferStructure
      ? normalizedConfig({
          ...this.state.config,
          bpm: config.bpm,
          sound: config.sound,
          timerMinutes: config.timerMinutes,
          ...(canShowImmediateStrengths ? { beatStrengths: config.beatStrengths } : {}),
        })
      : config;
    this.pendingConfig = deferStructure ? config : null;
    this.setState({ ...this.state, config: visibleConfig });
    const timerSeconds = config.timerMinutes == null ? null : config.timerMinutes * 60;
    // BPM、音色和强弱在下一拍调度时生效，拍号与细分在下一小节切换；配置变化不能
    // 把正在进行的倒计时重置回完整时长。
    if (this.audio.isPlaying) this.audio.update(config, timerChanged ? timerSeconds : undefined);
    this.scheduleConfigSave(config);
    if (timerChanged && config.timerMinutes == null) {
      this.stopCountdown();
    } else if (timerChanged && this.state.session === 'playing') {
      this.startCountdown(timerSeconds);
    } else if (timerChanged) {
      this.setState({ ...this.state, remainingTimerSeconds: timerSeconds });
    }
  }

  private handleBeat(event: ScheduledBeatEvent): void {
    if (this.disposed) return;
    if (
      this.pendingConfig !== null &&
      event.config !== undefined &&
      event.beatIndex === 0 &&
      event.subdivisionIndex === 0 &&
      this.sameStructure(event.config, this.pendingConfig)
    ) {
      // 只有确认音频时间线已经切到目标结构后才提交 UI 状态；这样切换拍号时，
      // 当前小节仍按旧拍号播放，下一小节开始时页面和声音同时变化。
      this.setState({ ...this.state, config: event.config });
      this.pendingConfig = null;
    }
    this.handleSpeedTrainerBeat(event);
    this.setState({
      ...this.state,
      currentBeat: event.beatIndex,
    });
    if (this.beatClearHandle !== null) clearTimeout(this.beatClearHandle);
    this.beatClearHandle = setTimeout(() => {
      this.beatClearHandle = null;
      if (!this.disposed) {
        this.setState({ ...this.state, currentBeat: null });
      }
    }, event.audibleDurationMs);
  }

  private handleSpeedTrainerBeat(event: ScheduledBeatEvent): void {
    const trainer = this.state.speedTrainer;
    if (!trainer.enabled || this.state.speedTrainerCompleted || event.subdivisionIndex !== 0 || event.beatIndex !== 0) {
      return;
    }
    if (!this.trainerSawCurrentBar) {
      this.trainerSawCurrentBar = true;
      return;
    }
    this.trainerCompletedBars += 1;
    const progress = this.trainerCompletedBars % trainer.barsPerStep;
    this.setState({ ...this.state, speedTrainerBarProgress: progress });
    if (progress !== 0) return;

    const direction = Math.sign(trainer.targetBpm - trainer.startBpm);
    const currentBpm = this.state.config.bpm;
    const reached = direction > 0
      ? currentBpm >= trainer.targetBpm
      : direction < 0
        ? currentBpm <= trainer.targetBpm
        : currentBpm === trainer.targetBpm;
    if (reached) {
      this.setState({ ...this.state, speedTrainerBarProgress: 0, speedTrainerCompleted: true });
      return;
    }
    if (direction === 0) return;
    const nextBpm = direction > 0
      ? Math.min(trainer.targetBpm, currentBpm + trainer.stepBpm)
      : Math.max(trainer.targetBpm, currentBpm - trainer.stepBpm);
    this.changeConfig({ bpm: nextBpm });
  }

  private handleStatus(status: MetronomeAudioStatus): void {
    if (this.disposed) return;
    const session: MetronomeSessionState = status;
    if (session === 'stopped') {
      if (this.pendingConfig !== null) {
        // 暂停或切后台会丢弃音频时间线；没有下一小节事件可以提交时，停止瞬间
        // 直接采用用户最后一次选择，保证恢复播放不会退回旧结构。
        const config = this.pendingConfig;
        this.pendingConfig = null;
        this.setState({ ...this.state, config });
      }
      if (this.pauseRequested) this.refreshCountdown();
      // 停止可能发生在小节中途，恢复后必须从新的第 1 拍重新确认小节边界，
      // 但已完成的小节计数仍保留，确保暂停不会让训练进度倒退或多算一档。
      this.trainerSawCurrentBar = false;
      const timerEnded = !this.pauseRequested &&
        this.state.config.timerMinutes != null &&
        // 音频时钟与 JS 倒计时不是同一个时钟，停止事件到达时 UI 可能还显示最后 1 秒；
        // 只要没有暂停请求，就把这一小段误差视为自然结束，恢复完整计时状态。
        this.state.remainingTimerSeconds !== null &&
        this.state.remainingTimerSeconds <= 1;
      if (timerEnded) {
        this.trainerCompletedBars = 0;
        this.trainerSawCurrentBar = false;
        this.setState({
          ...this.state,
          session,
          currentBeat: null,
          remainingTimerSeconds: this.state.config.timerMinutes == null
            ? null
            : this.state.config.timerMinutes * 60,
          speedTrainerBarProgress: 0,
          speedTrainerCompleted: false,
        });
        if (this.state.speedTrainer.enabled) {
          this.changeConfig({ bpm: this.state.speedTrainer.startBpm });
        }
      } else {
        this.setState({
          ...this.state,
          session,
          currentBeat: null,
        });
      }
      this.pauseRequested = false;
      this.stopCountdown();
      return;
    }
    this.setState({ ...this.state, session });
    if (session === 'playing') {
      // 新会话无论是首次播放、暂停后续播还是中断后恢复，都必须清除上一次
      // 手动暂停/切后台留下的标记，否则自然结束会被误判成“暂停停止”。
      this.pauseRequested = false;
      this.startCountdown(this.state.remainingTimerSeconds ?? (
        this.state.config.timerMinutes == null ? null : this.state.config.timerMinutes * 60
      ));
    } else if (session === 'interrupted' || session === 'error') {
      if (this.beatClearHandle !== null) clearTimeout(this.beatClearHandle);
      this.beatClearHandle = null;
      this.trainerSawCurrentBar = false;
      this.refreshCountdown();
      this.stopCountdown();
      this.setState({ ...this.state, currentBeat: null });
    }
  }

  private startCountdown(seconds: number | null): void {
    this.stopCountdown();
    if (seconds == null) {
      this.setState({ ...this.state, remainingTimerSeconds: null });
      return;
    }
    const initialSeconds = Math.max(0, Math.round(seconds));
    this.countdownStartedAt = monotonicNow();
    this.countdownInitialSeconds = initialSeconds;
    this.setState({ ...this.state, remainingTimerSeconds: initialSeconds });
    this.timerHandle = setInterval(() => {
      this.refreshCountdown();
    }, 200);
  }

  private refreshCountdown(): void {
    const startedAt = this.countdownStartedAt;
    const initialSeconds = this.countdownInitialSeconds;
    if (startedAt === null || initialSeconds === null) return;
    const remaining = Math.max(
      0,
      Math.ceil(initialSeconds - (monotonicNow() - startedAt) / 1000),
    );
    this.setState({ ...this.state, remainingTimerSeconds: remaining });
    if (remaining === 0) this.stopCountdown();
  }

  private stopCountdown(): void {
    if (this.timerHandle !== null) clearInterval(this.timerHandle);
    this.timerHandle = null;
    this.countdownStartedAt = null;
    this.countdownInitialSeconds = null;
    if (this.state.config.timerMinutes == null) {
      this.setState({ ...this.state, remainingTimerSeconds: null });
    }
  }

  private scheduleConfigSave(config: MetronomeConfig): void {
    if (this.configSaveHandle !== null) clearTimeout(this.configSaveHandle);
    this.configNeedsSave = true;
    // 旋钮拖动会在短时间内产生很多整数 BPM，延迟写入可避免同步存储抢占
    // 调度器所在的 JS 线程；dispose() 会立即刷入最后一份配置。
    this.configSaveHandle = setTimeout(() => {
      this.configSaveHandle = null;
      if (!this.disposed) {
        this.storage.saveConfig(config);
        this.configNeedsSave = false;
      }
    }, 250);
  }

  private scheduleTrainerSave(trainer: SpeedTrainerConfig): void {
    if (this.trainerSaveHandle !== null) clearTimeout(this.trainerSaveHandle);
    this.trainerNeedsSave = true;
    this.trainerSaveHandle = setTimeout(() => {
      this.trainerSaveHandle = null;
      if (!this.disposed) {
        this.storage.saveTrainer(trainer);
        this.trainerNeedsSave = false;
      }
    }, 250);
  }

  private flushPendingSaves(): void {
    if (this.configSaveHandle !== null) clearTimeout(this.configSaveHandle);
    if (this.trainerSaveHandle !== null) clearTimeout(this.trainerSaveHandle);
    this.configSaveHandle = null;
    this.trainerSaveHandle = null;
    if (this.configNeedsSave) {
      this.storage.saveConfig(this.pendingConfig ?? this.state.config);
      this.configNeedsSave = false;
    }
    if (this.trainerNeedsSave) {
      this.storage.saveTrainer(this.state.speedTrainer);
      this.trainerNeedsSave = false;
    }
  }

  private hasStructuralPatch(patch: Partial<MetronomeConfig>): boolean {
    return patch.timeSignature !== undefined ||
      patch.subdivision !== undefined ||
      patch.customSubdivisionEnabled !== undefined ||
      patch.beatSubdivisions !== undefined ||
      patch.beatStrengths !== undefined;
  }

  private sameStructure(left: MetronomeConfig, right: MetronomeConfig): boolean {
    return left.timeSignature === right.timeSignature &&
      left.subdivision === right.subdivision &&
      left.customSubdivisionEnabled === right.customSubdivisionEnabled &&
      left.beatSubdivisions.length === right.beatSubdivisions.length &&
      left.beatSubdivisions.every((subdivision, index) =>
        subdivision === right.beatSubdivisions[index],
      ) &&
      left.beatStrengths.length === right.beatStrengths.length &&
      left.beatStrengths.every((strength, index) => strength === right.beatStrengths[index]);
  }

  private disableTrainerForManualTempoChange(): void {
    if (this.state.speedTrainer.enabled) this.disableSpeedTrainer();
  }

  private setState(next: MetronomeUiState): void {
    if (this.disposed) return;
    this.state = next;
    for (const listener of this.listeners) listener(this.state);
  }
}
