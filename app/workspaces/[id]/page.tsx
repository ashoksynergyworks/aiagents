import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUser } from "../../auth";
import Chat from "../../Chat";
import { getWorkspace, listWorkspaces } from "../server";
import Nav from "./Nav";
import { Questions, Waiting } from "./Questions";
import Upload from "./Upload";

export const instant = false;

// One page, three states: no data → upload; data but no answers → the questions; answered (or skipped) → the chat
export default async function WorkspacePage({ params, searchParams }: PageProps<"/workspaces/[id]">) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const [ws, list] = await Promise.all([getWorkspace((await params).id, me), listWorkspaces(me)]);
  if (!ws) notFound();
  const id = ws._id.toString();
  const tables = ws.tables.map((t) => t.sheet);
  const answered = !!ws.context?.length;
  const skipped = (await searchParams).chat !== undefined;

  const data = (
    <ul className="divide-y divide-line">
      {ws.tables.map((t) => (
        <li key={t.collection} className="py-3">
          <p className="text-[15px]">
            <span className="font-medium">{t.sheet}</span>{" "}
            <span className="text-sm text-muted">
              · {t.rows.toLocaleString("en-US")} rows · {t.columns.length} columns
            </span>
          </p>
          <p className="mt-1 line-clamp-2 text-sm text-muted">{t.columns.map((c) => c.label).join(", ")}</p>
        </li>
      ))}
    </ul>
  );

  return (
    <Chat
      workspace={{
        id,
        name: ws.name,
        tables,
        starters: ws.starters?.length ? ws.starters : [...tables.slice(0, 3).map((t) => `Give me a summary of ${t}`), "What stands out in this data?"],
      }}
      nav={<Nav id={id} workspaces={list.map((w) => ({ id: w._id.toString(), name: w.name }))} hasData={tables.length > 0} answered={answered} data={data} />}
    >
      {!tables.length ? (
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl animate-rise px-4 py-10 sm:px-8">
            <h2 className="font-serif text-3xl tracking-tight">Upload your data</h2>
            <p className="mt-2 text-[15px] text-muted">We clean up the file and show you the result before anything is stored.</p>
            <Upload id={id} />
          </div>
        </main>
      ) : answered || skipped ? null : (
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl animate-rise px-4 pt-8 sm:px-8">
            <h2 className="font-serif text-3xl tracking-tight">A few questions about your data</h2>
            <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted">
              The assistant can read your numbers, but not what they mean to you. Short answers help it count the right things.
            </p>
            <Suspense fallback={<Waiting />}>
              <Questions ws={ws} skip={{ href: `/workspaces/${id}?chat`, label: "Skip for now" }} />
            </Suspense>
          </div>
        </main>
      )}
    </Chat>
  );
}
