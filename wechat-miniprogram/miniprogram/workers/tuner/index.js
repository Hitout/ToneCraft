const { detectPitch } = require('./yin-detector');

worker.onMessage((raw) => {
  const message = raw.message || raw;
  if (message.type === 'init') {
    worker.postMessage({ type: 'ready' });
  } else if (message.type === 'analyze') {
    try {
      const pitch = detectPitch(new Float32Array(message.samples), message.sampleRate, 0.20);
      worker.postMessage({ type: 'result', id: message.id, pitch });
    } catch (error) {
      worker.postMessage({ type: 'error', error: String(error) });
    }
  }
});
