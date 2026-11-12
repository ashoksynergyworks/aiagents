import { redirect } from "next/navigation";
import { currentUser } from "./auth";
import Chat from "./Chat";

// per-user page behind auth: nothing to prerender, so block until the session is read
export const instant = false;

// The df-dev chat is for super admins only; everyone else works in their own workspaces
export default async function Home() {
  if ((await currentUser())?.role !== "super_admin") redirect("/workspaces");
  return <Chat />;
}
