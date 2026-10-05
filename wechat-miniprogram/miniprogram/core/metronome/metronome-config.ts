export const MINIMUM_BPM = 20;
export const MAXIMUM_BPM = 300;
export const MAXIMUM_TIMER_MINUTES = 60;

export type TimeSignature =
  | '2/2'
  | '2/4'
  | '3/4'
  | '4/4'
  | '5/4'
  | '6/8'
  | '7/8'
  | '9/8'
  | '12/8';

export const TIME_SIGNATURES: readonly TimeSignature[] = [
  '2/2',
  '2/4',
  '3/4',
  '4/4',
  '5/4',
  '6/8',
  '7/8',
  '9/8',
  '12/8',
];

export type Subdivision =
  | 'quarter'
  | 'eighth'
  | 'triplet'
  | 'sixteenth'
  | 'eighth-rest-note'
  | 'triplet-rest-note-note'
  | 'triplet-note-rest-note'
  | 'triplet-note-note-rest';

export const SUBDIVISIONS: readonly Subdivision[] = [
  'quarter',
  'eighth',
  'triplet',
  'sixteenth',
  'eighth-rest-note',
  'triplet-rest-note-note',
  'triplet-note-rest-note',
  'triplet-note-note-rest',
];

export type MetronomeSound =
  | 'mechanical'
  | 'electronic'
  | 'drums'
  | 'cowbell'
  | 'clapper';

export const SOUNDS: readonly MetronomeSound[] = [
  'drums',
  'mechanical',
  'electronic',
  'cowbell',
  'clapper',
];

export type BeatStrength = 'accent' | 'secondary' | 'normal' | 'muted';

export const BEAT_STRENGTHS: readonly BeatStrength[] = [
  'accent',
  'secondary',
  'normal',
  'muted',
];

export interface MetronomeConfig {
  bpm: number;
  timeSignature: TimeSignature;
  subdivision: Subdivision;
  /** 是否启用逐拍细分；关闭时所有拍子使用 subdivision。 */
  customSubdivisionEnabled: boolean;
  /** 每拍的细分覆盖值，长度不足时回退到 subdivision。 */
  beatSubdivisions: Subdivision[];
  sound: MetronomeSound;
  timerMinutes: number | null;
  beatStrengths: BeatStrength[];
}

export const DEFAULT_CONFIG: MetronomeConfig = {
  bpm: 120,
  timeSignature: '4/4',
  subdivision: 'quarter',
  customSubdivisionEnabled: false,
  beatSubdivisions: [],
  sound: 'mechanical',
  timerMinutes: null,
  beatStrengths: ['accent', 'secondary', 'normal', 'muted'],
};

export function subdivisionForBeat(
  config: Pick<MetronomeConfig, 'subdivision' | 'customSubdivisionEnabled' | 'beatSubdivisions'>,
  beatIndex: number,
): Subdivision {
  if (
    !config.customSubdivisionEnabled ||
    beatIndex < 0 ||
    beatIndex >= config.beatSubdivisions.length
  ) {
    return config.subdivision;
  }
  return config.beatSubdivisions[beatIndex];
}

export interface SpeedTrainerConfig {
  enabled: boolean;
  configured: boolean;
  startBpm: number;
  targetBpm: number;
  stepBpm: number;
  barsPerStep: number;
}

export const DEFAULT_SPEED_TRAINER: SpeedTrainerConfig = {
  enabled: false,
  configured: false,
  startBpm: 80,
  targetBpm: 120,
  stepBpm: 1,
  barsPerStep: 1,
};

export function numerator(signature: TimeSignature): number {
  return Number(signature.split('/')[0]);
}

export function denominator(signature: TimeSignature): number {
  return Number(signature.split('/')[1]);
}

export function partsPerBeat(subdivision: Subdivision): number {
  switch (subdivision) {
    case 'quarter':
      return 1;
    case 'eighth':
    case 'eighth-rest-note':
      return 2;
    case 'triplet':
    case 'triplet-rest-note-note':
    case 'triplet-note-rest-note':
    case 'triplet-note-note-rest':
      return 3;
    case 'sixteenth':
      return 4;
  }
}

export function restMask(subdivision: Subdivision): number {
  switch (subdivision) {
    case 'eighth-rest-note':
      return 1;
    case 'triplet-rest-note-note':
      return 1;
    case 'triplet-note-rest-note':
      return 2;
    case 'triplet-note-note-rest':
      return 4;
    default:
      return 0;
  }
}

export function isRestAt(subdivision: Subdivision, index: number): boolean {
  return (restMask(subdivision) & (1 << index)) !== 0;
}

/**
 * 四分音符 BPM 先换算成当前拍号的一拍，再按细分数量计算实际间隔。
 * 这样 6/8、9/8 等拍号的节拍长度与产品定义保持一致。
 */
