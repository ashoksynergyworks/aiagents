import Link from "next/link";
import type { User } from "../auth";
import { logout } from "../login/actions";
import Logo from "../Logo";

export const BTN =
  "inline-flex min-h-10 cursor-pointer items-center rounded-lg px-3 py-2 text-sm font-medium text-ink/80 transition-colors hover:bg-sidebar focus-visible:outline-3 focus-visible:outline-primary";

export default function Header({ me }: { me: User }) {
  return (
    <header className="flex items-center justify-between gap-4 border-b border-line px-4 py-4 sm:px-8">
      <Link href="/workspaces" aria-label="Workspaces" className="rounded focus-visible:outline-3 focus-visible:outline-primary">
        <Logo className="h-6" />
      </Link>
      <nav className="flex items-center gap-1">
        {me.role === "super_admin" && (
          <Link href="/" className={BTN}>
            Referral chat
          </Link>
        )}
        <form action={logout}>
          <button className={BTN}>Sign out</button>
        </form>
      </nav>
    </header>
  );
}
