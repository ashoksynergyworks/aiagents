"use server";

import { revalidatePath } from "next/cache";
import { addUser, currentUser } from "../auth";

export type AddState = {
  error?: string;
  added?: { name: string; email: string; password: string };
};

// New users are always admins: any "role" in the request is ignored, so a super admin can't be created through this
// action. ponytail: other roles come later; take the role from the form then, with an allowlist that excludes super_admin.
export async function add(_: AddState, form: FormData): Promise<AddState> {
  const me = await currentUser();
  if (me?.role !== "super_admin") return { error: "Only super admins can add users." };
  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim();
  if (!name || name.length > 80) return { error: "Enter a name of up to 80 characters." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return { error: "Enter a valid email address." };
  const out = await addUser(me.email, { name, email, role: "admin" });
  if ("error" in out) return { error: out.error };
  revalidatePath("/users");
  return { added: { name, email: email.toLowerCase(), password: out.password } };
}
