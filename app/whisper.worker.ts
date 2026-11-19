// Speech to text on this device: the audio never leaves the browser. Input: 16 kHz mono Float32Array.
import { pipeline } from "@huggingface/transformers";

// English-only base model: downloaded on first use, then browser-cached. Chosen for Indian-accented English
// (2026-11-19, synthetic en-IN / hi-IN voices, WASM): tiny.en 4.2% WER at 2.7 s/clip, base.en 1.6% at 5.4 s,
// small.en 0.9% at 18 s (too slow for live text). ponytail: try small.en if WebGPU devices are the norm.
const MODEL = "onnx-community/whisper-base.en";

async function load() {
  // navigator.gpu exists on some machines that have no usable adapter, so ask for one
  const gpu = !!(await (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter().catch(() => null));
  return pipeline("automatic-speech-recognition", MODEL, {
    device: gpu ? "webgpu" : "wasm",
    dtype: gpu ? { encoder_model: "fp32", decoder_model_merged: "q4" } : "q8",
    progress_callback: (p) => p.status === "progress_total" && postMessage({ progress: p.progress }),
  });
}

let asr: ReturnType<typeof load> | undefined;

self.onmessage = async ({ data }: MessageEvent<Float32Array>) => {
  try {
    asr ??= load();
    const out = await (await asr)(data, { chunk_length_s: 30 }); // 30 s windows, so long recordings work too
    postMessage({ text: (Array.isArray(out) ? out[0] : out).text.trim() });
  } catch (e) {
    asr = undefined; // a failed download is tried again on the next recording
    console.error("[whisper]", e);
    postMessage({ error: "Voice input could not start. Check the connection and try again." });
  }
};
