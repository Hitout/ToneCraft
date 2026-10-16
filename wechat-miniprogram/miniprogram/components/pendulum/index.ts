import { calculatePendulumTrack } from './pendulum-geometry';
import {
  normalizePendulumDurationMs,
  retimePendulumAnimation,
} from './pendulum-animation';

interface PendulumRuntime {
  animationName: 'none' | 'slider-slide-a' | 'slider-slide-b';
  animationStartAt: number | null;
  durationMs: number;
  playing: boolean;
}

const pendulumRuntimes = new WeakMap<object, PendulumRuntime>();

function runtimeFor(component: object): PendulumRuntime {
  const current = pendulumRuntimes.get(component);
  if (current !== undefined) return current;
  const created: PendulumRuntime = {
    animationName: 'none',
    animationStartAt: null,
    durationMs: 1,
    playing: false,
  };
  pendulumRuntimes.set(component, created);
  return created;
}

function monotonicNow(): number {
  // 动画相位只需要同一组件内保持单调，优先使用高精度时钟避免频繁改速时误差累积。
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function nextAnimationName(
  current: PendulumRuntime['animationName'],
): Exclude<PendulumRuntime['animationName'], 'none'> {
  return current === 'slider-slide-a' ? 'slider-slide-b' : 'slider-slide-a';
}

Component({
  properties: {
    playing: {
      type: Boolean,
      value: false,
    },
    beatDurationMs: {
      type: Number,
      value: 500,
    },
    beatCount: {
      type: Number,
      value: 4,
      observer() {
        this.measureTrack();
      },
    },
  },

  data: {
    trackStart: 0,
    trackWidth: 0,
    animationName: 'none',
    animationDurationMs: 500,
    animationDelayMs: 0,
  },

  observers: {
    // 训练会在播放中改变 BPM；修改时长前先保存当前相位，避免 CSS 重新解释进度。
    'playing, beatDurationMs'(playing: boolean, beatDurationMs: number) {
      this.syncAnimation(playing, beatDurationMs);
    },
  },

  lifetimes: {
    ready() {
      this.measureTrack();
      this.syncAnimation(this.data.playing, this.data.beatDurationMs);
    },
    detached() {
      pendulumRuntimes.delete(this);
    },
  },

  methods: {
    syncAnimation(playing: boolean, beatDurationMs: number) {
      const runtime = runtimeFor(this);
      const durationMs = normalizePendulumDurationMs(beatDurationMs);

      if (!playing) {
        runtime.playing = false;
        runtime.animationStartAt = null;
        runtime.durationMs = durationMs;
        runtime.animationName = 'none';
        this.setData({
          animationName: 'none',
          animationDurationMs: durationMs,
          animationDelayMs: 0,
        });
        return;
      }

      if (!runtime.playing || runtime.animationStartAt === null) {
        runtime.playing = true;
        runtime.durationMs = durationMs;
        runtime.animationStartAt = monotonicNow();
        runtime.animationName = nextAnimationName(runtime.animationName);
        this.setData({
          animationName: runtime.animationName,
          animationDurationMs: durationMs,
          animationDelayMs: 0,
        });
        return;
      }

      if (runtime.durationMs === durationMs) return;

      const now = monotonicNow();
      const timing = retimePendulumAnimation(
        runtime.animationStartAt,
        runtime.durationMs,
        durationMs,
        now,
      );
      runtime.durationMs = timing.durationMs;
      runtime.animationStartAt = timing.startAt;
      runtime.animationName = nextAnimationName(runtime.animationName);
      this.setData({
        animationName: runtime.animationName,
        animationDurationMs: timing.durationMs,
        animationDelayMs: timing.delayMs,
      });
    },

    measureTrack() {
      this.createSelectorQuery()
        .select('.beat-slider')
        .boundingClientRect((rect) => {
          if (rect === null) return;
          const width = rect.width;
          const track = calculatePendulumTrack(width, this.data.beatCount);
          this.setData({
            trackStart: track.start,
            trackWidth: track.width,
          });
        })
        .exec();
    },
  },
});
