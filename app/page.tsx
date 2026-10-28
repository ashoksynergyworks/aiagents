"use client";

import { useEffect, useRef, useState } from "react";

type CsvFile = { name: string; csv: string; rows: number };
type Msg = { role: "user" | "assistant"; content: string; used?: string[]; files?: CsvFile[]; fallback?: string; followUps?: string[] };
type Chat = { id: string; title: string; messages: Msg[] };
type DbStatus = { ok: boolean; db?: string; error?: string };

async function checkDb(): Promise<DbStatus> {
  const s = await fetch("/api/chat")
    .then((r) => r.json())
    .catch((e: Error) => ({ ok: false, error: e.message }));
  console.log("[db]", s);
  return s;
}

const SUGGESTIONS = [
  { label: "Monthly referrals", prompt: "How many referrals came in each month this year?" },
  { label: "Top specialist groups", prompt: "Top 10 specialist groups by referrals in the last 90 days" },
  { label: "Office report (CSV)", prompt: "CSV of appointments created with each specialist office last month" },
  { label: "High-risk by PCP", prompt: "Which PCPs sent the most high-risk referrals?" },
  { label: "This month vs last", prompt: "Show me appointment analytics for this month compared with last month" },
];

const CHIP =
  "min-h-11 cursor-pointer rounded-xl border border-line bg-surface px-3.5 text-sm text-ink/80 transition-colors duration-150 hover:border-primary/40 hover:text-ink focus-visible:outline-3 focus-visible:outline-primary";

