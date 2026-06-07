class PCMPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = [];
    this.current = null;
    this.offset = 0;
    this.port.onmessage = (event) => {
      if (event.data === "interrupt") {
        this.queue = [];
        this.current = null;
        this.offset = 0;
        return;
      }
      if (event.data instanceof Float32Array) this.queue.push(event.data);
    };
  }
  process(_inputs, outputs) {
    const output = outputs[0];
    if (!output || !output[0]) return true;
    const left = output[0];
    const right = output[1] || left;
    for (let i = 0; i < left.length; i++) {
      if (!this.current || this.offset >= this.current.length) {
        this.current = this.queue.shift() || null;
        this.offset = 0;
      }
      const sample = this.current ? this.current[this.offset++] : 0;
      left[i] = sample;
      right[i] = sample;
    }
    return true;
  }
}
registerProcessor("pcm-playback-processor", PCMPlaybackProcessor);
