interface RepeatTimers {
  delay: ReturnType<typeof setTimeout> | undefined;
  interval: ReturnType<typeof setInterval> | undefined;
}

interface KnobRuntime {
  centerX: number;
  centerY: number;
  lastAngle: number | null;
  dragBpm: number | null;
  lastEmittedBpm: number | null;
  visualAngle: number;
  moved: boolean;
  isDragging: boolean;
}

// 组件被销毁时需要主动清理长按定时器，使用 WeakMap 避免把非 data 的运行时句柄
// 写入 Component 配置对象，也避免定时器状态触发无意义的视图更新。
const repeatTimers = new WeakMap<object, RepeatTimers>();
const knobRuntimes = new WeakMap<object, KnobRuntime>();
const interactiveInnerRadius = 84;
const interactiveOuterRadius = 118;

function runtimeFor(component: object): KnobRuntime {
  const current = knobRuntimes.get(component);
  if (current !== undefined) return current;
  const created: KnobRuntime = {
    centerX: 0,
    centerY: 0,
    lastAngle: null,
    dragBpm: null,
    lastEmittedBpm: null,
    visualAngle: 0,
    moved: false,
    isDragging: false,
  };
  knobRuntimes.set(component, created);
  return created;
}

Component({
  properties: {
    bpm: {
      type: Number,
      value: 120,
    },
    minimum: {
      type: Number,
      value: 20,
    },
    maximum: {
      type: Number,
      value: 300,
    },
    tempoMarking: {
      type: String,
      value: 'Moderato',
    },
  },

  observers: {
    // 按钮、输入框和 Tap Tempo 会从父页面更新 BPM；非拖动状态下同步拨针，
    // 避免中心数字已经变化而指示条仍停留在旧方向。拖动期间保留小数角度，
    // 防止父组件的整数回写打断连续视觉反馈。
    bpm(value: number) {
      if (!runtimeFor(this).isDragging) this.syncAngle(value);
    },
  },

  data: {
    angle: 0,
    isDragging: false,
  },

  lifetimes: {
    attached() {
      this.measureCenter();
    },
    ready() {
      // ready 阶段属性已经完成绑定，避免先按默认 120 BPM 绘制再错过已保存的速度。
      this.syncAngle(this.data.bpm);
    },
    detached() {
      this.stopRepeat();
      knobRuntimes.delete(this);
    },
  },

  methods: {
    syncAngle(bpm: number) {
      // 120 BPM 在正上方，每完整一圈代表 40 BPM。
      // 角度不限制在单圈内，CSS 会自然显示同余位置，拖动时也不会在边界处跳变。
      const angle = (bpm - 120) / 40 * 360;
      runtimeFor(this).visualAngle = angle;
      this.setData({ angle });
    },

    measureCenter(initialTouch?: { x: number; y: number }) {
      this.createSelectorQuery()
        .select('.knob-shell')
        .boundingClientRect((rect) => {
          if (rect === null) return;
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const runtime = runtimeFor(this);
          runtime.centerX = centerX;
          runtime.centerY = centerY;
          // 查询是异步的，不能依赖 setData 回写触摸起点；只有当前触摸仍在拖动时才接收结果。
          if (initialTouch !== undefined && runtime.isDragging) {
            runtime.lastAngle = this.angleFor(initialTouch.x, initialTouch.y, centerX, centerY);
          }
        })
        .exec();
    },

    onTouchStart(event: WechatMiniprogram.TouchEvent) {
      const touch = event.touches[0];
      if (touch === undefined) return;
      const x = touch.clientX ?? touch.pageX;
      const y = touch.clientY ?? touch.pageY;
      const runtime = runtimeFor(this);

      // 中心盘通过 catchtouch 阻止事件冒泡；这里再限制一次圆环命中范围，
      // 防止旋钮方形布局盒的四个角误启动旋转。
      if (runtime.centerX !== 0 && runtime.centerY !== 0) {
        const distance = Math.hypot(x - runtime.centerX, y - runtime.centerY);
        if (distance < interactiveInnerRadius || distance > interactiveOuterRadius) {
          // 中心点击不会进入拖动初始化，但必须清理上一轮拖动遗留的 moved，
          // 否则拖动结束后的第一次点击会被误判成仍在拖动。
          runtime.lastAngle = null;
          runtime.dragBpm = null;
          runtime.lastEmittedBpm = null;
          runtime.moved = false;
          runtime.isDragging = false;
          this.setData({ isDragging: false });
          return;
        }
      }

      runtime.lastAngle = null;
      runtime.dragBpm = this.data.bpm;
      runtime.lastEmittedBpm = this.data.bpm;
      runtime.visualAngle = (this.data.bpm - 120) / 40 * 360;
      runtime.moved = false;
      runtime.isDragging = true;
      this.setData({ isDragging: true });
      // 首次触摸时等待布局查询完成，再用同一个触点计算起始角度。
      this.measureCenter({ x, y });
      if (runtime.centerX !== 0 && runtime.centerY !== 0) {
        runtime.lastAngle = this.angleFor(x, y, runtime.centerX, runtime.centerY);
      }
    },

    onTouchMove(event: WechatMiniprogram.TouchEvent) {
      const touch = event.touches[0];
      const runtime = runtimeFor(this);
      const lastAngle = runtime.lastAngle;
      const dragBpm = runtime.dragBpm;
      if (touch === undefined || lastAngle === null || dragBpm === null) return;
      const x = touch.clientX ?? touch.pageX;
      const y = touch.clientY ?? touch.pageY;
      const angle = this.angleFor(x, y, runtime.centerX, runtime.centerY);
      let delta = angle - lastAngle;
      // atan2 在 -π/π 接缝处会跳变，归一化后才能保持旋转连续。
      if (delta > Math.PI) delta -= Math.PI * 2;
      if (delta < -Math.PI) delta += Math.PI * 2;
      const bpm = Math.max(
        this.data.minimum,
        Math.min(this.data.maximum, dragBpm + delta / (Math.PI * 2) * 40),
      );
      const effectiveDelta = bpm - dragBpm;
      runtime.visualAngle += effectiveDelta / 40 * 360;
      runtime.lastAngle = angle;
      runtime.dragBpm = bpm;
      runtime.moved = true;
      this.setData({ angle: runtime.visualAngle });
      const rounded = Math.round(bpm);
      if (rounded !== runtime.lastEmittedBpm) {
        runtime.lastEmittedBpm = rounded;
        this.triggerEvent('change', { bpm: rounded });
      }
    },

    onTouchEnd() {
      // 保留 moved 到 click 事件之后，避免一次拖动结束被误判为点击编辑。
      runtimeFor(this).isDragging = false;
      this.setData({ isDragging: false });
    },

    onTouchCancel() {
      this.onTouchEnd();
    },

    onTap() {
      const runtime = runtimeFor(this);
      if (!runtime.moved) this.triggerEvent('edit');
      runtime.lastAngle = null;
      runtime.dragBpm = null;
      runtime.lastEmittedBpm = null;
      runtime.moved = false;
    },

    onDecrease() {
      this.triggerEvent('decrease');
    },

    onIncrease() {
      this.triggerEvent('increase');
    },

    onDecreaseStart() {
      this.startRepeat(-1);
    },

    onIncreaseStart() {
      this.startRepeat(1);
    },

    onPressEnd() {
      this.stopRepeat();
    },

    startRepeat(delta: number) {
      this.stopRepeat();
      const timers: RepeatTimers = { delay: undefined, interval: undefined };
      repeatTimers.set(this, timers);
      // 短按由 tap 事件处理，长按 450ms 后按 90ms 连续调整。
      timers.delay = setTimeout(() => {
        timers.interval = setInterval(() => {
          this.triggerEvent(delta < 0 ? 'decrease' : 'increase');
        }, 90);
      }, 450);
    },

    stopRepeat() {
      const timers = repeatTimers.get(this);
      if (timers === undefined) return;
      if (timers.delay !== undefined) clearTimeout(timers.delay);
      if (timers.interval !== undefined) clearInterval(timers.interval);
      repeatTimers.delete(this);
    },

    angleFor(x: number, y: number, centerX: number, centerY: number): number {
      return Math.atan2(y - centerY, x - centerX);
    },
  },
});
