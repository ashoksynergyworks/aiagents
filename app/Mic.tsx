"use client";

import { Fragment, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

const MAX_RECORDING_MS = 60_000;

export type Live = { text: string; progress: number | null }; // words heard so far while recording; model download %

// One worker, so one copy of the model, for every mic on the page. It answers one transcription at a time.
// ponytail: lives as long as the tab; terminate it if memory matters on low-end devices.
let worker: Worker | null = null;
let queue: Promise<unknown> = Promise.resolve();

function run(audio: Float32Array, onProgress: (p: number) => void) {
  const job = queue.then(
    () =>
      new Promise<string>((resolve, reject) => {
        const w = (worker ??= new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" }));
        w.onmessage = ({ data }) => {
          if ("progress" in data) onProgress(Math.round(data.progress));
          else if (data.error) reject(new Error(data.error));
          else resolve(data.text);
        };
        w.onerror = () => {
          worker = null; // the next recording starts a new worker
          reject(new Error("Voice input could not start. Reload the page and try again."));
        };
        w.postMessage(audio);
      }),
  );
  queue = job.catch(() => {});
  return job;
}

// Voice input. Whisper runs in a worker on this device (whisper.worker.ts), so the audio never leaves the browser.
// The model downloads on the first recording only. fieldId: the field that gets focus when the text is in.
export function Mic({
  fieldId,
  label,
  onText,
  setLive,
  onError,
}: {
  fieldId: string;
  label: string;
  onText: (text: string) => void;
  setLive: Dispatch<SetStateAction<Live | null>>;
  onError: (message: string) => void;
}) {
  const [state, setState] = useState<"idle" | "recording" | "working">("idle");
  const [progress, setProgress] = useState<number | null>(null); // model download %, first use only
  const rec = useRef<MediaRecorder | null>(null);

  useEffect(
    () => () => {
      if (rec.current) {
        rec.current.onstop = null;
        rec.current.stream.getTracks().forEach((t) => t.stop()); // turn the mic off when the page closes mid-recording
      }
    },
    [],
  );

  async function transcribe(blob: Blob) {
    const ctx = new AudioContext({ sampleRate: 16000 }); // decoding resamples to the context rate Whisper needs
    const audio = (await ctx.decodeAudioData(await blob.arrayBuffer()).finally(() => ctx.close())).getChannelData(0);
    // Whisper writes "you" for silence. ponytail: fixed peak threshold; lower it if quiet mics are rejected.
    if (!audio.some((v) => Math.abs(v) > 0.02)) return "";
    return run(audio, (p) => {
      setProgress(p);
      setLive((l) => l && { ...l, progress: p });
    });
  }

  async function start() {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return onError("Allow microphone access in the browser to use voice input.");
    }
    onError("");
    const chunks: Blob[] = [];
    const r = new MediaRecorder(stream);
    const timer = setTimeout(() => r.state === "recording" && r.stop(), MAX_RECORDING_MS);
    let partial = false;
    // Each second: transcribe everything so far and show it while the user speaks. A tick is skipped while the last
    // one runs, so a slow device updates less often instead of queueing work.
    // ponytail: re-reads the whole recording each tick (fine up to the 60 s cap); stream only new audio if that grows.
    r.ondataavailable = (e) => {
      chunks.push(e.data);
      if (partial || r.state !== "recording") return;
      partial = true;
      transcribe(new Blob(chunks, { type: r.mimeType }))
        .then((text) => void (text && setLive((l) => l && { ...l, text })))
        .catch(() => {}) // a cut-off recording can fail to decode (Safari); the final pass still runs
        .finally(() => (partial = false));
    };
    r.onstop = async () => {
      clearTimeout(timer);
      stream.getTracks().forEach((t) => t.stop());
      rec.current = null;
      setState("working");
      try {
        const text = await transcribe(new Blob(chunks, { type: r.mimeType })); // queued after a running tick
        if (text) {
          onText(text);
          // after the field is back: the user reviews the text, caret at the end
          requestAnimationFrame(() => {
            const f = document.getElementById(fieldId) as HTMLTextAreaElement | null;
            f?.focus();
            f?.setSelectionRange(f.value.length, f.value.length);
          });
        } else onError("No speech was heard. Speak closer to the microphone and try again.");
      } catch (e) {
        onError(e instanceof Error && e.message.startsWith("Voice") ? e.message : "The recording could not be read. Try again.");
      }
      setLive(null);
      setProgress(null);
      setState("idle");
    };
    r.start(1000);
    rec.current = r;
    setLive({ text: "", progress: null });
    setState("recording");
  }

  const downloading = state === "working" && progress != null && progress < 100;
  const status =
    state === "recording" ? "Stop recording" : downloading ? `Loading voice model, ${progress}%` : state === "working" ? "Transcribing" : label;
  return (
    <>
      <button
        type="button"
        aria-label={status}
        title={status}
        aria-pressed={state === "recording"}
        aria-disabled={state === "working"}
        onClick={state === "recording" ? () => rec.current?.stop() : state === "idle" ? start : undefined}
        className={`relative grid size-12 shrink-0 place-items-center rounded-xl transition-[background-color,color,transform] duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary ${
          state === "recording"
            ? "cursor-pointer bg-secondary/10 text-secondary active:scale-95"
            : state === "working"
              ? "cursor-progress text-primary"
              : "cursor-pointer text-muted hover:bg-primary-soft hover:text-primary active:scale-95"
        }`}
      >
        {/* live ring while the mic is on: a clear privacy cue */}
        {state === "recording" && (
          <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-xl ring-2 ring-secondary/40 motion-reduce:hidden" />
        )}
        {downloading ? (
          <span className="text-xs font-medium tabular-nums">{progress}%</span>
        ) : state === "working" ? (
          <span aria-hidden="true" className="inline-flex gap-1">
            {[0, 1, 2].map((k) => (
              <span
                key={k}
                style={{ animationDelay: `${k * 160}ms` }}
                className="size-1.5 animate-typing rounded-full bg-primary/30 motion-reduce:animate-none"
              />
            ))}
          </span>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-5">
            <path d={state === "recording" ? "M7 7h10v10H7z" : "M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3zM19 10v2a7 7 0 0 1-14 0v-2M12 19v3"} />
          </svg>
        )}
      </button>
      <span className="sr-only" aria-live="polite">
        {state === "idle" ? "" : status}
      </span>
    </>
  );
}

// Shown in place of the field while the mic is on: the words arrive as they are heard.
// before: the text already in the field, with the separator the spoken text will get.
export function LiveText({ live, before, className }: { live: Live; before: string; className: string }) {
  return (
    <p className={className}>
      {before}
      {live.text ? (
        live.text.split(/\s+/).map((w, i) => (
          // keyed by word too: a word Whisper corrects animates in again
          <Fragment key={`${i}:${w}`}>
            {i > 0 && " "}
            <span className="inline-block animate-word motion-reduce:animate-none">{w}</span>
          </Fragment>
        ))
      ) : (
        <span className="text-muted">{live.progress != null && live.progress < 100 ? `Loading voice model, ${live.progress}%` : "Listening…"}</span>
      )}
      <span aria-hidden="true" className="inline-block h-5 w-0.5 translate-y-1 animate-caret bg-secondary motion-reduce:animate-none" />
    </p>
  );
}
