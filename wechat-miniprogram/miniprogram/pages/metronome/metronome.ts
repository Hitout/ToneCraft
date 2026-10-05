import {
  BEAT_STRENGTHS,
  MetronomeSound,
  SOUNDS,
  SUBDIVISIONS,
  SpeedTrainerConfig,
  Subdivision,
  TimeSignature,
  beatDurationSeconds,
  clampInt,
  MAXIMUM_BPM,
  MAXIMUM_TIMER_MINUTES,
  MINIMUM_BPM,
  soundLabel,
  strengthLabel,
  subdivisionForBeat,
  subdivisionLabel,
} from '../../core/metronome/metronome-config';
import { MetronomeModel, MetronomeUiState } from '../../core/metronome/metronome-model';
import { customNavigationLayout } from '../../platform/custom-navigation';

type SheetType = 'number' | 'signature' | 'subdivision' | 'sound' | 'timer' | 'trainer' | '';

const METRONOME_PAGE_PATH = '/pages/metronome/metronome';
const TUNER_PAGE_PATH = '/pages/tuner/tuner';
const SHARE_TITLE = '音匠节拍器';

interface OptionItem {
  value: string;
  label: string;
  icon: string;
  selected: boolean;
}

interface BeatItem {
  index: number;
  strength: string;
  label: string;
  active: boolean;
}

interface SubdivisionPreviewItem {
  index: number;
  icon: string;
  size: number;
}

interface BeatSubdivisionItem {
  index: number;
  subdivision: Subdivision;
  label: string;
  icon: string;
  selected: boolean;
}

interface PageData {
  statusBarHeight: number;
  navigationBarHeight: number;
  contentTop: number;
  bpm: number;
  tempoMarking: string;
  playing: boolean;
  timeSignature: string;
  subdivision: string;
  customSubdivisionEnabled: boolean;
  sound: string;
  timerValueLabel: string;
  subdivisionIcon: string;
  soundIcon: string;
  tempoIcon: string;
  timerIcon: string;
  transportIcon: string;
  pendulumDurationMs: number;
  beats: BeatItem[];
  currentBeat: number | null;
  speedTrainerLabel: string;
  trainerActive: boolean;
  trainerDirectionIcon: string;
  trainerSummaryLabel: string;
  statusMessage: string;
  sheet: SheetType;
  sheetTitle: string;
  numberError: string;
  optionLayout: 'list' | 'grid3' | 'grid4';
  options: OptionItem[];
  beatSubdivisions: BeatSubdivisionItem[];
  beatSubdivisionRows: BeatSubdivisionItem[][];
  subdivisionPreview: SubdivisionPreviewItem[];
  subdivisionPreviewRows: SubdivisionPreviewItem[][];
  beatSelectorItemWidth: string;
  selectedBeatIndex: number;
  numberKind: 'bpm' | 'timer' | 'trainerStart' | 'trainerTarget' | 'trainerStep' | 'trainerBars';
  numberInput: string;
  trainerCanDisable: boolean;
  trainerStartBpm: string;
  trainerTargetBpm: string;
  trainerStepBpm: string;
  trainerBarsPerStep: string;
  trainerStartCanDecrease: boolean;
  trainerStartCanIncrease: boolean;
  trainerTargetCanDecrease: boolean;
  trainerTargetCanIncrease: boolean;
  trainerStepCanDecrease: boolean;
  trainerStepCanIncrease: boolean;
  trainerBarsCanDecrease: boolean;
  trainerBarsCanIncrease: boolean;
  trainerProgressLabel: string;
}

