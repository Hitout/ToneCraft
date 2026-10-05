import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SPEED_TRAINER,
  MetronomeConfig,
  normalizedConfig,
  normalizedTrainer,
  SpeedTrainerConfig,
} from '../../miniprogram/core/metronome/metronome-config';
import {
  MetronomeAudioPort,
  MetronomeModel,
  MetronomeStoragePort,
} from '../../miniprogram/core/metronome/metronome-model';
import {
  MetronomeAudioStatus,
  ScheduledBeatEvent,
} from '../../miniprogram/platform/web-audio/web-audio-metronome';

class FakeAudio implements MetronomeAudioPort {
  isPlaying = false;
  updates: Array<{ config: MetronomeConfig; timerSeconds: number | undefined }> = [];
  private listeners: {
    onBeat: (event: ScheduledBeatEvent) => void;
    onStatus: (status: MetronomeAudioStatus) => void;
  } | null = null;

  setListeners(listeners: {
    onBeat: (event: ScheduledBeatEvent) => void;
    onStatus: (status: MetronomeAudioStatus) => void;
  }): void {
    this.listeners = listeners;
  }

  async start(): Promise<void> {
    this.isPlaying = true;
    this.listeners?.onStatus('playing');
  }

  update(config: MetronomeConfig, timerSeconds?: number | null): void {
    this.updates.push({
      config,
      timerSeconds: timerSeconds === null ? undefined : timerSeconds,
    });
  }

  stop(): void {
    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    if (wasPlaying) this.listeners?.onStatus('stopped');
  }

  emitBeat(event: ScheduledBeatEvent): void {
    this.listeners?.onBeat(event);
  }

  dispose(): void {
    this.isPlaying = false;
  }
}

class FakeStorage implements MetronomeStoragePort {
  config = normalizedConfig({ timerMinutes: 1 });
  trainer = normalizedTrainer(DEFAULT_SPEED_TRAINER);

  loadConfig(): MetronomeConfig {
    return this.config;
  }

  loadTrainer(): SpeedTrainerConfig {
    return this.trainer;
  }

  saveConfig(config: MetronomeConfig): void {
    this.config = config;
  }

