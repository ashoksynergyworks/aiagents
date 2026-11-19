"use client";

import { useRef, useTransition } from "react";
import { remove } from "./actions";

const BTN = "min-h-11 cursor-pointer rounded-xl px-4 text-sm font-semibold transition-colors duration-150 focus-visible:outline-3 focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60";

// Native <dialog> (same as Nav.tsx): focus trap, Esc and the backdrop come free. Cancel has focus first.
export default function DeleteWorkspace({ id, name }: { id: string; name: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pending, start] = useTransition();
  return (
    <>
      <button
        type="button"
        aria-label={`Delete workspace ${name}`}
        onClick={() => dialog.current?.showModal()}
        className="absolute top-3 right-3 min-h-9 cursor-pointer rounded-lg px-2.5 text-xs font-medium text-muted transition-colors duration-150 hover:bg-secondary/10 hover:text-secondary focus-visible:outline-3 focus-visible:outline-primary"
      >
        Delete
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={`del-${id}`}
        onCancel={(e) => pending && e.preventDefault()}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-line bg-paper p-6 text-ink shadow-2xl backdrop:bg-ink/30"
      >
        <h2 id={`del-${id}`} className="font-serif text-xl">
          Delete “{name}”?
        </h2>
        <p className="mt-2 text-sm text-muted">This deletes the workspace and all its stored data. You cannot undo this.</p>
        <form method="dialog" className="mt-6 flex justify-end gap-3">
          <button autoFocus disabled={pending} className={`${BTN} border border-line bg-surface font-medium text-ink/80 hover:bg-sidebar focus-visible:outline-primary`}>
            Cancel
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => start(() => remove(id))}
            className={`${BTN} bg-secondary text-paper hover:bg-secondary/90 focus-visible:outline-secondary`}
          >
            {pending ? "Deleting…" : "Delete workspace"}
          </button>
        </form>
      </dialog>
    </>
  );
}
