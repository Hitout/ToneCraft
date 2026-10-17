import { afterEach, describe, expect, it, vi } from 'vitest';

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type Method = (this: TestComponent, ...args: any[]) => any;

interface ComponentDefinition {
  data: Record<string, any>;
  properties: Record<string, { value: unknown }>;
  methods: Record<string, Method>;
  lifetimes: Record<string, Method>;
  pageLifetimes: Record<string, Method>;
}

interface TestComponent {
  data: Record<string, any>;
  definition: ComponentDefinition;
  triggerEvent: ReturnType<typeof vi.fn>;
  [method: string]: any;
}

function environment(initialRect: Rect) {
  let rect = initialRect;
  const ticks: Array<() => void> = [];
  const canvas = Object.fromEntries([
    'clearRect', 'save', 'scale', 'restore', 'setLineWidth', 'setLineCap',
    'beginPath', 'setStrokeStyle', 'arc', 'stroke', 'moveTo', 'lineTo',
    'setFontSize', 'setTextAlign', 'setTextBaseline', 'setFillStyle',
    'fillText', 'setShadow', 'fill', 'draw',
  ].map((method) => [method, vi.fn()]));
  const createSelectorQuery = () => {
    let callback: (value: Rect) => void;
    const query = {
      in() { return query; },
      select() { return query; },
      boundingClientRect(handler: typeof callback) { callback = handler; return query; },
      exec() { callback(rect); },
    };
    return query;
  };

  vi.stubGlobal('wx', {
    nextTick(callback: () => void) { ticks.push(callback); },
    createSelectorQuery,
    createCanvasContext: () => canvas,
  });

  let component!: TestComponent;
  vi.stubGlobal('Component', (definition: ComponentDefinition) => {
    component = {
      ...definition.methods,
      definition,
      data: {
        ...Object.fromEntries(Object.entries(definition.properties).map(([name, property]) => [name, property.value])),
        ...definition.data,
      },
      setData(patch: Record<string, unknown>) { Object.assign(this.data, patch); },
      createSelectorQuery,
      triggerEvent: vi.fn(),
    };
  });

  return {
    component: () => component,
    move(nextRect: Rect) { rect = nextRect; },
    resize(nextRect: Rect) {
      rect = nextRect;
      component.definition.pageLifetimes.resize.call(component);
      ticks.splice(0).forEach((callback) => callback());
    },
    canvas,
  };
}

