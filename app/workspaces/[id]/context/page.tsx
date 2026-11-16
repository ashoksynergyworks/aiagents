import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUser } from "../../../auth";
import Header from "../../Header";
import { getWorkspace } from "../../server";
import { Questions, Waiting } from "../Questions";

export const instant = false;

// "Describe data": edit the answers and add more context
export default async function ContextPage({ params }: PageProps<"/workspaces/[id]/context">) {
  const me = await currentUser();
  if (!me) redirect("/login");
  const ws = await getWorkspace((await params).id, me);
  if (!ws) notFound();
  const back = `/workspaces/${ws._id}`;
  if (!ws.tables.length) redirect(back);

  return (
    <div className="min-h-dvh bg-paper">
      <Header me={me} />
      <main className="mx-auto max-w-3xl animate-rise px-4 pt-8 sm:px-8">
        <Link href={back} className="text-sm font-medium text-muted transition-colors hover:text-ink focus-visible:outline-3 focus-visible:outline-primary">
          ← {ws.name}
        </Link>
        <h1 className="mt-3 font-serif text-3xl tracking-tight">Describe your data</h1>
        <p className="mt-2 max-w-[60ch] text-[15px] leading-relaxed text-muted">
          Change an answer or add more detail. The assistant uses these answers in every chat.
        </p>
        <Suspense fallback={<Waiting />}>
          <Questions ws={ws} skip={{ href: back, label: "Cancel" }} />
        </Suspense>
      </main>
    </div>
  );
}
