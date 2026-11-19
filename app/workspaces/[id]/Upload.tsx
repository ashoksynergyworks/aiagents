"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TYPE_LABEL, type Column, type Plan, type Type } from "../standardise";

type Sheet = {
  name: string;
  collection: string;
  replaces: number | null;
  error?: string;
  ai?: boolean;
  plan?: Plan;
  columns?: Column[];
  rows?: Record<string, unknown>[];
  total?: number;
  changes?: string[];
};
type Preview = { file: string; sheets: Sheet[] };
// the user's choice for one suggested column change; aligned with Sheet.columns (same order as plan.columns)
type Edit = { label: string; rename: boolean; convert: boolean; description: string };

// the column as it will be stored: an unticked rename keeps the file's name, an unticked type keeps text
const final = (c: Column, e?: Edit) =>
  !e
    ? c
    : { ...c, label: e.rename ? e.label.trim() || c.source : c.source, type: e.convert ? c.type : ("text" as Type), unit: e.convert ? c.unit : "", description: e.description.trim() };

const n = (x: number) => x.toLocaleString("en-US");
const PRIMARY =
  "min-h-11 cursor-pointer rounded-xl bg-primary px-5 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-primary-strong focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY =
  "min-h-11 cursor-pointer rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink/80 transition-colors duration-150 hover:bg-sidebar focus-visible:outline-3 focus-visible:outline-primary";

function cell(v: unknown, type: Type) {
  if (v == null) return <span className="text-muted/60">—</span>;
  if (type === "date") return String(v).slice(0, 10); // ISO from JSON
  if (type === "boolean") return v ? "Yes" : "No";
  if (type === "number") return (v as number).toLocaleString("en-US", { maximumFractionDigits: 6 });
  return String(v);
}

async function post(id: string, body: FormData) {
  const res = await fetch(`/api/workspaces/${id}/upload`, { method: "POST", body });
  const data = await res.json().catch(() => ({ error: "The server did not answer. Try again." }));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong. Try again.");
  return data;
}

