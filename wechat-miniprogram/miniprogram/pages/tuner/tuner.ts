import {
  INSTRUMENTS,
  InstrumentId,
  TunerReading,
  TuningPreset,
  TuningPresetId,
  TuningTarget,
  defaultPresetForInstrument,
  mapFrequency,
  presetsForInstrument,
  readingColor,
  targetFromMidi,
  tuningPreset,
} from '../../core/tuner/tuning';
import { customNavigationLayout } from '../../platform/custom-navigation';
import { recorderTuner } from '../../platform/recorder-tuner';

const METRONOME_PAGE_PATH = '/pages/metronome/metronome';
const TUNER_PAGE_PATH = '/pages/tuner/tuner';
const SHARE_TITLE = '音匠调音器';
const INSTRUMENT_STORAGE_KEY = 'tonecraft.tuner.instrument';
const PRESET_STORAGE_KEY = 'tonecraft.tuner.preset';
const SIGNAL_TIMEOUT_MS = 420;
const TREND_DURATION_MS = 8000;
const TUNED_CONFIRMATION_MS = 300;
const MAXIMUM_CONFIRMATION_GAP_MS = 150;

type SheetType = '' | 'instrument' | 'preset';

interface TrendSample {
  cents: number | null;
  capturedAt: number;
}

interface SheetOption {
  value: string;
  label: string;
  selected: boolean;
}

interface TargetView {
  index: number;
  noteName: string;
  octave: number;
  displayName: string;
  frequencyLabel: string;
  color: string;
  borderColor: string;
  backgroundColor: string;
  highlighted: boolean;
}

interface PageData {
  statusBarHeight: number;
  navigationBarHeight: number;
  contentTop: number;
  instrumentLabel: string;
  presetLabel: string;
  noteName: string;
  octave: number;
  cents: number;
  readingColor: string;
  frequencyLabel: string;
  targetFrequencyLabel: string;
  gaugeActive: boolean;
  showStatusBanner: boolean;
  statusMessage: string;
  canRetry: boolean;
  statusActionLabel: string;
  isChromatic: boolean;
  automaticDetection: boolean;
  summaryTitle: string;
  targets: TargetView[];
  trendSamples: TrendSample[];
  sheet: SheetType;
  sheetTitle: string;
  sheetOptions: SheetOption[];
}

const INITIAL_DATA: PageData = {
  statusBarHeight: 0,
  navigationBarHeight: 44,
  contentTop: 70,
  instrumentLabel: '吉他',
  presetLabel: '标准调弦',
  noteName: 'E',
  octave: 2,
  cents: 0,
  readingColor: '#72e85c',
  frequencyLabel: '82.41 Hz',
  targetFrequencyLabel: '',
  gaugeActive: true,
  showStatusBanner: false,
  statusMessage: '',
  canRetry: false,
  statusActionLabel: '',
  isChromatic: false,
  automaticDetection: true,
  summaryTitle: '',
  targets: [],
  trendSamples: [],
  sheet: '',
  sheetTitle: '',
  sheetOptions: [],
};

function instrumentLabel(instrument: InstrumentId): string {
  const labels: Record<InstrumentId, string> = {
    guitar: '吉他',
    ukulele: '尤克里里',
    bass: '贝斯',
    violin: '小提琴',
    generic: '通用',
  };
  return labels[instrument];
}

function presetLabel(preset: TuningPresetId): string {
  const labels: Record<TuningPresetId, string> = {
    standard: '标准调弦',
    guitarHalfStepDown: '降半音',
    guitarWholeStepDown: '降全音',
    dadgad: 'DADGAD',
    dropD: 'Drop D',
    chromatic: '半音阶调音',
    ukuleleStandard: '标准调弦',
    ukuleleLowG: '低 G 调弦',
    bassStandard: '标准调弦',
    bassHalfStepDown: '降半音',
    bassDropD: 'Drop D',
    violinStandard: '标准调弦',
    violinHalfStepDown: '降半音',
    violinCrossA: '交叉 A 调弦',
    violinCrossG: '交叉 G 调弦',
  };
  return labels[preset];
}

function presetOptionLabel(preset: TuningPresetId): string {
  if (preset === 'chromatic') return presetLabel(preset);
  const targets = tuningPreset(preset).targets;
  return presetLabel(preset) + '  ' + targets.map((target) => displayName(target)).join(' ');
}

function displayName(target: TuningTarget): string {
  return target.noteName + target.octave;
}