const INITIAL_DATA: PageData = {
  statusBarHeight: 0,
  navigationBarHeight: 44,
  contentTop: 70,
  bpm: 120,
  tempoMarking: 'Moderato',
  playing: false,
  timeSignature: '4/4',
  subdivision: '四分',
  customSubdivisionEnabled: false,
  sound: '机械',
  timerValueLabel: '--:--',
  subdivisionIcon: '../../assets/icons/metronome/subdivision/quarter.svg',
  soundIcon: '../../assets/icons/metronome/sound.svg',
  tempoIcon: '../../assets/icons/metronome/tempo.svg',
  timerIcon: '../../assets/icons/metronome/timer.svg',
  transportIcon: '../../assets/icons/metronome/play.svg',
  pendulumDurationMs: 500,
  beats: [],
  currentBeat: null,
  speedTrainerLabel: 'OFF',
  trainerActive: false,
  trainerDirectionIcon: '../../assets/icons/metronome/trainer-neutral.svg',
  trainerSummaryLabel: '',
  statusMessage: '',
  sheet: '',
  sheetTitle: '',
  numberError: '',
  optionLayout: 'list',
  options: [],
  beatSubdivisions: [],
  beatSubdivisionRows: [],
  subdivisionPreview: [],
  subdivisionPreviewRows: [],
  beatSelectorItemWidth: 'calc((100% - 24px) / 4)',
  selectedBeatIndex: 0,
  numberKind: 'bpm',
  numberInput: '120',
  trainerCanDisable: false,
  trainerStartBpm: '80',
  trainerTargetBpm: '120',
  trainerStepBpm: '1',
  trainerBarsPerStep: '1',
  trainerStartCanDecrease: true,
  trainerStartCanIncrease: true,
  trainerTargetCanDecrease: true,
  trainerTargetCanIncrease: true,
  trainerStepCanDecrease: false,
  trainerStepCanIncrease: true,
  trainerBarsCanDecrease: false,
  trainerBarsCanIncrease: true,
  trainerProgressLabel: '',
};

const SIGNATURE_OPTIONS: readonly TimeSignature[] = [
  '2/4',
  '3/4',
  '4/4',
  '2/2',
  '5/4',
  '6/8',
  '7/8',
  '9/8',
  '12/8',
];

