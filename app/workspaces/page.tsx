import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../auth";
import Header from "./Header";
import NewWorkspace from "./NewWorkspace";
import { listWorkspaces, MAX_WORKSPACES } from "./server";

export const instant = false;

const n = (x: number) => x.toLocaleString("en-US");

export default async function Workspaces() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const list = await listWorkspaces(me);

  return (
    <div className="min-h-dvh bg-paper">
      <Header me={me} />
      <main className="mx-auto max-w-4xl animate-rise px-4 py-10 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          Upload an Excel or CSV file to a workspace. You can have {MAX_WORKSPACES} workspaces.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {list.map((w) => {
            const rows = w.tables.reduce((s, t) => s + t.rows, 0);
            return (
              <li key={w._id.toString()}>
                <Link
                  href={`/workspaces/${w._id}`}
                  className="block h-full rounded-2xl border border-line bg-surface p-5 transition-[border-color,box-shadow] duration-150 hover:border-primary/40 hover:shadow-[0_8px_24px_-16px_var(--primary)] focus-visible:outline-3 focus-visible:outline-primary"
                >
                  <span className="block font-serif text-xl">{w.name}</span>
                  <span className="mt-2 block text-sm text-muted">
                    {w.tables.length ? `${w.tables.length} ${w.tables.length === 1 ? "table" : "tables"} · ${n(rows)} rows` : "No data yet · Upload a file →"}
                  </span>
                </Link>
              </li>
            );
          })}
          {list.length < MAX_WORKSPACES && (
            <li>
              <NewWorkspace />
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