function rgba(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  return 'rgba(' + red + ', ' + green + ', ' + blue + ', ' + alpha + ')';
}

function isInstrument(value: unknown): value is InstrumentId {
  return typeof value === 'string' && (INSTRUMENTS as readonly string[]).includes(value);
}

function isPreset(value: unknown, instrument: InstrumentId): value is TuningPresetId {
  return typeof value === 'string' && (presetsForInstrument(instrument) as readonly string[]).includes(value);
}

function requestRecordPermission(): Promise<void> {
  return new Promise((resolve, reject) => {
    const authorize = () => {
      wx.authorize({
        scope: 'scope.record',
        success: () => resolve(),
        fail: () => reject(new Error('录音权限未授权')),
      });
    };
    wx.getSetting({
      success: (settings) => {
        // 已授权时直接进入录音，避免重复触发授权流程；未决定或已拒绝时再请求。
        if (settings.authSetting['scope.record'] === true) {
          resolve();
          return;
        }
        authorize();
      },
      fail: authorize,
    });
  });
}

Page({
  data: INITIAL_DATA,
  currentInstrument: 'guitar' as InstrumentId,
  currentPreset: tuningPreset('standard') as TuningPreset,
  currentPresetId: 'standard' as TuningPresetId,
  automaticDetection: true,
  manualTargetIndex: null as number | null,
  lastReading: null as TunerReading | null,
  trendSamples: [] as TrendSample[],
  tunedTargetIndices: [] as number[],
  inTuneCandidateIndex: null as number | null,
  inTuneCandidateAt: null as number | null,
  lastInTuneFrameAt: null as number | null,
  signalTimer: undefined as ReturnType<typeof setTimeout> | undefined,
  isRequestingPermission: false,
  permissionStartScheduled: false,
  pageReady: false,
  isForeground: true,

  onLoad() {
    this.isForeground = true;
    this.setData(customNavigationLayout());
    // 开启右上角的转发和朋友圈入口；复制链接由微信菜单提供，回调负责绑定当前页面的链接参数。
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline'],
      fail: () => {},
    });
    if (typeof wx.onCopyUrl === 'function') {
      wx.onCopyUrl(() => ({ query: '' }));
    }
    this.restorePreferences();
    this.render();
  },

  onReady() {
    this.pageReady = true;
    this.schedulePermissionAndStart();
  },

  onHide() {
    this.isForeground = false;
    // 后台停止采集但保留上一段轨迹，回到前台时与 APP 一样从断点继续显示。
    this.stopListening(true, false);
  },

  onShow() {
    this.isForeground = true;
    // 小程序回到前台后重新建立录音流；首次展示的请求由 onReady 负责，
    // isRequestingPermission 会吞掉同一生命周期内的重复调用。
    if (this.pageReady) this.schedulePermissionAndStart();
  },

  onUnload() {
    this.isForeground = false;
    this.pageReady = false;
    this.permissionStartScheduled = false;
    this.stopListening(false, true);
    recorderTuner.setCallbacks(null);
    if (typeof wx.offCopyUrl === 'function') {
      wx.offCopyUrl();
    }
  },

  onShareAppMessage() {
    return {
      title: SHARE_TITLE,
      path: TUNER_PAGE_PATH,
    };
  },

  onShareTimeline() {
    return {
      title: SHARE_TITLE,
      query: '',
    };
  },

  onModeChange(event: WechatMiniprogram.CustomEvent<{ mode: 'metronome' | 'tuner' }>) {
    if (event.detail.mode !== 'metronome') return;
    this.isForeground = false;
    // 先释放麦克风再跳转，但不在路由交接期间清空趋势图触发额外渲染。
    this.stopListening(false, true);
    wx.redirectTo({
      url: METRONOME_PAGE_PATH,
      fail: () => {
        // 路由失败时恢复前台状态和开关，避免调音器停在不可操作状态。
        this.isForeground = true;
        this.selectComponent('#mode-switch')?.cancelSwitch?.();
        this.setData({ trendSamples: [] });
        this.schedulePermissionAndStart();
      },
    });
  },

  restorePreferences() {
    let instrument: InstrumentId = 'guitar';
    let presetId: TuningPresetId = 'standard';
    try {
      const storedInstrument = wx.getStorageSync(INSTRUMENT_STORAGE_KEY);
      if (isInstrument(storedInstrument)) instrument = storedInstrument;
      const storedPreset = wx.getStorageSync(PRESET_STORAGE_KEY);
      if (isPreset(storedPreset, instrument)) presetId = storedPreset;
      else presetId = defaultPresetForInstrument(instrument);
    } catch (_) {
      // 本地存储不可用或历史值损坏时回到吉他标准调弦，保证页面仍可直接使用。
    }
    this.currentInstrument = instrument;
    this.currentPresetId = presetId;
    this.currentPreset = tuningPreset(presetId);
  },

  schedulePermissionAndStart() {
    if (!this.pageReady || this.permissionStartScheduled) return;
    this.permissionStartScheduled = true;
    // 让首帧先完成绘制，再启动录音和权限流程，避免页面切换时录音初始化抢占渲染线程。
    wx.nextTick(() => {
      this.permissionStartScheduled = false;
      if (this.isForeground) this.requestPermissionAndStart();
    });
  },

  async requestPermissionAndStart() {
    if (this.isRequestingPermission) return;
    this.isRequestingPermission = true;
    this.setData({ showStatusBanner: false, statusMessage: '', canRetry: false, statusActionLabel: '' });
    try {
      await requestRecordPermission();
      // 权限弹窗期间页面可能已经被切走；后台页面不得重新占用全局录音会话。
      if (!this.isForeground) return;
      recorderTuner.setCallbacks({
        onPitch: (pitch) => this.handlePitch(
          pitch.frequencyHz,
          pitch.confidence,
          pitch.startsNewTrack,
          pitch.capturedAt,
        ),
        onUnavailable: (reason) => this.showUnavailable(reason),
        onInterrupted: (interrupted) => this.handleInterruption(interrupted),
      });
      recorderTuner.start();
    } catch (_) {
      if (!this.isForeground) return;
      this.setData({
        showStatusBanner: true,
        statusMessage: '请在系统设置中开启麦克风权限。',
        canRetry: true,
        statusActionLabel: '打开设置',
      });
    } finally {
      this.isRequestingPermission = false;
    }
  },

  stopListening(updateView = true, clearTrend = true) {
    if (this.signalTimer !== undefined) clearTimeout(this.signalTimer);
    this.signalTimer = undefined;
    recorderTuner.stop();
    this.resetConfirmation();
    if (clearTrend) {
      // 切换模式或调弦时，旧趋势不再属于当前音轨；保留最后读数用于表盘回显。
      this.trendSamples = [];
      if (updateView) this.setData({ trendSamples: [] });
      return;
    }
    // 仅进入后台时保留历史，并用空点断开前后台两段声音轨迹。
    this.appendTrendGap(Date.now(), updateView);
  },

  handleInterruption(interrupted: boolean) {
    if (!this.isForeground) return;
    if (interrupted) {
      this.appendTrendGap();
      this.setData({
        showStatusBanner: true,
        statusMessage: '调音被其他音频会话中断。',
        canRetry: false,
        statusActionLabel: '',
      });
    } else {
      this.resetConfirmation();
      this.setData({ showStatusBanner: false, statusMessage: '', canRetry: false, statusActionLabel: '' });
      recorderTuner.restartAfterInterruption();
    }
  },

  showUnavailable(reason = '') {
    if (!this.isForeground) return;
    this.appendTrendGap();
    this.resetConfirmation();
    const permissionDenied = /unauthorized|permission|denied/i.test(reason);
    this.setData({
      showStatusBanner: true,
      statusMessage: permissionDenied ? '请在系统设置中开启麦克风权限。' : '麦克风不可用，或正被其他应用占用。',
      canRetry: true,
      statusActionLabel: permissionDenied ? '打开设置' : '重试',
    });
  },

  handleStatusAction() {
    if (this.data.statusActionLabel !== '打开设置') {
      this.requestPermissionAndStart();
      return;
    }
    wx.openSetting({
      success: () => this.requestPermissionAndStart(),
      fail: () => this.requestPermissionAndStart(),
    });
  },

  handlePitch(
    frequencyHz: number,
    confidence: number,
    startsNewTrack = false,
    capturedAt = Date.now(),
  ) {
    if (!this.isForeground) return;
    const lockedTargetIndex = this.automaticDetection ? null : this.manualTargetIndex;
    const reading = mapFrequency(frequencyHz, confidence, this.currentPreset, lockedTargetIndex);
    const now = capturedAt;
    const history = this.trendSamples.filter((sample) => sample.capturedAt >= now - TREND_DURATION_MS);
    // 音高轨迹由 PitchTracker 判定；页面只消费明确的新轨迹边界，
    // 不根据目标弦索引变化自行切断连续声音。
    if (startsNewTrack && history.length > 0 && history[history.length - 1].cents !== null) {
      history.push({ cents: null, capturedAt: now });
    }
    history.push({ cents: reading.cents, capturedAt: now });
    this.trendSamples = history;
    this.lastReading = reading;
    this.updateTunedTargets(reading, now, startsNewTrack);
    // 收到可信音高后，清除过期提示并与本帧读数合并提交，避免连续触发两次页面更新。
    this.render(true);

    if (this.signalTimer !== undefined) clearTimeout(this.signalTimer);
    this.signalTimer = setTimeout(() => {
      // 静音不清掉最后一次可信读数，让用户仍能看清刚才识别到的音名与偏差。
      // 趋势图追加空点，使无信号区间与上一段有效音高明确断开。
      this.appendTrendGap();
      this.resetConfirmation();
    }, SIGNAL_TIMEOUT_MS);
  },

  appendTrendGap(capturedAt = Date.now(), updateView = true) {
    const latest = this.trendSamples[this.trendSamples.length - 1];
    if (latest === undefined || latest.cents === null) return;
    this.trendSamples = this.trendSamples
      .filter((sample) => sample.capturedAt >= capturedAt - TREND_DURATION_MS)
      .concat({ cents: null, capturedAt });
    if (updateView) this.setData({ trendSamples: this.trendSamples });
  },

  updateTunedTargets(reading: TunerReading, capturedAt: number, startsNewTrack = false) {
    const targetIndex = reading.targetIndex;
    if (targetIndex === null || Math.abs(reading.cents) > 3) {
      this.resetConfirmation();
      return;
    }
    const evidenceInterrupted = startsNewTrack ||
      this.inTuneCandidateIndex !== targetIndex ||
      this.lastInTuneFrameAt === null ||
      capturedAt - this.lastInTuneFrameAt > MAXIMUM_CONFIRMATION_GAP_MS;
    if (evidenceInterrupted) {
      this.inTuneCandidateIndex = targetIndex;
      this.inTuneCandidateAt = capturedAt;
    }
    this.lastInTuneFrameAt = capturedAt;
    if (this.inTuneCandidateAt !== null && capturedAt - this.inTuneCandidateAt >= TUNED_CONFIRMATION_MS) {
      if (!this.tunedTargetIndices.includes(targetIndex)) {
        this.tunedTargetIndices.push(targetIndex);
      }
      this.resetConfirmation();
    }
  },

  resetConfirmation() {
    this.inTuneCandidateIndex = null;
    this.inTuneCandidateAt = null;
    this.lastInTuneFrameAt = null;
  },

  render(clearStatus = false) {
    const reading = this.lastReading ?? this.fallbackReading();
    const color = readingColor(reading.cents);
    const isChromatic = this.currentPreset.isChromatic;
    const dataPatch: Partial<PageData> = {
      instrumentLabel: instrumentLabel(this.currentInstrument),
      presetLabel: presetLabel(this.currentPresetId),
      noteName: reading.noteName,
      octave: reading.octave,
      cents: reading.cents,
      readingColor: color,
      frequencyLabel: reading.frequencyHz.toFixed(2) + ' Hz',
      targetFrequencyLabel: '目标频率 ' + reading.targetFrequencyHz.toFixed(2) + ' Hz',
      gaugeActive: true,
      isChromatic,
      automaticDetection: this.automaticDetection,
      summaryTitle: isChromatic
        ? '半音阶调音'
        : presetLabel(this.currentPresetId) + '（' + this.currentPreset.targets.map((target) => displayName(target)).join(' ') + '）',
      targets: this.buildTargets(reading, color),
      trendSamples: this.trendSamples,
    };
    if (clearStatus) {
      Object.assign(dataPatch, {
        showStatusBanner: false,
        statusMessage: '',
        canRetry: false,
        statusActionLabel: '',
      });
    }
    this.setData(dataPatch);
  },

  fallbackReading(): TunerReading {
    const targetIndex = this.manualTargetIndex !== null &&
      this.manualTargetIndex >= 0 &&
      this.manualTargetIndex < this.currentPreset.targets.length
      ? this.manualTargetIndex
      : 0;
    const target = this.currentPreset.isChromatic
      ? targetFromMidi(69)
      : this.currentPreset.targets[targetIndex];
    return {
      noteName: target.noteName,
      octave: target.octave,
      frequencyHz: target.frequencyHz,
      targetFrequencyHz: target.frequencyHz,
      cents: 0,
      confidence: 0,
      targetIndex: this.currentPreset.isChromatic ? null : targetIndex,
    };
  },

  buildTargets(reading: TunerReading, selectedColor: string): TargetView[] {
    if (this.currentPreset.isChromatic) return [];
    return this.currentPreset.targets.map((target, index) => {
      const selected = reading.targetIndex === index;
      const tuned = this.tunedTargetIndices.includes(index);
      const manuallySelected = !this.automaticDetection && this.manualTargetIndex === index;
      const highlighted = selected || tuned || manuallySelected;
      const color = selected ? selectedColor : tuned ? '#72e85c' : '#f4e9d2';
      return {
        index,
        noteName: target.noteName,
        octave: target.octave,
        displayName: displayName(target),
        frequencyLabel: target.frequencyHz.toFixed(2) + ' Hz',
        color,
        borderColor: highlighted ? rgba(color, 0.65) : 'rgba(255, 255, 255, 0.09)',
        backgroundColor: highlighted ? rgba(color, 0.12) : 'rgba(255, 255, 255, 0.02)',
        highlighted,
      };
    });
  },

  openInstrumentSheet() {
    this.setData({
      sheet: 'instrument',
      sheetTitle: '乐器',
      sheetOptions: INSTRUMENTS.map((instrument) => ({
        value: instrument,
        label: instrumentLabel(instrument),
        selected: instrument === this.currentInstrument,
      })),
    });
  },

  openPresetSheet() {
    this.setData({
      sheet: 'preset',
      sheetTitle: '调弦方式',
      sheetOptions: presetsForInstrument(this.currentInstrument).map((preset) => ({
        value: preset,
        label: presetOptionLabel(preset),
        selected: preset === this.currentPresetId,
      })),
    });
  },

  selectSheetOption(event: WechatMiniprogram.TouchEvent) {
    const value = String(event.currentTarget.dataset.value);
    if (this.data.sheet === 'instrument' && isInstrument(value)) {
      this.currentInstrument = value;
      this.currentPresetId = defaultPresetForInstrument(value);
      this.currentPreset = tuningPreset(this.currentPresetId);
      // 乐器变化会同时改变目标数量；沿用旧的手动弦索引会导致越界读数。
      this.automaticDetection = true;
      this.manualTargetIndex = null;
      this.savePreferences();
      this.resetRecognitionState();
    } else if (this.data.sheet === 'preset' && isPreset(value, this.currentInstrument)) {
      this.currentPresetId = value;
      this.currentPreset = tuningPreset(value);
      // 调弦方式切换后重新从自动识别开始，避免旧目标与新预设不一致。
      this.automaticDetection = true;
      this.manualTargetIndex = null;
      this.savePreferences();
      this.resetRecognitionState();
    }
    this.closeSheet();
  },

  savePreferences() {
    try {
      wx.setStorageSync(INSTRUMENT_STORAGE_KEY, this.currentInstrument);
      wx.setStorageSync(PRESET_STORAGE_KEY, this.currentPresetId);
    } catch (_) {
      // 偏好写入失败不影响当次调音，页面继续使用内存中的当前选择。
    }
  },

  toggleAutomatic() {
    if (this.currentPreset.isChromatic) return;
    this.automaticDetection = !this.automaticDetection;
    this.manualTargetIndex = this.automaticDetection
      ? null
      : this.lastReading?.targetIndex ?? this.manualTargetIndex ?? 0;
    this.resetRecognitionState();
  },

  selectTarget(event: WechatMiniprogram.TouchEvent) {
    if (this.currentPreset.isChromatic) return;
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index) || index < 0 || index >= this.currentPreset.targets.length) return;
    this.automaticDetection = false;
    this.manualTargetIndex = index;
    this.resetRecognitionState();
  },

  resetRecognitionState() {
    if (this.signalTimer !== undefined) clearTimeout(this.signalTimer);
    this.signalTimer = undefined;
    this.lastReading = null;
    this.trendSamples = [];
    this.tunedTargetIndices = [];
    this.resetConfirmation();
    this.render();
  },

  closeSheet() {
    this.setData({ sheet: '', sheetTitle: '', sheetOptions: [] });
  },

  noop() {},
});
