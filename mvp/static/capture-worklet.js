// Resamples the microphone to 16 kHz mono and posts 100 ms Float32 chunks plus an RMS level.
const TARGET_RATE = 16000;
const CHUNK = 1600;

class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / TARGET_RATE;
    this.t = 0; // read position, in input samples, relative to `prev`
    this.prev = 0;
    this.out = new Float32Array(CHUNK);
    this.n = 0;
    this.sumSq = 0;
    this.count = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    // Linear interpolation over [prev, ...ch] so consecutive blocks join seamlessly.
    const len = ch.length + 1;
    const at = (i) => (i === 0 ? this.prev : ch[i - 1]);
    let t = this.t;
    while (t + 1 < len) {
      const i = Math.floor(t);
      const f = t - i;
      this.out[this.n++] = at(i) * (1 - f) + at(i + 1) * f;
      if (this.n === CHUNK) {
        this.port.postMessage({ type: "audio", samples: this.out }, [this.out.buffer]);
        this.out = new Float32Array(CHUNK);
        this.n = 0;
      }
      t += this.ratio;
    }
    this.t = t - (len - 1);
    this.prev = ch[ch.length - 1];

    for (let i = 0; i < ch.length; i++) this.sumSq += ch[i] * ch[i];
    this.count += ch.length;
    if (this.count >= sampleRate / 20) {
      this.port.postMessage({ type: "level", rms: Math.sqrt(this.sumSq / this.count) });
      this.sumSq = 0;
      this.count = 0;
    }
    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
