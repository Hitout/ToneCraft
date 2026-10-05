export type InstrumentId = 'guitar' | 'ukulele' | 'bass' | 'violin' | 'generic';

export type TuningPresetId =
  | 'standard'
  | 'guitarHalfStepDown'
  | 'guitarWholeStepDown'
  | 'dadgad'
  | 'dropD'
  | 'chromatic'
  | 'ukuleleStandard'
  | 'ukuleleLowG'
  | 'bassStandard'
  | 'bassHalfStepDown'
  | 'bassDropD'
  | 'violinStandard'
  | 'violinHalfStepDown'
  | 'violinCrossA'
  | 'violinCrossG';

export interface TuningTarget {
  readonly noteName: string;
  readonly octave: number;
  readonly midiNote: number;
  readonly frequencyHz: number;
}

export interface TuningPreset {
  readonly id: TuningPresetId;
  readonly targets: readonly TuningTarget[];
  readonly isChromatic: boolean;
}

export interface TunerReading {
  readonly noteName: string;
  readonly octave: number;
  readonly frequencyHz: number;
  readonly targetFrequencyHz: number;
  readonly cents: number;
  readonly confidence: number;
  readonly targetIndex: number | null;
}

export const INSTRUMENTS: readonly InstrumentId[] = [
  'guitar',
  'ukulele',
  'bass',
  'violin',
  'generic',
];

const PRESETS_BY_INSTRUMENT: Readonly<Record<InstrumentId, readonly TuningPresetId[]>> = {
  guitar: ['standard', 'guitarHalfStepDown', 'guitarWholeStepDown', 'dadgad', 'dropD'],
  ukulele: ['ukuleleStandard', 'ukuleleLowG'],
  bass: ['bassStandard', 'bassHalfStepDown', 'bassDropD'],
  violin: ['violinStandard', 'violinHalfStepDown', 'violinCrossA', 'violinCrossG'],
  generic: ['chromatic'],
};

const MIDI_NOTES: Readonly<Partial<Record<TuningPresetId, readonly number[]>>> = {
  standard: [40, 45, 50, 55, 59, 64],
  guitarHalfStepDown: [39, 44, 49, 54, 58, 63],
  guitarWholeStepDown: [38, 43, 48, 53, 57, 62],
  dadgad: [38, 45, 50, 55, 57, 62],
  dropD: [38, 45, 50, 55, 59, 64],
  ukuleleStandard: [67, 60, 64, 69],
  ukuleleLowG: [55, 60, 64, 69],
  bassStandard: [28, 33, 38, 43],
  bassHalfStepDown: [27, 32, 37, 42],
  bassDropD: [26, 33, 38, 43],
  violinStandard: [55, 62, 69, 76],
  violinHalfStepDown: [54, 61, 68, 75],
  violinCrossA: [57, 64, 69, 76],
  violinCrossG: [55, 62, 67, 74],
};

const NOTE_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const;

export function presetsForInstrument(instrument: InstrumentId): readonly TuningPresetId[] {
  return PRESETS_BY_INSTRUMENT[instrument];
}

export function defaultPresetForInstrument(instrument: InstrumentId): TuningPresetId {
  return PRESETS_BY_INSTRUMENT[instrument][0];
}

export function targetFromMidi(midiNote: number, referenceA4Hz = 440): TuningTarget {
  return {
    noteName: NOTE_NAMES[((midiNote % 12) + 12) % 12],
    octave: Math.floor(midiNote / 12) - 1,
    midiNote,
    frequencyHz: referenceA4Hz * 2 ** ((midiNote - 69) / 12),
  };
}

export function tuningPreset(id: TuningPresetId, referenceA4Hz = 440): TuningPreset {
  if (id === 'chromatic') return { id, targets: [], isChromatic: true };
  const midiNotes = MIDI_NOTES[id];
  if (midiNotes === undefined) throw new Error(`未知调弦预设：${id}`);
  return {
    id,
    targets: midiNotes.map((midiNote) => targetFromMidi(midiNote, referenceA4Hz)),
    isChromatic: false,
  };
}

export function centsBetween(frequencyHz: number, targetFrequencyHz: number): number {
  return 1200 * Math.log2(frequencyHz / targetFrequencyHz);
}

/**
 * 将检测到的频率映射到当前预设的目标弦或最近半音。
 * 手动模式传入 lockedTargetIndex 后始终锁定该弦，禁止识别结果跳转到其他弦。
 */
export function mapFrequency(
  frequencyHz: number,
  confidence: number,
  preset: TuningPreset,
  lockedTargetIndex: number | null = null,
): TunerReading {
  let target: TuningTarget;
  let targetIndex: number | null = null;
  if (lockedTargetIndex !== null) {
    if (preset.isChromatic || lockedTargetIndex < 0 || lockedTargetIndex >= preset.targets.length) {
      throw new RangeError('手动选择的弦不属于当前调弦预设');
    }
    targetIndex = lockedTargetIndex;
    target = preset.targets[lockedTargetIndex];
  } else if (preset.isChromatic) {
    const midiNote = Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(frequencyHz / 440))));
    target = targetFromMidi(midiNote);
  } else {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    preset.targets.forEach((candidate, index) => {
      const distance = Math.abs(centsBetween(frequencyHz, candidate.frequencyHz));
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    targetIndex = bestIndex;
    target = preset.targets[bestIndex];
  }

  return {
    noteName: target.noteName,
    octave: target.octave,
    frequencyHz,
    targetFrequencyHz: target.frequencyHz,
    cents: Math.max(-50, Math.min(50, centsBetween(frequencyHz, target.frequencyHz))),
    confidence,
    targetIndex,
  };
}

export function readingColor(cents: number): string {
  const distance = Math.abs(cents);
  if (distance <= 3) return '#72e85c';
  if (distance <= 22) {
    return blendHex('#72e85c', '#ff9b43', (distance - 3) / 19);
  }
  return blendHex('#ff9b43', '#fe0301', Math.min(1, (distance - 22) / 28));
}

function blendHex(start: string, end: string, amount: number): string {
  const clamped = Math.max(0, Math.min(1, amount));
  const startValue = start.replace('#', '');
  const endValue = end.replace('#', '');
  const channels = [0, 2, 4].map((offset) => {
    const from = Number.parseInt(startValue.slice(offset, offset + 2), 16);
    const to = Number.parseInt(endValue.slice(offset, offset + 2), 16);
    const channel = Math.round(from + (to - from) * clamped).toString(16);
    return channel.length === 1 ? '0' + channel : channel;
  });
  return '#' + channels.join('');
}
