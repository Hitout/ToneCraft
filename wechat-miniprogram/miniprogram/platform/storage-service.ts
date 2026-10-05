import {
  DEFAULT_CONFIG,
  DEFAULT_SPEED_TRAINER,
  MetronomeConfig,
  SpeedTrainerConfig,
  normalizedConfig,
  normalizedTrainer,
} from '../core/metronome/metronome-config';

const CONFIG_KEY = 'tonecraft.metronome.config';
const TRAINER_KEY = 'tonecraft.metronome.trainer';

interface StorageApi {
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
}

function storageApi(): StorageApi {
  return wx as unknown as StorageApi;
}

/**
 * 配置只保存可恢复的用户偏好，不保存播放中的拍点、剩余秒数或音频上下文。
 * 这样小程序重新进入前台时不会误把旧会话当成仍在播放。
 */
export class MetronomeStorageService {
  loadConfig(): MetronomeConfig {
    try {
      const value = storageApi().getStorageSync(CONFIG_KEY);
      return normalizedConfig(
        value && typeof value === 'object'
          ? (value as Partial<MetronomeConfig>)
          : DEFAULT_CONFIG,
      );
    } catch (_) {
      return normalizedConfig(DEFAULT_CONFIG);
    }
  }

  loadTrainer(): SpeedTrainerConfig {
    try {
      const value = storageApi().getStorageSync(TRAINER_KEY);
      const source = value && typeof value === 'object'
        ? (value as Partial<SpeedTrainerConfig>)
        : DEFAULT_SPEED_TRAINER;
      // 只保存训练参数和“已经配置过”标记，不恢复上次是否正在训练；
      // 播放会话不能跨页面/进程复活，避免重新打开小程序后误改当前 BPM。
      return normalizedTrainer({ ...source, enabled: false });
    } catch (_) {
      return normalizedTrainer(DEFAULT_SPEED_TRAINER);
    }
  }

  saveConfig(config: MetronomeConfig): void {
    storageApi().setStorageSync(CONFIG_KEY, normalizedConfig(config));
  }

  saveTrainer(trainer: SpeedTrainerConfig): void {
    const normalized = normalizedTrainer(trainer);
    // enabled 是当前会话状态，不属于可恢复偏好；只写入训练参数与配置标记。
    storageApi().setStorageSync(TRAINER_KEY, {
      configured: normalized.configured,
      startBpm: normalized.startBpm,
      targetBpm: normalized.targetBpm,
      stepBpm: normalized.stepBpm,
      barsPerStep: normalized.barsPerStep,
    });
  }
}