const NUMERIC = /^-?[\d,.]+%?$/;
// insight section labels the agent writes on their own line (route.ts system prompt)
const LABEL = /^[\s*_#]*(key findings|growth opportunities|recommendation|follow\W?up questions)[\s*_:]*$/i;

const ICONS = {
  send: "M12 19V5M5 12l7-7 7 7",
  plus: "M12 5v14M5 12h14",
  menu: "M4 7h16M4 12h16M4 17h10",
  check: "M20 6 9 17l-5-5",
  download: "M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14",
  copy: "M8 8V5a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3M5 8h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z",
};

function Icon({ name, className = "size-5" }: { name: keyof typeof ICONS; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <path d={ICONS[name]} />
    </svg>
  );
}

// a referral: navy PCP dot handing off to a rose specialist dot; the arc runs while a query is in flight
function Mark({ className = "", running = false }: { className?: string; running?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 text-primary ${className}`}>
      <path
        d="M6 15C6 9.5 9.5 6 15 6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={running ? "4 3" : undefined}
        className={running ? "animate-travel motion-reduce:animate-none" : undefined}
      />
      <circle cx="6" cy="18" r="3" className="fill-primary" />
      <circle cx="18" cy="6" r="3" className="fill-secondary" />
    </svg>
  );
}

function download(f: CsvFile) {
  // BOM so Excel reads UTF-8 names (e.g. "Hà Nội") correctly
  const url = URL.createObjectURL(new Blob(["\uFEFF", f.csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: f.name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url));
}

// ponytail: only markdown pipe tables are parsed, the rest stays plain text; add react-markdown if replies need more
function Reply({ text }: { text: string }) {
  const blocks: (string | string[][] | { label: string })[] = [];
  // ponytail: models add **bold** despite the prompt; drop the markers rather than parse markdown
  for (const line of text.replaceAll("**", "").split("\n")) {
    const t = line.trim();
    const last = blocks.at(-1);
    if (t.startsWith("|")) {
      if (/^[|\s:-]+$/.test(t) && t.includes("---")) continue; // header separator row
      const cells = t.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      if (Array.isArray(last)) last.push(cells);
      else blocks.push([cells]);
    } else if (LABEL.test(t)) blocks.push({ label: t.replace(/[*_#:]/g, "").trim() });
    else if (typeof last === "string") blocks[blocks.length - 1] = `${last}\n${line}`;
    else blocks.push(line);
  }
  return blocks.map((b, i) => {
    if (typeof b === "string") return b.trim() && <p key={i} className="whitespace-pre-wrap">{b.trim()}</p>;
    if (!Array.isArray(b))
      return (
        <h3 key={i} className="pt-3 font-sans text-sm font-medium text-muted">
          {b.label}
        </h3>
      );
    const [head, ...body] = b;
    const num = head.map((_, j) => body.length > 0 && body.every((r) => NUMERIC.test(r[j] ?? "")));
    return (
      <div key={i} className="overflow-x-auto rounded-xl border border-line bg-surface font-sans">
        <table className="w-full text-sm">
          <thead className="bg-sidebar text-muted">
            <tr>
              {head.map((c, j) => (
                <th key={j} scope="col" className={`px-4 py-2.5 font-medium whitespace-nowrap ${num[j] ? "text-right" : "text-left"}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {body.map((r, k) => (
              <tr key={k}>
                {head.map((_, j) => (
                  <td key={j} className={`px-4 py-2.5 ${num[j] ? "text-right tabular-nums" : ""}`}>
                    {r[j]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  });
}

export default function Home() {
  // ponytail: recents live in memory for this tab; persist to localStorage if people want them across reloads
  const [chats, setChats] = useState<Chat[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [menu, setMenu] = useState(false);
  const [db, setDb] = useState<DbStatus | null>(null); // null while checking
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    checkDb().then(setDb);
  }, []);

  const active = chats.find((c) => c.id === activeId);
  const messages = active?.messages ?? [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" }); // braces: newer browsers return a Promise here
  }, [active?.messages, loading]);

  function newChat() {
    setActiveId(null);
    setInput("");
    setError("");
    setMenu(false);
  }

  async function send(text: string) {
    text = text.trim();
    if (!text || loading) return;
    const id = activeId ?? crypto.randomUUID();
    const prev = messages;
    const next: Msg[] = [...prev, { role: "user", content: text }];
    const put = (msgs: Msg[]) =>
      setChats((cs) =>
        cs.some((c) => c.id === id) ? cs.map((c) => (c.id === id ? { ...c, messages: msgs } : c)) : [{ id, title: text, messages: msgs }, ...cs],
      );
    put(next);
    setActiveId(id);
    setInput("");
    setError("");
    setLoading(id);
    const t0 = performance.now();
    console.log("[chat] →", text);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }), // CSVs stay client-side
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      console.log("[chat] ←", `${Math.round(performance.now() - t0)}ms`, { used: data.used, files: data.files?.map((f: CsvFile) => `${f.name} (${f.rows} rows)`), fallback: data.fallback });
      put([...next, { role: "assistant", content: data.reply, used: data.used, files: data.files, fallback: data.fallback, followUps: data.followUps }]);
    } catch (e) {
      console.error("[chat] failed", `${Math.round(performance.now() - t0)}ms`, e);
      // roll back so the question can be edited and re-sent
      if (prev.length) put(prev);
      else setChats((cs) => cs.filter((c) => c.id !== id));
      setInput(text);
      setError((e as Error).message);
    } finally {
      setLoading(null);
    }
  }

  async function copy(i: number, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    } catch {}
  }

  const alert = error && (
    <p role="alert" className="mb-3 rounded-xl border border-secondary/30 bg-secondary/8 px-4 py-2.5 text-sm">
      {error}
    </p>
  );

  const composer = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send(input);
      }}
      className="rounded-2xl border border-line bg-surface shadow-[0_1px_2px_oklch(0.25_0.012_80/0.05),0_8px_28px_-12px_oklch(0.25_0.012_80/0.18)] transition-colors duration-200 focus-within:border-primary/50"
    >
      <label htmlFor="q" className="sr-only">
        Ask for a report
      </label>
      <textarea
        id="q"
        rows={1}
        autoFocus
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send(input);
          }
        }}
        placeholder="Ask for a report, e.g. referrals per specialist group last month"
        className="block max-h-60 min-h-14 w-full resize-none bg-transparent px-4 pt-4 text-base outline-none field-sizing-content placeholder:text-muted"
      />
      <div className="flex justify-end px-2.5 pb-2.5">
        <button
          aria-label="Send"
          disabled={!!loading || !input.trim()}
          className="grid size-11 cursor-pointer place-items-center rounded-xl bg-primary text-paper transition-[background-color,transform] duration-150 hover:bg-primary-strong focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary active:scale-95 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <Icon name="send" />
        </button>
      </div>
    </form>
  );

  return (
    <div className="flex h-dvh">
      <aside
        className={`${menu ? "fixed inset-y-0 left-0 z-30 flex" : "hidden"} w-72 flex-col border-r border-line bg-sidebar md:static md:flex md:w-64`}
      >
        <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
          <Mark className="size-6" />
          <span className="font-serif text-xl tracking-[-0.01em]">Referral Reports</span>
        </div>
        <div className="px-3">
          <button
            onClick={newChat}
            className="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-2 text-sm font-medium transition-colors duration-150 hover:bg-paper focus-visible:outline-3 focus-visible:outline-primary"
          >
            <span className="grid size-7 place-items-center rounded-full bg-secondary text-paper">
              <Icon name="plus" className="size-4" />
            </span>
            New report
          </button>
        </div>
        <nav aria-label="Recent reports" className="mt-6 flex-1 overflow-y-auto px-3">
          <p className="px-2 pb-2 text-xs font-medium text-muted">Recents</p>
          {chats.length === 0 ? (
            <p className="px-2 text-sm text-muted">Reports you run in this tab show up here.</p>
          ) : (
            <ul className="space-y-0.5">
              {chats.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => {
                      setActiveId(c.id);
                      setError("");
                      setMenu(false);
                    }}
                    aria-current={c.id === activeId ? "page" : undefined}
                    className="block min-h-10 w-full cursor-pointer truncate rounded-lg px-2 text-left text-sm text-ink/80 transition-colors duration-150 hover:bg-paper/70 focus-visible:outline-3 focus-visible:outline-primary aria-[current=page]:bg-paper aria-[current=page]:font-medium aria-[current=page]:text-ink"
                  >
                    {c.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </nav>
        <div className="border-t border-line px-5 py-3 text-xs text-muted">
          <div className="flex items-center gap-2">
            <span className={`size-1.5 shrink-0 rounded-full ${!db ? "animate-pulse bg-muted" : db.ok ? "bg-primary" : "bg-secondary"}`} />
            <span role="status" className="min-w-0 flex-1 truncate">
              {!db ? (
                "Checking database…"
              ) : db.ok ? (
                <>
                  Reads <span className="font-mono">{db.db}</span>, read-only
                </>
              ) : (
                "Database not connected"
              )}
            </span>
            <button
              onClick={() => {
                setDb(null);
                checkDb().then(setDb);
              }}
              disabled={!db}
              className="min-h-8 cursor-pointer rounded-lg border border-line px-2.5 font-medium text-ink/80 transition-colors duration-150 hover:bg-paper focus-visible:outline-3 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-50"
            >
              {db?.ok === false ? "Retry" : "Check"}
            </button>
          </div>
          {db?.error && <p className="mt-1.5 line-clamp-3 wrap-break-word text-secondary">{db.error}</p>}
        </div>
      </aside>
      {menu && <button aria-label="Close menu" onClick={() => setMenu(false)} className="fixed inset-0 z-20 bg-ink/30 md:hidden" />}

      <div className="flex min-w-0 flex-1 flex-col">
        <h1 className="sr-only">Referral Reports</h1>
        <header className="flex items-center justify-between border-b border-line px-1 md:hidden">
          <button
            aria-label="Open menu"
            aria-expanded={menu}
            onClick={() => setMenu(true)}
            className="grid size-11 cursor-pointer place-items-center rounded-lg focus-visible:outline-3 focus-visible:outline-primary"
          >
            <Icon name="menu" />
          </button>
          <span className="truncate px-2 font-serif text-lg">{active?.title ?? "Referral Reports"}</span>
          <button
            aria-label="New report"
            onClick={newChat}
            className="grid size-11 cursor-pointer place-items-center rounded-lg focus-visible:outline-3 focus-visible:outline-primary"
          >
            <Icon name="plus" />
          </button>
        </header>

        {messages.length === 0 ? (
          <main className="flex flex-1 flex-col items-center justify-center px-4 pb-[12vh]">
            <div className="w-full max-w-2xl">
              <h2 className="mb-8 flex items-center justify-center gap-3 text-center font-serif text-[1.75rem] leading-tight tracking-[-0.015em] text-balance md:text-[2.5rem]">
                <Mark className="size-8 md:size-10" />
                What would you like to report on?
              </h2>
              {alert}
              {composer}
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s.label} onClick={() => send(s.prompt)} title={s.prompt} className={CHIP}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </main>
        ) : (
          <>
            <main role="log" aria-live="polite" className="flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl space-y-8 px-4 py-8 md:py-10">
                {messages.map((m, i) =>
                  m.role === "user" ? (
                    <div key={i} className="flex animate-rise justify-end motion-reduce:animate-none">
                      <p className="max-w-[85%] rounded-2xl bg-primary-soft px-4 py-2.5 whitespace-pre-wrap">{m.content}</p>
                    </div>
                  ) : (
                    <article key={i} className="animate-rise motion-reduce:animate-none">
                      <div className="space-y-3 font-serif text-[1.0625rem] leading-7">
                        <Reply text={m.content} />
                      </div>
                      {m.files?.map((f) => (
                        <button
                          key={f.name}
                          onClick={() => download(f)}
                          aria-label={`Download ${f.name}`}
                          className="group mt-4 flex w-full max-w-md cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors duration-150 hover:border-primary/40 focus-visible:outline-3 focus-visible:outline-primary"
                        >
                          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary-soft text-[0.6875rem] font-semibold tracking-wide text-primary">CSV</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium">{f.name}</span>
                            <span className="block text-xs text-muted">
                              {f.rows.toLocaleString()} {f.rows === 1 ? "row" : "rows"}
                            </span>
                          </span>
                          <span className="grid size-9 shrink-0 place-items-center rounded-lg text-muted transition-colors duration-150 group-hover:bg-primary group-hover:text-paper">
                            <Icon name="download" className="size-4" />
                          </span>
                        </button>
                      ))}
                      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                        <button
                          onClick={() => copy(i, m.content)}
                          aria-label={copied === i ? "Copied" : "Copy reply"}
                          className="-ml-2 grid size-9 cursor-pointer place-items-center rounded-lg transition-colors duration-150 hover:bg-sidebar hover:text-ink focus-visible:outline-3 focus-visible:outline-primary"
                        >
                          <Icon name={copied === i ? "check" : "copy"} className="size-4" />
                        </button>
                        {!!m.used?.length && <span>Queried {m.used.join(", ")}</span>}
                        {m.fallback && <span>· answered by fallback model {m.fallback}</span>}
                      </div>
                      {i === messages.length - 1 && !!m.followUps?.length && (
                        <div role="group" aria-label="Follow-up questions" className="mt-3 flex flex-wrap gap-2">
                          {m.followUps.map((q) => (
                            <button key={q} onClick={() => send(q)} disabled={!!loading} className={`${CHIP} py-2 text-left disabled:cursor-wait disabled:opacity-50`}>
                              {q}
                            </button>
                          ))}
                        </div>
                      )}
                    </article>
                  ),
                )}
                {loading === activeId && (
                  <p role="status" className="flex items-center gap-3 text-sm text-muted">
                    <Mark running className="size-7" />
                    Running queries. Reports can take up to a minute.
                  </p>
                )}
                <div ref={endRef} />
              </div>
            </main>
            <div className="mx-auto w-full max-w-3xl px-4 pb-3">
              {alert}
              {composer}
              <p className="mt-2 text-center text-xs text-muted">Answers come from live dev data and can be wrong. Check the numbers before you share them.</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
