type ToneCraftMode = 'metronome' | 'tuner';

function normalizeMode(value: string): ToneCraftMode {
  return value === 'tuner' ? 'tuner' : 'metronome';
}

const pendingModes = new WeakMap<object, ToneCraftMode>();

Component({
  properties: {
    selected: {
      type: String,
      value: 'metronome',
    },
  },

  data: {},

  methods: {
    selectMode(event: WechatMiniprogram.TouchEvent) {
      const mode = event.currentTarget.dataset.mode as ToneCraftMode;
      const currentMode = normalizeMode(this.properties.selected);
      if (pendingModes.has(this) || mode === currentMode) return;

      // 切页状态由页面路由管理，组件只负责防止一次触摸重复发起跳转。
      // 不在这里先更新视觉状态，避免路由切换和滑块动画同时绘制造成闪屏。
      pendingModes.set(this, mode);
      this.triggerEvent('change', { mode });
    },

    cancelSwitch() {
      pendingModes.delete(this);
    },
  },
});
