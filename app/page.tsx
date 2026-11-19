import { redirect } from "next/navigation";
import { currentUser } from "./auth";
import Chat from "./Chat";
import Nav from "./workspaces/[id]/Nav";
import { listWorkspaces } from "./workspaces/server";

// per-user page behind auth: nothing to prerender, so block until the session is read
export const instant = false;

// The df-dev chat is for super admins only; everyone else works in their own workspaces
export default async function Home() {
  const me = await currentUser();
  if (me?.role !== "super_admin") redirect("/workspaces");
  const list = await listWorkspaces(me);
  // the df-dev chat is the super admin's default DoctorFare workspace; the sidebar lists it first
  return <Chat nav={<Nav id="df-dev" doctorfare workspaces={list.map((w) => ({ id: w._id.toString(), name: w.name }))} hasData={false} answered={false} data={null} />} />;
}
