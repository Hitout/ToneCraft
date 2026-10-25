import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Subdivision } from '../../miniprogram/core/metronome/metronome-config';

const newRhythms: Subdivision[] = [
  'dotted-eighth-sixteenth',
  'sixteenth-dotted-eighth',
  'eighth-sixteenth-sixteenth',
  'sixteenth-sixteenth-eighth',
  'sixteenth-eighth-sixteenth',
  'eighth-note-rest',
  'sixteenth-rest-note-note-note',
  'eighth-rest-sixteenth-sixteenth',
  'sixteenth-sixteenth-eighth-rest',
  'sixteenth-note-note-rest-note',
  'sixteenth-eighth-rest-sixteenth',
  'sixteenth-rest-note-note-rest',
];

interface MetronomePage {
  data: Record<string, any>;
  model: import('../../miniprogram/core/metronome/metronome-model').MetronomeModel;
  setData(patch: Record<string, unknown>): void;
  renderState(state: unknown): void;
  openPicker(event: unknown): void;
  selectOption(event: unknown): void;
  selectCustomBeat(event: unknown): void;
  toggleCustomSubdivision(): void;
}

async function setup() {
  vi.resetModules();
  vi.useFakeTimers();
  const values = new Map<string, unknown>();
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => values.get(key),
    setStorageSync: (key: string, value: unknown) => values.set(key, value),
  });
  let page!: MetronomePage;
  vi.stubGlobal('Page', (definition: MetronomePage) => {
    page = {
      ...definition,
      data: { ...definition.data },
      setData(patch) { Object.assign(this.data, patch); },
    };
  });
  await import('../../miniprogram/pages/metronome/metronome');
  const { MetronomeModel } = await import('../../miniprogram/core/metronome/metronome-model');
  page.model = new MetronomeModel();
  page.model.initialize();
  const unsubscribe = page.model.subscribe((state) => page.renderState(state));
  return { page, dispose() { unsubscribe(); page.model.dispose(); } };
}

function event(dataset: Record<string, unknown>) {
  return { currentTarget: { dataset } };
}

afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('节拍器新增节奏', () => {
  it('显示全部二十项，并把新增选项应用到统一节奏和卡片图标', async () => {
    const { page, dispose } = await setup();
    try {
      for (const rhythm of newRhythms) {
        page.openPicker(event({ type: 'subdivision' }));
        expect(page.data.options).toHaveLength(20);
        expect(page.data.optionLayout).toBe('grid5');
        const option = page.data.options.find((item: { value: string }) => item.value === rhythm);
        expect(option.icon).toBe(`../../assets/icons/metronome/subdivision/${rhythm}.svg`);
        expect(option.label).toContain('分');
        page.selectOption(event({ value: rhythm }));
        expect(page.model.currentState.config.subdivision).toBe(rhythm);
        expect(page.data.subdivisionIcon).toBe(option.icon);
        page.openPicker(event({ type: 'subdivision' }));
        expect(page.data.options.filter((item: { selected: boolean }) => item.selected)).toEqual([
          { ...option, selected: true },
        ]);
      }
    } finally { dispose(); }
  });

  it('逐拍选择仅更新目标拍，并同步预览和选中状态', async () => {
    const { page, dispose } = await setup();
    try {
      page.openPicker(event({ type: 'subdivision' }));
      page.toggleCustomSubdivision();
      page.selectCustomBeat(event({ index: 1 }));
      for (const rhythm of newRhythms) {
        page.selectOption(event({ value: rhythm }));
        expect(page.model.currentState.config.beatSubdivisions).toEqual([
          'quarter', rhythm, 'quarter', 'quarter',
        ]);
        expect(page.data.beatSubdivisions[1].icon).toContain(`${rhythm}.svg`);
        expect(page.data.subdivisionPreview[1].icon).toContain(`${rhythm}.svg`);
        expect(page.data.options.find((item: { value: string }) => item.value === rhythm).selected).toBe(true);
      }
    } finally { dispose(); }
  });
});
