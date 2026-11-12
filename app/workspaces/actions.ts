"use server";

import { redirect } from "next/navigation";
import { currentUser } from "../auth";
import { createWorkspace } from "./server";

export async function create(_: string, form: FormData) {
  const user = await currentUser();
  if (!user) return "Please sign in again.";
  const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 60) return "Enter a name of up to 60 characters.";
  const out = await createWorkspace(user, name);
  if ("error" in out) return out.error!;
  redirect(`/workspaces/${out.id}`);
}
