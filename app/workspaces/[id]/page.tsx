import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser } from "../../auth";
import Header from "../Header";
import { getWorkspace } from "../server";
import { TYPE_LABEL } from "../standardise";
import Upload from "./Upload";

export const instant = false;

export default async function WorkspacePage({ params }: PageProps<"/workspaces/[id]">) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const ws = await getWorkspace((await params).id, me);
  if (!ws) notFound();

  return (
    <div className="min-h-dvh bg-paper">
      <Header me={me} />
      <main className="mx-auto max-w-6xl animate-rise px-4 py-8 sm:px-8">
        <Link href="/workspaces" className="text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-3 focus-visible:outline-primary">
          ← Workspaces
        </Link>
        <h1 className="mt-3 font-serif text-3xl tracking-tight">{ws.name}</h1>

        {ws.tables.length > 0 && (
          <section aria-labelledby="data-title" className="mt-8">
            <h2 id="data-title" className="text-sm font-semibold tracking-wide text-muted uppercase">
              Stored data
            </h2>
            <ul className="mt-3 grid gap-3 md:grid-cols-2">
              {ws.tables.map((t) => (
                <li key={t.collection} className="rounded-2xl border border-line bg-surface p-4">
                  <p className="font-medium">
                    {t.sheet} <span className="text-sm font-normal text-muted">· {t.rows.toLocaleString("en-US")} rows</span>
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-1.5">
                    {t.columns.map((c) => (
                      <li key={c.key} title={c.description || undefined} className="rounded-md bg-sidebar px-2 py-1 text-xs">
                        {c.label} <span className="text-muted">· {TYPE_LABEL[c.type]}</span>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-labelledby="upload-title" className="mt-10">
          <h2 id="upload-title" className="text-lg font-semibold">
            {ws.tables.length ? "Upload another file" : "Upload your data"}
          </h2>
          <p className="mt-1 text-[15px] text-muted">
            {ws.tables.length
              ? "A sheet with the same name as a stored table replaces it."
              : "We clean up the file and show you the result before anything is stored."}
          </p>
          <Upload id={ws._id.toString()} />
        </section>
      </main>
    </div>
  );
}
