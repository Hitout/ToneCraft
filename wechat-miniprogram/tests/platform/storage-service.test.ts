import { afterEach, describe, expect, it, vi } from 'vitest';
import { MetronomeStorageService } from '../../miniprogram/platform/storage-service';
import { Subdivision, normalizedConfig } from '../../miniprogram/core/metronome/metronome-config';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MetronomeStorageService', () => {
  it('新增节奏的统一值和逐拍覆盖可以完整保存恢复', () => {
    const values = new Map<string, unknown>();
    vi.stubGlobal('wx', {
      getStorageSync: (key: string) => values.get(key),
      setStorageSync: (key: string, value: unknown) => values.set(key, value),
    });
    const rhythms: Subdivision[] = [
      'dotted-eighth-sixteenth', 'sixteenth-dotted-eighth',
      'eighth-sixteenth-sixteenth', 'sixteenth-sixteenth-eighth',
      'sixteenth-eighth-sixteenth',
      'eighth-note-rest', 'sixteenth-rest-note-note-note',
      'eighth-rest-sixteenth-sixteenth', 'sixteenth-sixteenth-eighth-rest',
      'sixteenth-note-note-rest-note', 'sixteenth-eighth-rest-sixteenth',
      'sixteenth-rest-note-note-rest',
    ];
    const service = new MetronomeStorageService();
    for (const subdivision of rhythms) {
      const config = normalizedConfig({
        timeSignature: '12/8', subdivision, customSubdivisionEnabled: true,
        beatSubdivisions: rhythms,
      });
      service.saveConfig(config);
      expect(service.loadConfig()).toEqual(config);
    }
  });

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
