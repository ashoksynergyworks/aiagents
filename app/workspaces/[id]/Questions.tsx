import { ensureQuestions, type getWorkspace } from "../server";
import Interview from "./context/Interview";

type Ws = NonNullable<Awaited<ReturnType<typeof getWorkspace>>>;

// The AI writes the questions from the stored columns (2-25 s on a first visit), so pages stream them in under <Suspense>
export async function Questions({ ws, skip }: { ws: Ws; skip: { href: string; label: string } }) {
  const { questions, ai } = await ensureQuestions(ws);
  const asked = new Set(questions.map((q) => q.question));
  const answer = (q: string) => ws.context?.find((c) => c.question === q)?.answer ?? "";
  // earlier answers whose question was not asked again stay editable, so nothing the user said is lost
  const items = [
    ...questions.map((q) => ({ ...q, answer: answer(q.question) })),
    ...(ws.context ?? []).filter((c) => !asked.has(c.question)).map((c) => ({ question: c.question, why: "You answered this earlier.", about: [], options: [], answer: c.answer })),
  ];
  return <Interview id={ws._id.toString()} items={items} ai={ai} skip={skip} />;
}

export function Waiting() {
  return (
    <div className="mt-8">
      <p role="status" className="flex items-center gap-3 text-[15px] text-muted">
        <span className="size-5 animate-spin rounded-full border-2 border-primary/25 border-t-primary motion-reduce:animate-none" aria-hidden="true" />
        Reading your columns to write the questions. This takes a few seconds.
      </p>
      <div aria-hidden="true" className="mt-8 space-y-10">
        {[72, 56, 64].map((w) => (
          <div key={w} className="space-y-3">
            <div className="h-5 animate-pulse rounded bg-sidebar motion-reduce:animate-none" style={{ width: `${w}%` }} />
            <div className="h-3 w-1/3 animate-pulse rounded bg-sidebar motion-reduce:animate-none" />
            <div className="h-24 animate-pulse rounded-xl bg-sidebar/70 motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    </div>
  );
}