function formatTimer(seconds: number | null): string {
  if (seconds == null) return '';
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = (seconds % 60).toString().padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function tempoMarkingForBpm(bpm: number): string {
  if (bpm <= 60) return 'Largo';
  if (bpm <= 66) return 'Larghetto';
  if (bpm <= 76) return 'Adagio';
  if (bpm <= 108) return 'Andante';
  if (bpm <= 120) return 'Moderato';
  if (bpm <= 168) return 'Allegro';
  if (bpm <= 208) return 'Presto';
  return 'Prestissimo';
}

function buildBeats(state: MetronomeUiState): BeatItem[] {
  return state.config.beatStrengths.map((strength, index) => ({
    index,
    strength,
    label: strengthLabel(strength),
    active: state.session === 'playing' && state.currentBeat === index,
  }));
}

function trainerLabel(state: MetronomeUiState): string {
  const trainer = state.speedTrainer;
  if (!trainer.enabled) return 'OFF';
  if (state.speedTrainerCompleted) return `${state.config.bpm} BPM ✓`;
  return `${state.config.bpm} → ${trainer.targetBpm}`;
}

function trainerDirectionIcon(state: MetronomeUiState): string {
  if (!state.speedTrainer.enabled) {
    return '../../assets/icons/metronome/trainer-up.svg';
  }
  if (state.speedTrainer.targetBpm > state.speedTrainer.startBpm) {
    return '../../assets/icons/metronome/trainer-up.svg';
  }
  if (state.speedTrainer.targetBpm < state.speedTrainer.startBpm) {
    return '../../assets/icons/metronome/trainer-down.svg';
  }
  return '../../assets/icons/metronome/trainer-neutral.svg';
}

function trainerSummary(
  startBpm: number,
  targetBpm: number,
  stepBpm: number,
  barsPerStep: number,
): string {
  const stageCount = Math.floor((Math.abs(targetBpm - startBpm) + stepBpm - 1) / stepBpm) + 1;
  return `共 ${stageCount} 档 · ${stageCount * barsPerStep} 小节`;
}

function makeOptions(
  values: readonly string[],
  selectedValue: string,
  labels: (value: string) => string,
  icons: (value: string) => string = () => '',
): OptionItem[] {
  return values.map((value) => ({
    value,
    label: labels(value),
    icon: icons(value),
    selected: value === selectedValue,
  }));
}

function subdivisionIcon(subdivision: Subdivision): string {
  switch (subdivision) {
    case 'quarter':
      return '../../assets/icons/metronome/subdivision/quarter.svg';
    case 'eighth':
      return '../../assets/icons/metronome/subdivision/eighth.svg';
    case 'triplet':
      return '../../assets/icons/metronome/subdivision/triplet.svg';
    case 'sixteenth':
      return '../../assets/icons/metronome/subdivision/sixteenth.svg';
    case 'eighth-rest-note':
      return '../../assets/icons/metronome/subdivision/eighth-rest.svg';
    case 'triplet-rest-note-note':
      return '../../assets/icons/metronome/subdivision/triplet-rest-note-note.svg';
    case 'triplet-note-rest-note':
      return '../../assets/icons/metronome/subdivision/triplet-note-rest-note.svg';
    case 'triplet-note-note-rest':
      return '../../assets/icons/metronome/subdivision/triplet-note-note-rest.svg';
  }
}

function makeSubdivisionOptions(selected: Subdivision): OptionItem[] {
  return makeOptions(
    SUBDIVISIONS,
    selected,
    (value) => subdivisionLabel(value as Subdivision),
    (value) => subdivisionIcon(value as Subdivision),
  );
}

function makeBeatSubdivisionItems(state: MetronomeUiState): BeatSubdivisionItem[] {
  return state.config.beatStrengths.map((_, index) => {
    const subdivision = subdivisionForBeat(state.config, index);
    return {
      index,
      subdivision,
      label: `第 ${index + 1} 拍 · ${subdivisionLabel(subdivision)}`,
      icon: subdivisionIcon(subdivision),
      selected: index === 0,
    };
  });
}

function makeBeatSubdivisionRows(items: BeatSubdivisionItem[]): BeatSubdivisionItem[][] {
  if (items.length <= 6) return items.length === 0 ? [] : [items];
  // 长拍号按前少后多拆分，保证 7 拍为 3+4、9 拍为 4+5，
  // 每一行再通过样式单独水平居中。
  const firstRowCount = Math.floor(items.length / 2);
  return [items.slice(0, firstRowCount), items.slice(firstRowCount)];
}

function beatSelectorColumnsForCount(beatCount: number): number {
  if (beatCount <= 0) return 1;
  return beatCount <= 6 ? beatCount : Math.ceil(beatCount / 2);
}

function beatSelectorItemWidthForColumns(columns: number): string {
  return `calc((100% - ${(columns - 1) * 8}px) / ${columns})`;
}

function subdivisionPreviewColumnsForCount(beatCount: number): number {
  if (beatCount <= 0) return 1;
  return beatCount < 6 ? beatCount : Math.ceil(beatCount / 2);
}

function makeSubdivisionPreviewRows(items: SubdivisionPreviewItem[]): SubdivisionPreviewItem[][] {
  if (items.length < 6) return items.length === 0 ? [] : [items];
  // 紧凑预览从 6 拍开始换行，并保持前一行比后一行少一个图标。
  const firstRowCount = Math.floor(items.length / 2);
  return [items.slice(0, firstRowCount), items.slice(firstRowCount)];
}

function makeSubdivisionPreview(state: MetronomeUiState): SubdivisionPreviewItem[] {
  const beatCount = state.config.beatStrengths.length;
  if (beatCount === 0) return [];

  // 顶部卡片的预览区域固定为 54×38，图标按网格单元的较小边缩放，
  // 并限制在 8–20px，避免拍数变化时图标忽大忽小或挤出卡片。
  const columns = subdivisionPreviewColumnsForCount(beatCount);
  const rows = Math.ceil(beatCount / columns);
  const widthPerItem = (54 - (columns - 1)) / columns;
  const heightPerItem = (38 - (rows - 1)) / rows;
  const size = Math.max(8, Math.min(20, Math.min(widthPerItem, heightPerItem)));

  return state.config.beatStrengths.map((_, index) => ({
    index,
    icon: subdivisionIcon(subdivisionForBeat(state.config, index)),
    size,
  }));
}

function subdivisionEditorStateKey(state: MetronomeUiState): string {
  const config = state.config;
  return [
    config.timeSignature,
    config.subdivision,
    config.customSubdivisionEnabled ? 'custom' : 'uniform',
    config.beatSubdivisions.join(','),
    String(config.beatStrengths.length),
  ].join('|');
}

function metronomeVisualStateKey(state: MetronomeUiState): string {
  const config = state.config;
  return [
    config.bpm,
    config.timeSignature,
    config.subdivision,
    config.customSubdivisionEnabled ? 'custom' : 'uniform',
    config.beatSubdivisions.join(','),
    config.sound,
    config.beatStrengths.join(','),
  ].join('|');
}

Page({
  data: INITIAL_DATA,
  model: undefined as MetronomeModel | undefined,
  unsubscribe: undefined as (() => void) | undefined,
  subdivisionEditorStateKey: undefined as string | undefined,
  visualStateKey: undefined as string | undefined,
  leavingForModeChange: false,

  onLoad() {
    this.setData(customNavigationLayout());
    // 开启右上角的转发和朋友圈入口；复制链接由微信菜单提供，回调负责绑定当前页面的链接参数。
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline'],
      fail: () => {},
    });
    if (typeof wx.onCopyUrl === 'function') {
      wx.onCopyUrl(() => ({ query: '' }));
    }
    this.model = new MetronomeModel();
    // 先同步读取持久化配置，再订阅页面，避免旋钮组件先以默认 120 BPM
    // 创建后又收到外部 BPM 更新；旋钮会刻意保留外部改值时的位置，因此
    // 初始化顺序必须保证它第一次拿到的就是用户上次保存的真实状态。
    this.model.initialize();
    this.unsubscribe = this.model.subscribe((state) => this.renderState(state));
  },

  onHide() {
    // 模式切换前已经主动完成清理，避免路由交接期间重复触发状态更新。
    if (!this.leavingForModeChange) this.model?.onHide();
  },

  onUnload() {
    if (typeof wx.offCopyUrl === 'function') {
      wx.offCopyUrl();
    }
    this.unsubscribe?.();
    this.model?.dispose();
    this.unsubscribe = undefined;
    this.model = undefined;
    this.subdivisionEditorStateKey = undefined;
    this.visualStateKey = undefined;
    this.leavingForModeChange = false;
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE,
      path: METRONOME_PAGE_PATH,
    };
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE,
      query: '',
    };
  },

  onModeChange(event: WechatMiniprogram.CustomEvent<{ mode: 'metronome' | 'tuner' }>) {
    if (event.detail.mode !== 'tuner') return;
    const model = this.model;
    const wasPlaying = model?.currentState.session === 'playing';
    this.leavingForModeChange = true;
    // 在路由开始前停止音频并刷入待保存配置，避免旧页面在切换动画期间继续刷新视图。
    model?.onHide();
    wx.redirectTo({
      url: TUNER_PAGE_PATH,
      fail: () => {
        // 路由失败时恢复页面状态；播放中的节拍器也恢复到切换前的状态。
        this.leavingForModeChange = false;
        this.selectComponent('#mode-switch')?.cancelSwitch?.();
        if (wasPlaying) void model?.togglePlayback();
      },
    });
  },

  renderState(state: MetronomeUiState) {
    const timerMinutes = state.config.timerMinutes;
    const beatCount = state.config.beatStrengths.length;
    const beatSelectorColumns = beatSelectorColumnsForCount(beatCount);
    const visualStateKey = metronomeVisualStateKey(state);
    const visualStateChanged = this.visualStateKey !== visualStateKey;
    if (visualStateChanged) this.visualStateKey = visualStateKey;
    const editorStateKey = subdivisionEditorStateKey(state);
    const shouldRefreshSubdivisionEditor = this.data.sheet === 'subdivision' &&
      this.subdivisionEditorStateKey !== editorStateKey;
    if (shouldRefreshSubdivisionEditor) this.subdivisionEditorStateKey = editorStateKey;
    const subdivisionEditorPatch: Partial<PageData> = shouldRefreshSubdivisionEditor
      ? (() => {
          const beatSubdivisions = makeBeatSubdivisionItems(state);
          const selectedBeatIndex = Math.min(
            this.data.selectedBeatIndex,
            Math.max(beatSubdivisions.length - 1, 0),
          );
          const selected = beatSubdivisions[selectedBeatIndex];
          return {
            beatSubdivisions,
            beatSubdivisionRows: makeBeatSubdivisionRows(beatSubdivisions),
            options: makeSubdivisionOptions(
              state.config.customSubdivisionEnabled
                ? (selected?.subdivision ?? state.config.subdivision)
                : state.config.subdivision,
            ),
            selectedBeatIndex,
          };
        })()
      : {};
    const progress = state.speedTrainer.enabled && !state.speedTrainerCompleted
      ? `${state.speedTrainerBarProgress + 1} / ${state.speedTrainer.barsPerStep}`
      : '';
    const dataPatch: Partial<PageData> = {
      playing: state.session === 'playing',
      timerValueLabel: timerMinutes == null
        ? '--:--'
        : formatTimer(state.remainingTimerSeconds ?? timerMinutes * 60),
      transportIcon: state.session === 'playing'
        ? '../../assets/icons/metronome/pause.svg'
        : '../../assets/icons/metronome/play.svg',
      beats: buildBeats(state),
      currentBeat: state.currentBeat,
      speedTrainerLabel: trainerLabel(state),
      trainerActive: state.speedTrainer.enabled,
      trainerDirectionIcon: trainerDirectionIcon(state),
      trainerProgressLabel: progress,
      statusMessage: state.session === 'interrupted'
        ? '音频被系统中断，请重新点击播放'
        : state.session === 'error'
          ? '音频启动失败，请检查微信音频权限或当前音频输出设备'
          : '',
    };
    if (visualStateChanged) {
      const subdivisionPreview = makeSubdivisionPreview(state);
      Object.assign(dataPatch, {
        bpm: state.config.bpm,
        tempoMarking: tempoMarkingForBpm(state.config.bpm),
        timeSignature: state.config.timeSignature,
        subdivision: subdivisionLabel(state.config.subdivision),
        customSubdivisionEnabled: state.config.customSubdivisionEnabled,
        sound: soundLabel(state.config.sound),
        subdivisionIcon: subdivisionIcon(state.config.subdivision),
        subdivisionPreview,
        subdivisionPreviewRows: makeSubdivisionPreviewRows(subdivisionPreview),
        beatSelectorItemWidth: beatSelectorItemWidthForColumns(beatSelectorColumns),
        pendulumDurationMs: Math.round(beatDurationSeconds(state.config) * 1000),
      });
    }
    Object.assign(dataPatch, subdivisionEditorPatch);
    this.setData(dataPatch);
  },

  onKnobChange(event: WechatMiniprogram.CustomEvent<{ bpm: number }>) {
    this.model?.setBpm(event.detail.bpm);
  },

  decreaseBpm() {
    this.model?.adjustBpm(-1);
  },

  increaseBpm() {
    this.model?.adjustBpm(1);
  },

  tapTempo() {
    this.model?.tap();
  },

  togglePlayback() {
    this.model?.togglePlayback();
  },

  cycleBeatStrength(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    this.model?.cycleBeatStrength(index);
  },

  openBpm() {
    this.setData({
      sheet: 'number',
      sheetTitle: '输入 BPM（20–300）',
      numberKind: 'bpm',
      numberInput: this.data.bpm.toString(),
      numberError: '',
      options: [],
    });
  },

  onNumberInput(event: WechatMiniprogram.Input) {
    // 用户开始修正输入时立即清除上一次校验提示，避免合法值仍被旧错误文案遮挡。
    this.setData({ numberInput: event.detail.value, numberError: '' });
  },

  openNumberEditor(
    kind: PageData['numberKind'],
    title: string,
    value: string,
  ) {
    this.setData({
      sheet: 'number',
      sheetTitle: title,
      numberKind: kind,
      numberInput: value,
      numberError: '',
      options: [],
    });
  },

  confirmNumber() {
    const value = Number(this.data.numberInput);
    const limits: Record<PageData['numberKind'], [number, number, string]> = {
      bpm: [MINIMUM_BPM, MAXIMUM_BPM, '请输入 20–300 的整数'],
      timer: [1, MAXIMUM_TIMER_MINUTES, '请输入 1–60 的整数'],
      trainerStart: [MINIMUM_BPM, MAXIMUM_BPM, '请输入 20–300 的整数'],
      trainerTarget: [MINIMUM_BPM, MAXIMUM_BPM, '请输入 20–300 的整数'],
      trainerStep: [1, 50, '请输入 1–50 的整数'],
      trainerBars: [1, 32, '请输入 1–32 的整数'],
    };
    const [minimum, maximum, error] = limits[this.data.numberKind];
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      this.setData({ numberError: error });
      return;
    }
    const editingTrainer = this.data.numberKind.startsWith('trainer');
    switch (this.data.numberKind) {
      case 'bpm':
        this.model?.setBpm(value);
        break;
      case 'timer':
        this.model?.setTimerMinutes(value);
        break;
      case 'trainerStart':
        this.setData({ trainerStartBpm: String(value) });
        break;
      case 'trainerTarget':
        this.setData({ trainerTargetBpm: String(value) });
        break;
      case 'trainerStep':
        this.setData({ trainerStepBpm: String(value) });
        break;
      case 'trainerBars':
        this.setData({ trainerBarsPerStep: String(value) });
        break;
    }
    // 训练参数的数字编辑是训练面板里的二级面板，确认后回到面板以保留其他未保存字段；
    // BPM 和倒计时则直接结束编辑。
    if (editingTrainer) {
      const overrides: Partial<Pick<
        PageData,
        'trainerStartBpm' | 'trainerTargetBpm' | 'trainerStepBpm' | 'trainerBarsPerStep'
      >> = {};
      switch (this.data.numberKind) {
        case 'trainerStart':
          overrides.trainerStartBpm = String(value);
          break;
        case 'trainerTarget':
          overrides.trainerTargetBpm = String(value);
          break;
        case 'trainerStep':
          overrides.trainerStepBpm = String(value);
          break;
        case 'trainerBars':
          overrides.trainerBarsPerStep = String(value);
          break;
      }
      this.refreshTrainerEditorSummary(overrides);
      this.setData({ sheet: 'trainer', sheetTitle: '速度训练', options: [], optionLayout: 'list' });
    } else {
      this.closeSheet();
    }
  },

  openPicker(event: WechatMiniprogram.TouchEvent) {
    const type = String(event.currentTarget.dataset.type) as 'signature' | 'subdivision' | 'sound' | 'timer';
    const state = this.model?.currentState;
    if (state === undefined) return;
    if (type === 'signature') {
      this.showOptions(
        'signature',
        '节拍',
        makeOptions(SIGNATURE_OPTIONS, state.config.timeSignature, (value) => value),
        'grid3',
      );
    } else if (type === 'subdivision') {
      const beatSubdivisions = makeBeatSubdivisionItems(state);
      const beatSelectorColumns = beatSelectorColumnsForCount(beatSubdivisions.length);
      this.setData({
        sheet: 'subdivision',
        sheetTitle: '细分',
        options: makeSubdivisionOptions(
          state.config.customSubdivisionEnabled
            ? subdivisionForBeat(state.config, 0)
            : state.config.subdivision,
        ),
        optionLayout: 'grid4',
        customSubdivisionEnabled: state.config.customSubdivisionEnabled,
        beatSubdivisions,
        beatSubdivisionRows: makeBeatSubdivisionRows(beatSubdivisions),
        beatSelectorItemWidth: beatSelectorItemWidthForColumns(beatSelectorColumns),
        selectedBeatIndex: 0,
      });
    } else if (type === 'sound') {
      this.showOptions(
        'sound',
        '音色',
        makeOptions(SOUNDS, state.config.sound, (value) => soundLabel(value as MetronomeSound)),
        'list',
      );
    } else {
      const current = state.config.timerMinutes == null ? 'off' : String(state.config.timerMinutes);
      const values = ['off', '1', '5', '10', '15', '30', '60', 'custom'];
      this.showOptions(
        'timer',
        '定时',
        makeOptions(values, current, (value) => {
          if (value === 'off') return '关闭';
          if (value === 'custom') return '自定义分钟';
          return `${value} 分钟`;
        }),
        'list',
      );
    }
  },

  showOptions(
    sheet: Exclude<SheetType, 'number' | 'trainer' | ''>,
    title: string,
    options: OptionItem[],
    optionLayout: PageData['optionLayout'],
  ) {
    this.setData({ sheet, sheetTitle: title, options, optionLayout });
  },

  selectOption(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value);
    switch (this.data.sheet) {
      case 'signature':
        this.model?.setTimeSignature(value as TimeSignature);
        this.closeSheet();
        break;
      case 'subdivision':
        if (this.model?.currentState.config.customSubdivisionEnabled) {
          const subdivision = value as Subdivision;
          const index = this.data.selectedBeatIndex;
          this.model?.setBeatSubdivision(index, subdivision);
        } else {
          this.model?.setSubdivision(value as Subdivision);
          this.closeSheet();
        }
        break;
      case 'sound':
        this.model?.setSound(value as MetronomeSound);
        this.closeSheet();
        break;
      case 'timer':
        if (value === 'custom') {
          const current = this.model?.currentState.config.timerMinutes;
          this.openNumberEditor('timer', '自定义分钟', String(current ?? 10));
        } else {
          this.model?.setTimerMinutes(value === 'off' ? null : Number(value));
          this.closeSheet();
        }
        break;
    }
  },

  selectCustomBeat(event: WechatMiniprogram.TouchEvent) {
    const index = Number(event.currentTarget.dataset.index);
    const item = this.data.beatSubdivisions[index];
    if (item === undefined) return;
    this.setData({
      selectedBeatIndex: index,
      options: makeSubdivisionOptions(item.subdivision),
    });
  },

  toggleCustomSubdivision() {
    const state = this.model?.currentState;
    if (state === undefined) return;
    const enabled = !state.config.customSubdivisionEnabled;
    if (enabled) {
      this.model?.enableCustomSubdivision();
    } else {
      this.model?.disableCustomSubdivision();
    }
  },

  resetCustomSubdivision() {
    const state = this.model?.currentState;
    if (state === undefined || !state.config.customSubdivisionEnabled) return;
    const selected = this.data.beatSubdivisions[this.data.selectedBeatIndex];
    if (selected === undefined) return;
    const subdivision = selected.subdivision;
    this.model?.applySubdivisionToAll(subdivision);
  },

  openTrainer() {
    const state = this.model?.currentState;
    if (state === undefined) return;
    const current = state.speedTrainer;
    const startBpm = current.enabled
      ? current.startBpm
      : state.config.bpm;
    const targetBpm = current.enabled
      ? current.targetBpm
      : state.speedTrainerConfigured
        ? current.targetBpm
        : startBpm <= MAXIMUM_BPM - 20
          ? startBpm + 20
          : Math.max(MINIMUM_BPM, startBpm - 20);
    this.setData({
      sheet: 'trainer',
      sheetTitle: '速度训练',
      options: [],
      trainerCanDisable: current.enabled,
      trainerStartBpm: String(startBpm),
      trainerTargetBpm: String(targetBpm),
      trainerStepBpm: String(current.stepBpm),
      trainerBarsPerStep: String(current.barsPerStep),
      trainerStartCanDecrease: startBpm > MINIMUM_BPM,
      trainerStartCanIncrease: startBpm < MAXIMUM_BPM,
      trainerTargetCanDecrease: targetBpm > MINIMUM_BPM,
      trainerTargetCanIncrease: targetBpm < MAXIMUM_BPM,
      trainerStepCanDecrease: current.stepBpm > 1,
      trainerStepCanIncrease: current.stepBpm < 50,
      trainerBarsCanDecrease: current.barsPerStep > 1,
      trainerBarsCanIncrease: current.barsPerStep < 32,
      trainerSummaryLabel: trainerSummary(startBpm, targetBpm, current.stepBpm, current.barsPerStep),
    });
  },

  adjustTrainer(event: WechatMiniprogram.TouchEvent) {
    const field = String(event.currentTarget.dataset.field) as keyof Pick<
      PageData,
      'trainerStartBpm' | 'trainerTargetBpm' | 'trainerStepBpm' | 'trainerBarsPerStep'
    >;
    const delta = Number(event.currentTarget.dataset.delta);
    const bounds: Record<typeof field, [number, number]> = {
      trainerStartBpm: [MINIMUM_BPM, MAXIMUM_BPM],
      trainerTargetBpm: [MINIMUM_BPM, MAXIMUM_BPM],
      trainerStepBpm: [1, 50],
      trainerBarsPerStep: [1, 32],
    };
    const [minimum, maximum] = bounds[field];
    const current = Number(this.data[field]);
    // 禁用态仍可能收到触摸事件，边界处直接忽略，保证视觉禁用和业务行为一致。
    if (delta < 0 && current <= minimum || delta > 0 && current >= maximum) return;
    const next = clampInt(current + delta, minimum, maximum);
    this.setData({ [field]: String(next) });
    this.refreshTrainerEditorSummary({ [field]: String(next) });
  },

  openTrainerNumber(event: WechatMiniprogram.TouchEvent) {
    const kind = String(event.currentTarget.dataset.kind) as PageData['numberKind'];
    const editorValues: Record<PageData['numberKind'], [string, string]> = {
      bpm: ['输入 BPM', this.data.bpm.toString()],
      timer: ['自定义分钟', this.data.numberInput],
      trainerStart: ['起始 BPM', this.data.trainerStartBpm],
      trainerTarget: ['目标 BPM', this.data.trainerTargetBpm],
      trainerStep: ['每次增加', this.data.trainerStepBpm],
      trainerBars: ['每档小节', this.data.trainerBarsPerStep],
    };
    const [title, value] = editorValues[kind];
    this.openNumberEditor(kind, title, value);
  },

  refreshTrainerEditorSummary(
    overrides: Partial<Pick<
      PageData,
      'trainerStartBpm' | 'trainerTargetBpm' | 'trainerStepBpm' | 'trainerBarsPerStep'
    >> = {},
  ) {
    // setData 的回写时机由小程序运行时决定，摘要计算显式接收本次新值，
    // 避免用户快速点击加减时仍显示上一轮档数。
    const start = Number(overrides.trainerStartBpm ?? this.data.trainerStartBpm);
    const target = Number(overrides.trainerTargetBpm ?? this.data.trainerTargetBpm);
    const step = Number(overrides.trainerStepBpm ?? this.data.trainerStepBpm);
    const bars = Number(overrides.trainerBarsPerStep ?? this.data.trainerBarsPerStep);
    if (![start, target, step, bars].every(Number.isFinite)) return;
    this.setData({
      trainerSummaryLabel: trainerSummary(start, target, step, bars),
      trainerStartCanDecrease: start > MINIMUM_BPM,
      trainerStartCanIncrease: start < MAXIMUM_BPM,
      trainerTargetCanDecrease: target > MINIMUM_BPM,
      trainerTargetCanIncrease: target < MAXIMUM_BPM,
      trainerStepCanDecrease: step > 1,
      trainerStepCanIncrease: step < 50,
      trainerBarsCanDecrease: bars > 1,
      trainerBarsCanIncrease: bars < 32,
    });
  },

  saveTrainer() {
    const current = this.model?.currentState.speedTrainer;
    if (current === undefined) return;
    const values: Partial<SpeedTrainerConfig> = {
      enabled: true,
      startBpm: Number(this.data.trainerStartBpm),
      targetBpm: Number(this.data.trainerTargetBpm),
      stepBpm: Number(this.data.trainerStepBpm),
      barsPerStep: Number(this.data.trainerBarsPerStep),
    };
    // “开始”是显式重置训练进度的动作，即使参数没有变化，也要从起始 BPM 重新开始。
    this.model?.configureSpeedTrainer(values);
    this.closeSheet();
  },

  disableTrainer() {
    this.model?.disableSpeedTrainer();
    this.closeSheet();
  },

  closeSheet() {
    this.setData({ sheet: '', sheetTitle: '', numberError: '', options: [], optionLayout: 'list' });
  },

  noop() {},
});
