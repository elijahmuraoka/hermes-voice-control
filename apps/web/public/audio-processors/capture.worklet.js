class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.bufferSize = 2048;
  }
  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0] || input[0].length === 0) return true;
    const channel = input[0];
    for (let i = 0; i < channel.length; i++) this.buffer.push(channel[i]);
    while (this.buffer.length >= this.bufferSize) {
      const chunk = this.buffer.splice(0, this.bufferSize);
      this.port.postMessage({ type: "audio", data: new Float32Array(chunk) });
    }
    return true;
  }
}
registerProcessor("audio-capture-processor", AudioCaptureProcessor);
