import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, listUsers, type Role } from "../auth";
import Logo from "../Logo";

// per-user page behind auth: nothing to prerender, so block until the session is read
export const instant = false;

const ROLE: Record<Role, { label: string; tone: string }> = {
  super_admin: { label: "Super admin", tone: "bg-secondary/10 text-secondary" },
  admin: { label: "Admin", tone: "bg-tertiary/10 text-tertiary" },
  member: { label: "Member", tone: "bg-primary/10 text-primary" },
};

export default async function Users() {
  const me = await currentUser();
  if (me?.role !== "super_admin") redirect("/");
  const users = listUsers();

  return (
    <div className="min-h-dvh bg-paper">
      <header className="flex items-center justify-between border-b border-line px-4 py-4 sm:px-8">
        <Logo className="h-6" />
        <Link href="/" className="min-h-10 rounded-lg px-3 py-2 text-sm font-medium text-ink/80 transition-colors hover:bg-sidebar focus-visible:outline-3 focus-visible:outline-primary">
          ← Back to chat
        </Link>
      </header>
      <main className="mx-auto max-w-3xl animate-rise px-4 py-10 sm:px-8">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1.5 text-[15px] text-muted">
          {users.length} people can sign in. Only super admins can see this page.
        </p>
        <ul className="mt-8 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {users.map((u) => (
            <li key={u.email} className="flex items-center gap-4 px-5 py-4">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-to-br from-primary to-tertiary text-sm font-semibold text-paper">
                {u.name
                  .split(" ")
                  .map((p) => p[0])
                  .join("")}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {u.name}
                  {u.email === me.email && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}
                </span>
                <span className="block truncate text-sm text-muted">{u.email}</span>
              </span>
              <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${ROLE[u.role].tone}`}>{ROLE[u.role].label}</span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