function touch(x: number, y: number) {
  return { touches: [{ clientX: x, clientY: y }] };
}

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('平板组件尺寸变化', () => {
  it('放大旋钮的圆环仍能拖动，内盘和外侧不误触', async () => {
    vi.resetModules();
    const env = environment({ left: 100, top: 200, width: 330.4, height: 330.4 });
    await import('../../miniprogram/components/tempo-knob/index');
    const component = env.component();
    component.definition.lifetimes.attached.call(component);

    component.onTouchStart(touch(415.2, 365.2));
    expect(component.data.isDragging).toBe(true);
    component.onTouchMove(touch(265.2, 515.2));
    expect(component.triggerEvent).toHaveBeenCalledWith('change', { bpm: 130 });
    component.onTouchEnd();

    component.onTouchStart(touch(365.2, 365.2));
    expect(component.data.isDragging).toBe(false);
    component.onTouchStart(touch(435.2, 365.2));
    expect(component.data.isDragging).toBe(false);
  });

  it('分屏后使用新圆心并停止旧拖动和长按', async () => {
    vi.resetModules();
    vi.useFakeTimers();
    const env = environment({ left: 100, top: 200, width: 330.4, height: 330.4 });
    await import('../../miniprogram/components/tempo-knob/index');
    const component = env.component();
    component.definition.lifetimes.attached.call(component);
    component.onTouchStart(touch(415.2, 365.2));
    component.startRepeat(1);

    env.resize({ left: 20, top: 100, width: 236, height: 236 });
    expect(component.data.isDragging).toBe(false);
    component.onTouchMove(touch(265.2, 515.2));
    vi.advanceTimersByTime(1000);
    expect(component.triggerEvent).not.toHaveBeenCalled();

    component.onTouchStart(touch(238, 218));
    component.onTouchMove(touch(138, 318));
    expect(component.triggerEvent).toHaveBeenCalledWith('change', { bpm: 130 });
  });

  it('页面滚动后首次触摸使用当前圆心，不沿用滚动前的命中范围', async () => {
    vi.resetModules();
    const env = environment({ left: 100, top: 200, width: 330.4, height: 330.4 });
    await import('../../miniprogram/components/tempo-knob/index');
    const component = env.component();
    component.definition.lifetimes.attached.call(component);

    env.move({ left: 100, top: 100, width: 330.4, height: 330.4 });
    component.onTouchStart(touch(415.2, 265.2));
    expect(component.data.isDragging).toBe(true);
    component.onTouchMove(touch(265.2, 415.2));
    expect(component.triggerEvent).toHaveBeenCalledWith('change', { bpm: 130 });
  });

  it('表盘按实测高度绘制，缩小后指示器仍与圆弧重合', async () => {
    vi.resetModules();
    const env = environment({ left: 0, top: 0, width: 616, height: 294 });
    await import('../../miniprogram/components/tuner-gauge/index');
    const component = env.component();
    component.definition.lifetimes.ready.call(component);
    expect(env.canvas.clearRect).toHaveBeenLastCalledWith(0, 0, 616, 294);
    expect(env.canvas.scale).toHaveBeenLastCalledWith(1.4, 1.4);
    expect(component.data.knobLeft + 21.5 * 1.4).toBeCloseTo(308);
    expect(component.data.knobTop + 17.5 * 1.4).toBeCloseTo(294 * 0.08);

    component.data.displayCents = 50;
    env.resize({ left: 0, top: 0, width: 340, height: 210 });
    expect(env.canvas.clearRect).toHaveBeenLastCalledWith(0, 0, 340, 210);
    expect(env.canvas.scale).toHaveBeenLastCalledWith(1, 1);
    expect(component.data.knobLeft + 21.5).toBeCloseTo(170 + 340 * 0.42);
    expect(component.data.knobTop + 17.5).toBeCloseTo(210 * 0.78);
  });

  it('趋势图在分屏后重新映射已有音高和时间轴', async () => {
    vi.resetModules();
    const env = environment({ left: 0, top: 0, width: 582, height: 126 });
    await import('../../miniprogram/components/pitch-trend/index');
    const component = env.component();
    component.data.values = [{ cents: 0, capturedAt: 1000 }, { cents: 25, capturedAt: 1100 }];
    component.definition.lifetimes.ready.call(component);
    expect(component.data.segments[0].top).toBe(62);
    expect(component.data.gridLines[4].top).toBe(126);

    env.resize({ left: 0, top: 0, width: 290, height: 98 });
    expect(component.data.segments).toHaveLength(1);
    expect(component.data.segments[0].left).toBeCloseTo(28 + 7900 / 8000 * (290 - 28));
    expect(component.data.segments[0].top).toBe(48);
    expect(component.data.gridLines[4].top).toBe(98);
  });

  it('节拍滑块在窗口变宽后仍与首尾节拍柱对齐且保持播放状态', async () => {
    vi.resetModules();
    const env = environment({ left: 0, top: 0, width: 318, height: 24 });
    await import('../../miniprogram/components/pendulum/index');
    const component = env.component();
    component.data.playing = true;
    component.definition.lifetimes.ready.call(component);
    const animationName = component.data.animationName;
    expect(component.data.trackStart).toBeCloseTo(5.25);

    env.resize({ left: 0, top: 0, width: 580, height: 24 });
    expect(component.data.trackStart).toBeCloseTo(38);
    expect(component.data.trackWidth).toBeCloseTo(504);
    expect(component.data.animationName).toBe(animationName);
    expect(component.data.playing).toBe(true);
  });
});
