import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "../auth";
import DeleteWorkspace from "./DeleteWorkspace";
import Header from "./Header";
import NewWorkspace from "./NewWorkspace";
import { canCreate, listWorkspaces, MAX_WORKSPACES } from "./server";

export const instant = false;

const n = (x: number) => x.toLocaleString("en-US");

const CARD =
  "block h-full rounded-2xl border border-line bg-surface p-5 transition-[border-color,box-shadow] duration-150 hover:border-primary/40 hover:shadow-[0_8px_24px_-16px_var(--primary)] focus-visible:outline-3 focus-visible:outline-primary";

export default async function Workspaces() {
  const me = await currentUser();
  if (!me) redirect("/login");
  const list = await listWorkspaces(me);
  const superAdmin = me.role === "super_admin";

  return (
    <div className="min-h-dvh bg-paper">
      <Header me={me} />
      <main className="mx-auto max-w-4xl animate-rise px-4 py-10 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          Upload an Excel or CSV file to a workspace.{superAdmin ? " You can create as many workspaces as you need." : ` You can have ${MAX_WORKSPACES} workspaces.`}
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2">
          {superAdmin && (
            <li>
              {/* the built-in df-dev workspace: always first, never deletable */}
              <Link href="/" className={CARD}>
                <span className="flex items-center gap-2">
                  <span className="font-serif text-xl">DoctorFare</span>
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Default</span>
                </span>
                <span className="mt-2 block text-sm text-muted">Referral data (df-dev) · Ask questions →</span>
              </Link>
            </li>
          )}
          {list.map((w) => {
            const rows = w.tables.reduce((s, t) => s + t.rows, 0);
            return (
              <li key={w._id.toString()} className="relative">
                <Link href={`/workspaces/${w._id}`} className={CARD}>
                  <span className="block pr-16 font-serif text-xl">{w.name}</span>
                  <span className="mt-2 block text-sm text-muted">
                    {w.tables.length ? `${w.tables.length} ${w.tables.length === 1 ? "table" : "tables"} · ${n(rows)} rows · Ask questions →` : "No data yet · Upload a file →"}
                  </span>
                </Link>
                <DeleteWorkspace id={w._id.toString()} name={w.name} />
              </li>
            );
          })}
          {canCreate(me, list.length) && (
            <li>
              <NewWorkspace />
            </li>
          )}
        </ul>
      </main>
    </div>
  );
}
