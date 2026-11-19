"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { currentUser } from "../auth";
import { createWorkspace, deleteWorkspace, getWorkspace, makeStarters, workspaces } from "./server";

export async function create(_: string, form: FormData) {
  const user = await currentUser();
  if (!user) return "Please sign in again.";
  const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 60) return "Enter a name of up to 60 characters.";
  const out = await createWorkspace(user, name);
  if ("error" in out) return out.error!;
  redirect(`/workspaces/${out.id}`);
}

// The interview answers (docs/workspaces-plan.md 3.7). The form sends every question, earlier ones too, so a cleared answer is removed.
export async function saveContext(id: string, _: string, form: FormData) {
  const user = await currentUser();
  if (!user) return "Please sign in again.";
  const ws = await getWorkspace(id, user);
  if (!ws) return "Workspace not found.";
  const questions = form.getAll("question").map((q) => String(q).trim().slice(0, 200));
  const answers = form.getAll("answer").map((a) => String(a).replace(/\r\n/g, "\n").trim());
  if (questions.length !== answers.length || questions.length > 30) return "Reload the page and try again.";
  if (answers.some((a) => a.length > 2000)) return "Keep each answer under 2,000 characters.";
  const context = questions.map((question, i) => ({ question, answer: answers[i] })).filter((c) => c.question && c.answer);
  if (!context.length) return "Answer at least one question, or choose Skip for now.";
  const next = { ...ws, context };
  await (await workspaces()).updateOne({ _id: ws._id }, { $set: { context, starters: await makeStarters(next), updatedAt: new Date() } });
  redirect(`/workspaces/${id}`);
}

export async function remove(id: string) {
  const user = await currentUser();
  if (!user) redirect("/login");
  await deleteWorkspace(id, user);
  revalidatePath("/workspaces");
}