export default function Upload({ id }: { id: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set()); // sheets the user unticked
  const [edits, setEdits] = useState<Record<string, Edit[]>>({});
  const edit = (sheet: string, i: number, patch: Partial<Edit>) =>
    setEdits((prev) => ({ ...prev, [sheet]: prev[sheet].map((e, j) => (j === i ? { ...e, ...patch } : e)) }));
  const [busy, setBusy] = useState<"" | "reading" | "storing">("");
  const [error, setError] = useState("");
  const [done, setDone] = useState("");
  const [drag, setDrag] = useState(false);

  async function pick(f: File | undefined) {
    if (!f || busy) return;
    setError("");
    setDone("");
    setPreview(null);
    setFile(f);
    setBusy("reading");
    const body = new FormData();
    body.set("file", f);
    try {
      const p: Preview = await post(id, body);
      setSkip(new Set(p.sheets.filter((s) => s.error).map((s) => s.name)));
      setEdits(Object.fromEntries(p.sheets.filter((s) => !s.error).map((s) => [s.name, s.columns!.map((c) => ({ label: c.label, rename: true, convert: true, description: c.description }))])));
      setPreview(p);
    } catch (e) {
      setError((e as Error).message);
      setFile(null);
    } finally {
      setBusy("");
    }
  }

  async function store() {
    if (!file || !preview) return;
    const chosen = preview.sheets.filter((s) => !s.error && !skip.has(s.name));
    setError("");
    setBusy("storing");
    const body = new FormData();
    body.set("file", file);
    // the server checks this plan again (checkPlan), so an edited name or type cannot corrupt data
    const plans = chosen.map((s) => ({
      name: s.name,
      plan: { ...s.plan!, columns: s.plan!.columns.map((pc, i) => {
        const { label, type, unit, description } = final(s.columns![i], edits[s.name][i]);
        return { ...pc, label, type, unit, description };
      }) },
    }));
    body.set("plans", JSON.stringify(plans));
    try {
      const { stored } = await post(id, body);
      setDone(`Stored ${stored.map((s: { sheet: string; rows: number }) => `${n(s.rows)} rows from ${s.sheet}`).join(", ")}.`);
      setPreview(null);
      setFile(null);
      router.refresh(); // the page moves on to the questions, or keeps the chat
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  // ponytail: string match on the server's change text; the "Renamed"/"Read" lines are now the controls below
  const other = (s: Sheet) => s.changes!.filter((c) => !/^(Renamed|Read) /.test(c));
  const suggested = (s: Sheet) => s.columns!.flatMap((c, i) => (c.label !== c.source || c.type !== "text" ? [i] : []));
  const chosen = preview?.sheets.filter((s) => !s.error && !skip.has(s.name)) ?? [];
  const rows = chosen.reduce((sum, s) => sum + (s.total ?? 0), 0);

  if (!preview)
    return (
      <div className="mt-5">
        <label
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            pick(e.dataTransfer.files[0]);
          }}
          className={`flex min-h-48 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-10 text-center transition-colors has-focus-visible:outline-3 has-focus-visible:outline-primary ${drag ? "border-primary bg-primary-soft" : "border-line bg-surface hover:border-primary/40"} ${busy ? "pointer-events-none" : ""}`}
        >
          <input type="file" accept=".xlsx,.xlsm,.xls,.csv" className="sr-only" disabled={!!busy} onChange={(e) => pick(e.target.files?.[0])} />
          {busy === "reading" ? (
            <>
              <span className="size-6 animate-spin rounded-full border-2 border-primary/25 border-t-primary" aria-hidden="true" />
              <span className="font-medium">Reading and formatting {file?.name}…</span>
              <span className="text-sm text-muted">This takes a few seconds.</span>
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="size-8 text-primary">
                <path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" />
              </svg>
              <span className="font-medium">Drop an Excel or CSV file here, or click to choose one</span>
              <span className="text-sm text-muted">.xlsx, .xls or .csv, up to 10 MB and 50,000 rows per sheet</span>
            </>
          )}
        </label>
        <p className="mt-3 text-xs text-muted">Do not upload passwords or patient data.</p>
        <p role="alert" className="mt-2 min-h-5 text-sm text-secondary">
          {error}
        </p>
        <p role="status" className="text-sm font-medium text-primary">
          {done}
        </p>
      </div>
    );

  return (
    <div className="mt-5 space-y-6">
      <p className="text-sm text-muted">
        Check <span className="font-medium text-ink">{preview.file}</span> below. Nothing is stored until you click Store.
      </p>

      {preview.sheets.map((s) => (
        <section key={s.name} aria-label={`Sheet ${s.name}`} className={`rounded-2xl border border-line bg-surface ${skip.has(s.name) ? "opacity-60" : ""}`}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-5 py-4">
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={!s.error && !skip.has(s.name)}
                disabled={!!s.error}
                onChange={(e) => {
                  const next = new Set(skip);
                  if (e.target.checked) next.delete(s.name);
                  else next.add(s.name);
                  setSkip(next);
                }}
              />
              <span className="font-semibold">{s.name}</span>
            </label>
            {!s.error && <span className="text-sm text-muted">{n(s.total!)} rows · {s.columns!.length} columns</span>}
            {!s.error && (
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.ai ? "bg-tertiary/10 text-tertiary" : "bg-sidebar text-muted"}`}>
                {s.ai ? "Formatted with AI" : "Formatted with rules"}
              </span>
            )}
            {s.replaces != null && !s.error && <span className="text-sm font-medium text-secondary">Replaces the stored {s.name} ({n(s.replaces)} rows)</span>}
          </div>

          {s.error ? (
            <p className="px-5 py-4 text-sm text-secondary">{s.error}</p>
          ) : (
            <>
              <div className="px-5 py-4">
                {other(s).length || suggested(s).length ? (
                  <>
                    <p className="text-sm font-medium">
                      We suggest {other(s).length + suggested(s).length} {other(s).length + suggested(s).length === 1 ? "change" : "changes"}. Nothing changes until you click Store.
                    </p>
                    <ul className="mt-2 grid gap-1 text-sm text-ink/80 sm:grid-cols-2">
                      {other(s).map((c) => (
                        <li key={c} className="flex gap-2">
                          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60" />
                          {c}
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm font-medium text-primary">This sheet is already clean. It is stored as it is.</p>
                )}
              </div>

              {suggested(s).length > 0 && (
                <fieldset className="border-t border-line px-5 py-4">
                  <legend className="sr-only">Suggested column changes for {s.name}</legend>
                  <p className="text-sm font-medium">Column changes</p>
                  <p className="mt-0.5 text-xs text-muted">Untick a change to keep the column as it is in the file. You can edit each new name.</p>
                  <ul className="mt-3 divide-y divide-line/70">
                    {suggested(s).map((i) => {
                      const c = s.columns![i];
                      const e = edits[s.name][i];
                      return (
                        <li key={c.key} className="flex flex-wrap items-center gap-x-6 gap-y-1 py-2 text-sm">
                          <span className="w-40 truncate font-medium" title={c.source}>{c.source}</span>
                          {c.label !== c.source && (
                            <span className="flex items-center gap-2">
                              <label className="flex min-h-11 cursor-pointer items-center gap-2">
                                <input type="checkbox" className="size-4 accent-primary" checked={e.rename} onChange={(ev) => edit(s.name, i, { rename: ev.target.checked })} />
                                Rename to
                              </label>
                              <input
                                type="text"
                                aria-label={`New name for ${c.source}`}
                                maxLength={80}
                                value={e.label}
                                disabled={!e.rename}
                                onChange={(ev) => edit(s.name, i, { label: ev.target.value })}
                                className="min-h-9 w-56 rounded-lg border border-line bg-paper px-2.5 focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
                              />
                            </span>
                          )}
                          {c.type !== "text" && (
                            <label className="flex min-h-11 cursor-pointer items-center gap-2">
                              <input type="checkbox" className="size-4 accent-primary" checked={e.convert} onChange={(ev) => edit(s.name, i, { convert: ev.target.checked })} />
                              Store as {TYPE_LABEL[c.type]}
                              {c.unit && ` in ${c.unit}`}
                            </label>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              )}

              {/* the meaning of each column goes to the chat's schema (description) */}
              <fieldset className="border-t border-line px-5 py-4">
                <legend className="sr-only">What the columns of {s.name} mean</legend>
                <p className="text-sm font-medium">What each column means</p>
                <p className="mt-0.5 text-xs text-muted">Optional. Add codes, units or business rules. The assistant reads this when it answers questions.</p>
                <ul className="mt-3 divide-y divide-line/70">
                  {s.columns!.map((c, i) => (
                    <li key={c.key} className="flex flex-wrap items-center gap-x-6 gap-y-1 py-2 text-sm">
                      <span className="w-40 truncate font-medium" title={final(c, edits[s.name][i]).label}>{final(c, edits[s.name][i]).label}</span>
                      <input
                        type="text"
                        aria-label={`Meaning of ${final(c, edits[s.name][i]).label}`}
                        maxLength={300}
                        placeholder="e.g. Status code: A = active, C = cancelled"
                        value={edits[s.name][i].description}
                        onChange={(ev) => edit(s.name, i, { description: ev.target.value })}
                        className="min-h-9 min-w-0 flex-1 rounded-lg border border-line bg-paper px-2.5 focus-visible:outline-2 focus-visible:outline-primary"
                      />
                    </li>
                  ))}
                </ul>
              </fieldset>

              {/* the column ledger: each header shows the type and, when renamed, the name in the file */}
              <div className="max-h-[28rem] overflow-auto border-t border-line">
                <table className="w-full border-collapse text-sm">
                  <thead className="sticky top-0 z-10 bg-sidebar">
                    <tr>
                      {s.columns!.map((col, i) => final(col, edits[s.name]?.[i])).map((c) => (
                        <th key={c.key} scope="col" className="max-w-56 min-w-32 border-b border-line px-3 py-2.5 text-left align-top font-normal">
                          <span className="block font-semibold text-ink">{c.label}</span>
                          <span className="mt-0.5 block text-xs text-muted">
                            {TYPE_LABEL[c.type]}
                            {c.unit && ` · ${c.unit}`}
                          </span>
                          {c.source !== c.label && <span className="mt-0.5 block text-xs text-tertiary">was “{c.source}”</span>}
                          {c.description && <span className="mt-1 line-clamp-2 block text-xs text-muted/80">{c.description}</span>}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {s.rows!.map((r, i) => (
                      <tr key={i} className="border-b border-line/70 last:border-0">
                        {s.columns!.map((c) => (
                          <td key={c.key} className={`max-w-56 truncate px-3 py-2 ${c.type === "number" ? "text-right tabular-nums" : ""}`}>
                            {cell(r[c.key], c.type)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {s.total! > s.rows!.length && (
                <p className="border-t border-line px-5 py-2.5 text-xs text-muted">
                  Showing the first {s.rows!.length} of {n(s.total!)} rows.
                </p>
              )}
            </>
          )}
        </section>
      ))}

      <div className="sticky bottom-0 -mx-4 flex flex-wrap items-center gap-3 border-t border-line bg-paper/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:px-5">
        <p role="alert" className="min-w-0 flex-1 text-sm text-secondary">
          {error}
        </p>
        <button type="button" onClick={() => setPreview(null)} disabled={busy === "storing"} className={SECONDARY}>
          Discard
        </button>
        <button type="button" onClick={store} disabled={!chosen.length || busy === "storing"} className={PRIMARY}>
          {busy === "storing" ? "Storing…" : `Store ${n(rows)} rows`}
        </button>
      </div>
    </div>
  );
}
