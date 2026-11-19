"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { LiveText, Mic, type Live } from "../../../Mic";
import { FIELD } from "../../../ui";
import { saveContext } from "../../actions";

type Item = { question: string; why: string; about: string[]; options: string[]; answer: string };

const CHIP =
  "min-h-9 cursor-pointer rounded-full border border-line bg-surface px-3.5 text-sm text-ink/85 transition-colors duration-150 hover:border-primary/40 focus-visible:outline-3 focus-visible:outline-primary aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary";

// An answer field with a mic: spoken text is added as a new line, like a picked suggestion.
function Answer({ id, value, onChange, onSpoken, placeholder }: { id: string; value: string; onChange: (v: string) => void; onSpoken: (text: string) => void; placeholder: string }) {
  const [live, setLive] = useState<Live | null>(null);
  const [error, setError] = useState("");
  return (
    <>
      <div className="relative">
        {live ? (
          <LiveText live={live} before={value.trim() ? `${value.trimEnd()}\n` : ""} className={`${FIELD} py-3 pr-16 leading-6 whitespace-pre-wrap`} />
        ) : (
          <textarea
            id={id}
            name="answer"
            rows={2}
            maxLength={2000}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className={`${FIELD} resize-y py-3 pr-16 leading-6 field-sizing-content`}
          />
        )}
        {/* the field is kept in the form while the mic is on, so a save then still sends this answer */}
        {live && <input type="hidden" name="answer" value={value} />}
        <div className="absolute top-2 right-1">
          <Mic
            fieldId={id}
            label="Speak your answer"
            onText={onSpoken}
            setLive={setLive}
            onError={setError}
          />
        </div>
      </div>
      <p role="alert" className="mt-1.5 text-sm text-secondary empty:hidden">
        {error}
      </p>
    </>
  );
}

export default function Interview({ id, items, ai, skip }: { id: string; items: Item[]; ai: boolean; skip: { href: string; label: string } }) {
  const [error, action, pending] = useActionState(saveContext.bind(null, id), "");
  const [answers, setAnswers] = useState(() => items.map((i) => i.answer));
  const done = answers.filter((a) => a.trim()).length;
  const set = (i: number, v: string) => setAnswers((a) => a.map((x, k) => (k === i ? v : x)));

  return (
    <form action={action} className="mt-8">
      {!ai && <p className="mb-6 text-sm text-muted">These are standard questions: the AI could not read your columns just now. Reload the page to try again.</p>}
      <ol className="divide-y divide-line border-y border-line">
        {items.map((q, i) => {
          const answered = !!answers[i].trim();
          return (
            <li key={q.question} className="py-7">
              <input type="hidden" name="question" value={q.question} />
              <div className="flex gap-3">
                {/* a check, not a number: the order carries no meaning, being answered does */}
                <span
                  aria-hidden="true"
                  className={`mt-1 grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200 ${answered ? "border-primary bg-primary text-paper" : "border-line text-transparent"}`}
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="size-3">
                    <path d="M20 6 9 17l-5-5" />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <label htmlFor={`a${i}`} className="block text-[17px] leading-snug font-medium text-ink">
                    {q.question}
                  </label>
                  <p className="mt-1 text-sm text-muted">{q.why}</p>
                  {q.about.length > 0 && (
                    <ul aria-label="About these columns" className="mt-2.5 flex flex-wrap gap-1.5">
                      {q.about.map((c) => (
                        <li key={c} className="rounded-md bg-sidebar px-2 py-1 text-xs font-medium text-ink/80">
                          {c}
                        </li>
                      ))}
                    </ul>
                  )}
                  <Answer
                    id={`a${i}`}
                    value={answers[i]}
                    onChange={(v) => set(i, v)}
                    onSpoken={(t) => setAnswers((a) => a.map((x, k) => (k === i ? (x.trim() ? `${x.trimEnd()}\n${t}` : t) : x)))}
                    placeholder={q.options.length ? "Pick a suggestion below, write, or speak your own" : "Write or speak a short answer"}
                  />
                  {q.options.length > 0 && (
                    <div role="group" aria-label="Suggested answers" className="mt-2.5 flex flex-wrap gap-2">
                      {q.options.map((o) => {
                        const on = answers[i].split("\n").includes(o);
                        return (
                          <button
                            key={o}
                            type="button"
                            aria-pressed={on}
                            onClick={() => set(i, on ? answers[i].split("\n").filter((l) => l !== o).join("\n") : answers[i].trim() ? `${answers[i].trimEnd()}\n${o}` : o)}
                            className={CHIP}
                          >
                            {o}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="sticky bottom-0 -mx-4 mt-8 flex flex-wrap items-center gap-x-4 gap-y-3 border-t border-line bg-paper/95 px-4 py-4 backdrop-blur sm:mx-0 sm:px-0">
        <div className="min-w-40 flex-1">
          <p className="text-sm font-medium" aria-live="polite">
            {done} of {items.length} answered
          </p>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line" aria-hidden="true">
            <div className="h-full origin-left rounded-full bg-primary transition-transform duration-300 ease-out" style={{ transform: `scaleX(${items.length ? done / items.length : 0})` }} />
          </div>
          <p role="alert" className="mt-1.5 text-sm text-secondary empty:hidden">
            {error}
          </p>
        </div>
        <Link
          href={skip.href}
          className="inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-3 focus-visible:outline-primary"
        >
          {skip.label}
        </Link>
        <button
          disabled={pending || !done}
          className="min-h-11 cursor-pointer rounded-xl bg-primary px-5 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-primary-strong focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save and start chatting"}
        </button>
      </div>
    </form>
  );
}
