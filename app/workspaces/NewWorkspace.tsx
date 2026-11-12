"use client";

import { useActionState } from "react";
import { FIELD } from "../ui";
import { create } from "./actions";

export default function NewWorkspace() {
  const [error, action, pending] = useActionState(create, "");
  return (
    <form action={action} className="rounded-2xl border border-dashed border-line bg-surface p-5">
      <label className="block text-sm font-medium">
        New workspace
        <input name="name" required maxLength={60} placeholder="e.g. Sales 2026" autoComplete="off" className={FIELD} />
      </label>
      <p role="alert" className="mt-2 min-h-5 text-sm text-secondary">
        {error}
      </p>
      <button
        disabled={pending}
        className="mt-1 min-h-11 w-full cursor-pointer rounded-xl bg-primary px-4 text-sm font-semibold text-paper transition-colors duration-150 hover:bg-primary-strong focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-80"
      >
        {pending ? "Creating…" : "Create workspace"}
      </button>
    </form>
  );
}