export function subdivisionDurationSeconds(config: MetronomeConfig, beatIndex = 0): number {
  return beatDurationSeconds(config) /
    partsPerBeat(subdivisionForBeat(config, beatIndex));
}

/**
 * 返回当前拍号下一拍的完整时长，摆锤和音频时间轴必须共用这套换算。
 * 例如 6/8 的一拍是八分音符拍，因此相对 4/4 要乘以 4/8，不能只使用
 * 四分音符 BPM 的 60/BPM，否则视觉摆动会与实际节拍错位。
 */
export function beatDurationSeconds(
  config: Pick<MetronomeConfig, 'bpm' | 'timeSignature'>,
): number {
  return (60 / config.bpm) * 4 / denominator(config.timeSignature);
}

export function normalizedConfig(input: Partial<MetronomeConfig>): MetronomeConfig {
  const source = { ...DEFAULT_CONFIG, ...input };
  // 持久化数据来自运行时边界，先归一化拍号再计算节拍列数量，避免无效字符串
  // 经过 Number 后得到 NaN，最终让页面渲染出空的节拍面板。
  const timeSignature = TIME_SIGNATURES.includes(source.timeSignature)
    ? source.timeSignature
    : DEFAULT_CONFIG.timeSignature;
  const count = numerator(timeSignature);
  const subdivision = SUBDIVISIONS.includes(source.subdivision)
    ? source.subdivision
    : DEFAULT_CONFIG.subdivision;
  const customSubdivisionEnabled = source.customSubdivisionEnabled === true;
  const storedBeatSubdivisions = Array.isArray(source.beatSubdivisions)
    ? source.beatSubdivisions
    : [];
  const beatSubdivisions = customSubdivisionEnabled
    ? Array.from({ length: count }, (_, index) => {
        const value = storedBeatSubdivisions[index];
        return value !== undefined && SUBDIVISIONS.includes(value)
          ? value
          : subdivision;
      })
    : storedBeatSubdivisions.filter((value): value is Subdivision =>
        SUBDIVISIONS.includes(value),
      );
  const strengths = Array.from({ length: count }, (_, index) => {
    const existing = Array.isArray(source.beatStrengths)
      ? source.beatStrengths[index]
      : undefined;
    return existing !== undefined && BEAT_STRENGTHS.includes(existing)
      ? existing
      : index === 0
        ? 'accent'
        : 'normal';
  });
  return {
    bpm: clampInt(source.bpm, MINIMUM_BPM, MAXIMUM_BPM),
    timeSignature,
    subdivision,
    customSubdivisionEnabled,
    beatSubdivisions,
    sound: SOUNDS.includes(source.sound) ? source.sound : DEFAULT_CONFIG.sound,
    timerMinutes:
      source.timerMinutes == null
        ? null
        : clampInt(source.timerMinutes, 1, MAXIMUM_TIMER_MINUTES),
    beatStrengths: strengths,
  };
}

export function normalizedTrainer(
  input: Partial<SpeedTrainerConfig>,
): SpeedTrainerConfig {
  const source = { ...DEFAULT_SPEED_TRAINER, ...input };
  return {
    enabled: source.enabled === true,
    configured: source.configured === true,
    startBpm: clampInt(source.startBpm, MINIMUM_BPM, MAXIMUM_BPM),
    targetBpm: clampInt(source.targetBpm, MINIMUM_BPM, MAXIMUM_BPM),
    stepBpm: clampInt(source.stepBpm, 1, 50),
    barsPerStep: clampInt(source.barsPerStep, 1, 32),
  };
}

export function clampInt(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) return minimum;
  return Math.round(Math.min(maximum, Math.max(minimum, value)));
}

export function strengthLabel(strength: BeatStrength): string {
  switch (strength) {
    case 'accent':
      return '重音';
    case 'secondary':
      return '次重音';
    case 'normal':
      return '普通';
    case 'muted':
      return '静音';
  }
}

export function subdivisionLabel(subdivision: Subdivision): string {
  switch (subdivision) {
    case 'quarter':
      return '四分';
    case 'eighth':
      return '八分';
    case 'triplet':
      return '三连音';
    case 'sixteenth':
      return '十六分';
    case 'eighth-rest-note':
      return '八分休止';
    case 'triplet-rest-note-note':
      return '三连音·休止';
    case 'triplet-note-rest-note':
      return '三连音·中休';
    case 'triplet-note-note-rest':
      return '三连音·尾休';
  }
}

export function soundLabel(sound: MetronomeSound): string {
  switch (sound) {
    case 'mechanical':
      return '机械';
    case 'electronic':
      return '电子';
    case 'drums':
      return '鼓组';
    case 'cowbell':
      return '牛铃';
    case 'clapper':
      return '快板';
  }
}