  saveTrainer(trainer: SpeedTrainerConfig): void {
    this.trainer = trainer;
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('MetronomeModel', () => {
  it('逐拍细分从统一值展开并可重置', async () => {
    const audio = new FakeAudio();
    const storage = new FakeStorage();
    const model = new MetronomeModel(audio, storage);
    model.initialize();

    model.enableCustomSubdivision();
    expect(model.currentState.config.beatSubdivisions).toEqual([
      'quarter',
      'quarter',
      'quarter',
      'quarter',
    ]);

    model.setBeatSubdivision(1, 'triplet-note-rest-note');
    expect(model.currentState.config.beatSubdivisions[1]).toBe('triplet-note-rest-note');

    model.applySubdivisionToAll('eighth');
    expect(model.currentState.config.beatSubdivisions).toEqual([
      'eighth',
      'eighth',
      'eighth',
      'eighth',
    ]);

    model.disableCustomSubdivision();
    model.setSubdivision('triplet');
    model.enableCustomSubdivision();
    expect(model.currentState.config.beatSubdivisions).toEqual([
      'triplet',
      'triplet',
      'triplet',
      'triplet',
    ]);
    model.dispose();
  });

  it('播放中修改 BPM 不会重置倒计时', async () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    const model = new MetronomeModel(audio, new FakeStorage());
    model.initialize();

    await model.togglePlayback();
    vi.advanceTimersByTime(3000);
    expect(model.currentState.remainingTimerSeconds).toBe(57);

    model.setBpm(140);

    expect(model.currentState.remainingTimerSeconds).toBe(57);
    expect(audio.updates.at(-1)?.config.bpm).toBe(140);
    expect(audio.updates.at(-1)?.timerSeconds).toBeUndefined();
    model.dispose();
  });

  it('播放中修改拍号时，页面在音频切到下一小节后同步更新', async () => {
    const audio = new FakeAudio();
    const storage = new FakeStorage();
    const model = new MetronomeModel(audio, storage);
    model.initialize();

    await model.togglePlayback();
    const activeConfig = model.currentState.config;
    model.setTimeSignature('3/4');
    const pendingConfig = audio.updates.at(-1)?.config;

    expect(pendingConfig?.timeSignature).toBe('3/4');
    expect(model.currentState.config.timeSignature).toBe('4/4');

    const beat = (config: MetronomeConfig, beatIndex: number): ScheduledBeatEvent => ({
      at: beatIndex,
      beatIndex,
      subdivisionIndex: 0,
      config,
      strength: 'accent',
      sound: 'mechanical',
      audible: true,
      audibleDurationMs: 24,
    });
    audio.emitBeat(beat(activeConfig, 1));
    expect(model.currentState.config.timeSignature).toBe('4/4');

    audio.emitBeat(beat(pendingConfig!, 0));
    expect(model.currentState.config.timeSignature).toBe('3/4');
    model.dispose();
  });

  it('播放中调整重音时，方块和音频配置立即更新', async () => {
    const audio = new FakeAudio();
    const model = new MetronomeModel(audio, new FakeStorage());
    model.initialize();

    await model.togglePlayback();
    const activeConfig = model.currentState.config;
    model.cycleBeatStrength(0);
    const updatedConfig = audio.updates.at(-1)?.config;

    expect(model.currentState.config.beatStrengths[0]).toBe('secondary');
    expect(updatedConfig?.beatStrengths[0]).toBe('secondary');
    expect(model.currentState.config.timeSignature).toBe(activeConfig.timeSignature);

    audio.emitBeat({
      at: 0,
      beatIndex: 0,
      subdivisionIndex: 0,
      config: updatedConfig,
      strength: 'accent',
      sound: 'mechanical',
      audible: true,
      audibleDurationMs: 24,
    });
    expect(model.currentState.config.beatStrengths[0]).toBe('secondary');
    model.dispose();
  });

  it('短按暂停会保留剩余倒计时', async () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    const model = new MetronomeModel(audio, new FakeStorage());
    model.initialize();

    await model.togglePlayback();
    vi.advanceTimersByTime(2000);
    await model.togglePlayback();

    expect(model.currentState.session).toBe('stopped');
    expect(model.currentState.remainingTimerSeconds).toBe(58);
    model.dispose();
  });

  it('暂停时按单调时钟校正倒计时，不受系统时间跳变影响', async () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    const model = new MetronomeModel(audio, new FakeStorage());
    model.initialize();

    await model.togglePlayback();
    vi.advanceTimersByTime(2800);
    // 系统时间向前跳变不应被误认为真实经过了更多播放时间。
    vi.setSystemTime(Date.now() + 250);
    await model.togglePlayback();

    expect(model.currentState.remainingTimerSeconds).toBe(58);
    model.dispose();
  });

  it('连续修改配置时防抖保存，并在销毁时刷入最后值', () => {
    vi.useFakeTimers();
    const storage = new FakeStorage();
    const model = new MetronomeModel(new FakeAudio(), storage);
    model.initialize();

    model.setBpm(140);
    expect(storage.config.bpm).toBe(120);
    vi.advanceTimersByTime(249);
    expect(storage.config.bpm).toBe(120);
    vi.advanceTimersByTime(1);
    expect(storage.config.bpm).toBe(140);

    model.setBpm(160);
    model.dispose();
    expect(storage.config.bpm).toBe(160);
  });

  it('进入后台时立即保存防抖中的配置', () => {
    vi.useFakeTimers();
    const storage = new FakeStorage();
    const model = new MetronomeModel(new FakeAudio(), storage);
    model.initialize();

    model.setBpm(150);
    model.onHide();

    expect(storage.config.bpm).toBe(150);
    model.dispose();
  });

  it('训练暂停后不会把恢复播放的半个小节计入进度', async () => {
    vi.useFakeTimers();
    const audio = new FakeAudio();
    const model = new MetronomeModel(audio, new FakeStorage());
    model.initialize();
    model.configureSpeedTrainer({
      enabled: true,
      startBpm: 80,
      targetBpm: 82,
      stepBpm: 1,
      barsPerStep: 1,
    });

    await model.togglePlayback();
    const beat = (beatIndex: number): ScheduledBeatEvent => ({
      at: beatIndex,
      beatIndex: 0,
      subdivisionIndex: 0,
      strength: 'accent',
      sound: 'mechanical',
      audible: true,
      audibleDurationMs: 24,
    });
    audio.emitBeat(beat(0));
    await model.togglePlayback();
    await model.togglePlayback();
    audio.emitBeat(beat(1));

    expect(model.currentState.config.bpm).toBe(80);
    expect(model.currentState.speedTrainerBarProgress).toBe(0);
    model.dispose();
  });
});
