"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import Upload from "./Upload";

const ITEM =
  "flex min-h-9 w-full cursor-pointer items-center gap-2.5 truncate rounded-lg px-2 text-left text-sm text-ink/80 transition-colors duration-150 hover:bg-paper/70 hover:text-ink focus-visible:outline-3 focus-visible:outline-primary aria-[current=page]:bg-paper aria-[current=page]:font-medium aria-[current=page]:text-ink";

// The workspace part of the chat sidebar: the user's workspaces, and the options of the open one.
// "View data" and "Upload file" open in a native <dialog>, so the sidebar stays narrow.
export default function Nav({
  id,
  workspaces,
  hasData,
  answered,
  data,
  doctorfare,
}: {
  id: string; // "df-dev" on the DoctorFare chat
  doctorfare?: boolean; // super admins: the built-in df-dev workspace, listed first
  workspaces: { id: string; name: string }[];
  hasData: boolean;
  answered: boolean;
  data: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [panel, setPanel] = useState<"data" | "upload">("data");
  const open = (p: "data" | "upload") => {
    setPanel(p);
    dialog.current?.showModal();
  };

  return (
    <nav aria-label="Workspaces" className="px-5 pb-5">
      <div className="flex items-center justify-between px-2 pb-2">
        <p className="text-sm font-semibold text-muted">Workspaces</p>
        <Link href="/workspaces" className="rounded text-xs font-medium text-muted transition-colors hover:text-ink focus-visible:outline-3 focus-visible:outline-primary">
          View all
        </Link>
      </div>
      <ul className="space-y-0.5">
        {doctorfare && (
          <li>
            <Link href="/" aria-current={id === "df-dev" ? "page" : undefined} className={ITEM}>
              <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-linear-to-br from-secondary to-tertiary text-[11px] font-semibold text-paper">
                D
              </span>
              <span className="truncate">DoctorFare</span>
            </Link>
          </li>
        )}
        {workspaces.map((w) => (
          <li key={w.id}>
            <Link href={`/workspaces/${w.id}`} aria-current={w.id === id ? "page" : undefined} className={ITEM}>
              <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-linear-to-br from-primary to-tertiary text-[11px] font-semibold text-paper">
                {w.name[0]?.toUpperCase()}
              </span>
              <span className="truncate">{w.name}</span>
            </Link>
            {w.id === id && hasData && (
              <ul className="mt-0.5 ml-5 space-y-0.5 border-l border-line pl-2">
                <li>
                  <button type="button" onClick={() => open("data")} className={ITEM}>
                    View data
                  </button>
                </li>
                <li>
                  <button type="button" onClick={() => open("upload")} className={ITEM}>
                    Upload file
                  </button>
                </li>
                {answered && (
                  <li>
                    <Link href={`/workspaces/${id}/context`} className={ITEM}>
                      Describe data
                    </Link>
                  </li>
                )}
              </ul>
            )}
          </li>
        ))}
      </ul>

      <dialog
        ref={dialog}
        aria-label={panel === "data" ? "Your data" : "Upload file"}
        className="m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-3xl rounded-2xl border border-line bg-paper p-0 text-ink shadow-2xl backdrop:bg-ink/30"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 className="font-serif text-xl">{panel === "data" ? "Your data" : "Upload file"}</h2>
          <form method="dialog">
            <button className="min-h-9 cursor-pointer rounded-lg px-3 text-sm font-medium text-muted transition-colors hover:bg-sidebar hover:text-ink focus-visible:outline-3 focus-visible:outline-primary">
              Close
            </button>
          </form>
        </div>
        <div className="px-5 pb-6 pt-2">
          {panel === "data" ? (
            data
          ) : (
            <>
              <p className="pt-2 text-sm text-muted">A sheet with the same name as a stored table replaces it.</p>
              <Upload id={id} />
            </>
          )}
        </div>
      </dialog>
    </nav>
  );
}
