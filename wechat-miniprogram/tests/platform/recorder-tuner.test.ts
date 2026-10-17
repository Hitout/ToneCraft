import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RecorderTuner } from '../../miniprogram/platform/recorder-tuner';

class FakeRecorder {
  frame: (event: { frameBuffer: ArrayBuffer }) => void = () => {};
  start = vi.fn();
  stop = vi.fn();
  onFrameRecorded(listener: typeof this.frame): void { this.frame = listener; }
  onError(): void {}
  onInterruptionBegin(): void {}
  onInterruptionEnd(): void {}
  push(value: number): void { this.frame({ frameBuffer: new Int16Array(4096).fill(value).buffer }); }
  tone(frequencyHz: number): void {
    const pcm = Int16Array.from({ length: 4096 }, (_, index) =>
      Math.round(Math.sin(2 * Math.PI * frequencyHz * index / 16000) * 10000));
    this.frame({ frameBuffer: pcm.buffer });
  }
}

class FakeWorker {
  message: (value: unknown) => void = () => {};
  postMessage = vi.fn();
  terminate = vi.fn();
  onMessage(listener: typeof this.message): void { this.message = listener; }
  onProcessKilled(): void {}
  ready(): void { this.message({ type: 'ready' }); }
  reply(index: number, frequencyHz: number | null, confidence = 0.99): void {
    this.message({ type: 'result', id: this.postMessage.mock.calls[index][0].id,
      pitch: frequencyHz === null ? null : { frequencyHz, confidence, rms: 0.05 } });
  }
}

let active: RecorderTuner | null = null;
async function setup(platform = 'ios') {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const recorder = new FakeRecorder();
  const workers: FakeWorker[] = [];
  const createWorker = vi.fn(() => { const worker = new FakeWorker(); workers.push(worker); return worker; });
  vi.stubGlobal('wx', { getRecorderManager: () => recorder, getSystemInfoSync: () => ({ platform }), createWorker });
  const { recorderTuner } = await import('../../miniprogram/platform/recorder-tuner');
  active = recorderTuner;
  const onPitch = vi.fn();
  recorderTuner.setCallbacks({ onPitch, onUnavailable: vi.fn(), onInterrupted: vi.fn() });
  recorderTuner.start();
  return { tuner: recorderTuner, recorder, workers, createWorker, onPitch };
}

afterEach(() => { active?.stop(); active = null; vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('调音录音会话', () => {
  it('iOS 等待线程握手，忙碌期间仅保留最新 PCM，并使用采集时间追踪音高', async () => {
    const { recorder, workers, onPitch } = await setup();
    expect(recorder.start.mock.calls[0][0]).toMatchObject({ frameSize: 1, audioSource: 'buildInMic' });
    recorder.push(1000);
    expect(workers[0].postMessage).toHaveBeenCalledTimes(1);
    workers[0].ready();
    vi.setSystemTime(1064);
    recorder.push(2000);
    recorder.push(3000);
    expect(workers[0].postMessage).toHaveBeenCalledTimes(2);
    vi.setSystemTime(1128);
    workers[0].reply(1, 110);
    const latest = workers[0].postMessage.mock.calls[2][0].samples as number[];
    expect(latest.every((sample) => sample === 3000 / 32768)).toBe(true);
    workers[0].reply(2, 110);
    expect(onPitch).toHaveBeenCalledTimes(1);
    expect(onPitch.mock.calls[0][0]).toMatchObject({ frequencyHz: 110, capturedAt: 1128 });
  });

  it('安卓维持原录音配置与检测精度，不启动 Worker', async () => {
    const { recorder, createWorker, onPitch } = await setup('android');
    expect(recorder.start.mock.calls[0][0]).toMatchObject({ frameSize: 4, audioSource: 'auto' });
    recorder.tone(110);
    vi.setSystemTime(1128);
    recorder.tone(110);
    expect(createWorker).not.toHaveBeenCalled();
    expect(onPitch.mock.calls[0][0].frequencyHz).toBeCloseTo(110, 0);
  });

  it.each([
    [250, 0.99, 11],
    [150, 0.82, 10],
    [500, 0.82, 10],
  ])('iOS 每次分析耗时 %ims、置信度 %f 时仍能确认并持续输出音高', async (latencyMs, confidence, outputs) => {
    const { recorder, workers, onPitch } = await setup();
    workers[0].ready();
    for (let index = 1; index <= 12; index++) {
      recorder.push(1000);
      vi.advanceTimersByTime(latencyMs);
      workers[0].reply(index, 110, confidence);
    }
    expect(onPitch).toHaveBeenCalledTimes(outputs);
    expect(onPitch.mock.calls[0][0]).toMatchObject({ frequencyHz: 110, startsNewTrack: true });
    expect(onPitch.mock.calls[outputs - 1][0]).toMatchObject({
      frequencyHz: 110, capturedAt: 1000 + 11 * latencyMs, startsNewTrack: false,
    });
  });

  it('慢速分析之间存在静音窗口时，重新拨弦仍需重新确认', async () => {
    const { recorder, workers, onPitch } = await setup();
    workers[0].ready();
    for (const [index, frequencyHz] of [110, 110, null, null, 110, 110].entries()) {
      recorder.push(1000);
      vi.advanceTimersByTime(500);
      workers[0].reply(index + 1, frequencyHz);
      if (index === 4) expect(onPitch).toHaveBeenCalledTimes(1);
    }
    expect(onPitch).toHaveBeenCalledTimes(2);
    expect(onPitch.mock.calls[1][0]).toMatchObject({ capturedAt: 3500, startsNewTrack: true });
  });

  it('长时间没有采集数据时不会将空闲时长当作线程耗时来延续旧音轨', async () => {
    const { recorder, workers, onPitch } = await setup();
    workers[0].ready();
    for (let index = 1; index <= 2; index++) {
      recorder.push(1000);
      vi.advanceTimersByTime(250);
      workers[0].reply(index, 110);
    }
    expect(onPitch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2000);
    recorder.push(1000);
    vi.advanceTimersByTime(250);
    workers[0].reply(3, 110);
    expect(onPitch).toHaveBeenCalledTimes(1);
    recorder.push(1000);
    vi.advanceTimersByTime(250);
    workers[0].reply(4, 110);
    expect(onPitch).toHaveBeenCalledTimes(2);
    expect(onPitch.mock.calls[1][0]).toMatchObject({ capturedAt: 3750, startsNewTrack: true });
  });

  it('停止重启后旧线程的晚到结果不能进入新会话', async () => {
    const { tuner, recorder, workers, onPitch } = await setup();
    workers[0].ready();
    recorder.push(1000);
    tuner.stop();
    tuner.start();
    workers[1].ready();
    vi.setSystemTime(2000);
    recorder.push(2000);
    workers[0].reply(1, 110);
    workers[1].reply(1, 220);
    vi.setSystemTime(2100);
    recorder.push(2000);
    workers[1].reply(2, 220);
    expect(onPitch).toHaveBeenCalledTimes(1);
    expect(onPitch.mock.calls[0][0].frequencyHz).toBe(220);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
  });

  it('线程启动失败后仅回退一次，并直接分析最新声音而非旧窗口', async () => {
    const { recorder, workers, onPitch, createWorker } = await setup();
    recorder.tone(110);
    vi.advanceTimersByTime(1000);
    recorder.tone(220);
    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(100);
    recorder.tone(220);
    expect(onPitch).toHaveBeenCalledTimes(1);
    expect(onPitch.mock.calls[0][0].frequencyHz).toBeCloseTo(220, 0);
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(workers[0].terminate).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});
