"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { checkPassword, COOKIE, setSession } from "../auth";

// ponytail: no rate limit; scrypt slows guessing a little. Add a per-IP limit before this faces the open internet.
export async function login(_: string, form: FormData) {
  const user = checkPassword(String(form.get("email") ?? ""), String(form.get("password") ?? ""));
  if (!user) return "The email or password is not correct.";
  await setSession(user.email);
  redirect("/");
}

export async function logout() {
  (await cookies()).delete(COOKIE);
  redirect("/login");
}
