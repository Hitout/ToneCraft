import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PitchAnalysisWorker } from '../../miniprogram/platform/pitch-analysis-worker';

class FakeWorker {
  message: (value: unknown) => void = () => {};
  killed: () => void = () => {};
  sent: Record<string, unknown>[] = [];
  terminate = vi.fn();
  onMessage(listener: typeof this.message): void { this.message = listener; }
  onProcessKilled(listener: typeof this.killed): void { this.killed = listener; }
  postMessage(value: unknown): void { this.sent.push(JSON.parse(JSON.stringify(value))); }
}

function setup() {
  vi.useFakeTimers();
  const port = new FakeWorker();
  const createWorker = vi.fn(() => port);
  vi.stubGlobal('wx', { createWorker });
  const callbacks = { onReady: vi.fn(), onPitch: vi.fn(), onError: vi.fn() };
  const client = new PitchAnalysisWorker(callbacks);
  return { port, client, callbacks, createWorker };
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('调音计算线程', () => {
  it('握手成功后才发送窗口，使用 JSON 数组且不堆积在途任务', () => {
    const { port, client, callbacks, createWorker } = setup();
    expect(createWorker).toHaveBeenCalledWith('workers/tuner/index.js');
    client.analyze(new Float32Array([1, 2]), 16000, 100);
    expect(port.sent).toEqual([{ type: 'init' }]);
    port.message({ message: { type: 'ready' } });
    expect(callbacks.onReady).toHaveBeenCalledTimes(1);
    client.analyze(new Float32Array([1, 2]), 16000, 100);
    client.analyze(new Float32Array([3, 4]), 16000, 200);
    expect(port.sent[1]).toEqual({ type: 'analyze', id: 1, samples: [1, 2], sampleRate: 16000 });
    expect(port.sent).toHaveLength(2);
    port.message({ type: 'result', id: 999, pitch: null });
    expect(callbacks.onPitch).not.toHaveBeenCalled();
    port.message({ type: 'result', id: 1, pitch: null });
    expect(callbacks.onPitch).toHaveBeenCalledWith(null, 100);
    expect(client.ready).toBe(true);
    client.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('握手超时或系统回收只报告一次失败，终止后忽略晚到结果', () => {
    const { port, client, callbacks } = setup();
    vi.advanceTimersByTime(2000);
    port.killed();
    port.message({ type: 'ready' });
    port.message({ type: 'result', id: 1, pitch: null });
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(callbacks.onPitch).not.toHaveBeenCalled();
    expect(port.terminate).toHaveBeenCalledTimes(1);
    client.dispose();
  });

  it('页面停止会立即取消看门狗，已关闭线程不能再输出音高', () => {
    const { port, client, callbacks } = setup();
    port.message({ type: 'ready' });
    client.analyze(new Float32Array([1]), 16000, 100);
    client.dispose();
    port.message({ type: 'result', id: 1, pitch: { frequencyHz: 110 } });
    vi.advanceTimersByTime(3000);
    expect(callbacks.onPitch).not.toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });
});

describe('真实 Worker 打包与消息协议', () => {
  it('同一检测器经过 JSON 序列化后仍能识别标准音、弱音和静音，计算不依赖定时器', () => {
    const root = resolve(process.cwd(), 'miniprogram');
    const source = readFileSync(resolve(root, 'core/tuner/yin-detector.ts'), 'utf8');
    const compiled = readFileSync(resolve(root, 'workers/tuner/yin-detector.js'), 'utf8');
    expect(compiled).toBe(ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2018, module: ts.ModuleKind.CommonJS },
    }).outputText);
    const detector = { exports: {} };
    const forbidTimer = () => { throw new Error('音高计算不得依赖定时器'); };
    runInNewContext(compiled, { exports: detector.exports, Float32Array, Float64Array, setTimeout: forbidTimer });
    const port = new FakeWorker();
    runInNewContext(readFileSync(resolve(root, 'workers/tuner/index.js'), 'utf8'), {
      worker: port,
      Float32Array,
      setTimeout: forbidTimer,
      require: () => detector.exports,
    });
    port.message({ type: 'init' });
    expect(port.sent[0]).toEqual({ type: 'ready' });
    for (const [id, frequencyHz] of [36.71, 82.41, 110, 329.63, 0].entries()) {
      const samples = Array.from({ length: 4096 }, (_, index) => Math.sin(2 * Math.PI * frequencyHz * index / 16000) * 0.004);
      port.message(JSON.parse(JSON.stringify({ type: 'analyze', id, samples, sampleRate: 16000 })));
      const result = port.sent[port.sent.length - 1];
      expect(result.type).toBe('result');
      if (frequencyHz === 0) expect(result.pitch).toBeNull();
      else expect((result.pitch as { frequencyHz: number }).frequencyHz).toBeCloseTo(frequencyHz, 0);
    }
  });
});
