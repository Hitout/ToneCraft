import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetronomeStorageService } from '../../miniprogram/platform/storage-service';
import { normalizedConfig } from '../../miniprogram/core/metronome/metronome-config';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MetronomeStorageService', () => {
  it('保存并恢复逐拍细分配置', () => {
    const values = new Map<string, unknown>();
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => values.get(key),
      setStorageSync: (key: string, value: unknown) => values.set(key, value),
    });

    const service = new MetronomeStorageService();
    const config = normalizedConfig({
      timeSignature: '4/4',
      subdivision: 'eighth',
      customSubdivisionEnabled: true,
      beatSubdivisions: ['quarter', 'triplet', 'sixteenth', 'eighth-rest-note'],
    });
    service.saveConfig(config);

    expect(service.loadConfig()).toEqual(config);
  });

  it('只恢复速度训练参数，不恢复上次的启用状态', () => {
    const values = new Map<string, unknown>();
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => values.get(key),
      setStorageSync: (key: string, value: unknown) => values.set(key, value),
    });

    const service = new MetronomeStorageService();
    service.saveTrainer({
      enabled: true,
      configured: true,
      startBpm: 139,
      targetBpm: 159,
      stepBpm: 2,
      barsPerStep: 4,
    });

    expect(values.get('tonecraft.metronome.trainer')).toEqual({
      configured: true,
      startBpm: 139,
      targetBpm: 159,
      stepBpm: 2,
      barsPerStep: 4,
    });
    expect(service.loadTrainer()).toEqual({
      enabled: false,
      configured: true,
      startBpm: 139,
      targetBpm: 159,
      stepBpm: 2,
      barsPerStep: 4,
    });
  });
});
