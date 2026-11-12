"use client";

import { startTransition, useActionState, useState } from "react";
import { FIELD } from "../ui";
import { add, type AddState } from "./actions";

const PRIMARY =
  "min-h-11 cursor-pointer rounded-xl bg-primary px-4 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-primary-strong focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-80";
const SECONDARY =
  "min-h-11 cursor-pointer rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink/80 transition-colors duration-150 hover:bg-sidebar focus-visible:outline-3 focus-visible:outline-primary";

export default function AddUser() {
  const [state, action, pending] = useActionState(add, {} as AddState);
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState<AddState | null>(null); // the result already dismissed
  const [copied, setCopied] = useState(false);
  const added = state.added && state !== seen ? state.added : null;

  function dismiss(keepOpen: boolean) {
    setSeen(state);
    setCopied(false);
    setOpen(keepOpen);
  }

  async function copy() {
    if (!added) return;
    await navigator.clipboard.writeText(`Sign in at ${location.origin}\nEmail: ${added.email}\nTemporary password: ${added.password}`);
    setCopied(true);
  }

  if (added)
    return (
      <section aria-labelledby="added-title" className="mt-8 animate-rise rounded-2xl border border-primary/30 bg-primary-soft p-5 sm:p-6">
        <h2 id="added-title" className="font-semibold">
          Account created for {added.name}
        </h2>
        <p className="mt-1 text-sm text-muted">This password is shown only once. Send it to {added.name} in a private message.</p>
        <dl className="mt-4 grid gap-3 rounded-xl border border-line bg-surface p-4 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-6">
          <dt className="text-muted">Email</dt>
          <dd className="break-all font-medium">{added.email}</dd>
          <dt className="text-muted">Temporary password</dt>
          <dd className="font-mono text-base font-semibold tracking-wide select-all">{added.password}</dd>
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" onClick={copy} className={PRIMARY}>
            {copied ? "Copied" : "Copy sign-in details"}
          </button>
          <button type="button" onClick={() => dismiss(true)} className={SECONDARY}>
            Add another
          </button>
          <button type="button" onClick={() => dismiss(false)} className={SECONDARY}>
            Done
          </button>
        </div>
        <p aria-live="polite" className="sr-only">
          {copied ? "Sign-in details copied" : ""}
        </p>
      </section>
    );

  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${PRIMARY} mt-6`}>
        Add user
      </button>
    );

  return (
    // onSubmit, not action=: an action prop clears the form afterwards, and an error should keep what was typed
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        startTransition(() => action(data));
      }}
      className="mt-8 animate-rise rounded-2xl border border-line bg-surface p-5 sm:p-6">
      <h2 className="font-semibold">Add user</h2>
      <p className="mt-1 text-sm text-muted">They join as an admin and get a temporary password to sign in with.</p>
      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <label className="block text-sm font-medium">
          Name
          <input name="name" required maxLength={80} autoComplete="off" autoFocus className={FIELD} />
        </label>
        <label className="block text-sm font-medium">
          Email
          <input name="email" type="email" required maxLength={200} autoComplete="off" className={FIELD} />
        </label>
      </div>
      <p role="alert" className="mt-4 min-h-5 text-sm text-secondary">
        {state.error}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button disabled={pending} className={PRIMARY}>
          {pending ? "Adding…" : "Add user"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={SECONDARY}>
          Cancel
        </button>
      </div>
    </form>
  );
}
