import { currentUser } from "../../../../auth";
import { standardise } from "../../../../workspaces/standardise";
import { aiPlan, collectionNames, getWorkspace, readSheets, storeTable } from "../../../../workspaces/server";

const PREVIEW_ROWS = 50;

// One endpoint, two steps (docs/workspaces-plan.md 3.5):
//   file only        → read, AI format plan, standardise, return a preview and the plan per sheet
//   file + "plans"   → apply the plans the user confirmed and store. The same code with the same plan gives the
//                      same rows, so nothing is staged between the two calls.
// Route handler, not a Server Action: actions cap the body at 1 MB by default.
export async function POST(req: Request, ctx: RouteContext<"/api/workspaces/[id]/upload">) {
  const user = await currentUser();
  if (!user) return Response.json({ error: "Please sign in again." }, { status: 401 });
  const ws = await getWorkspace((await ctx.params).id, user);
  if (!ws) return Response.json({ error: "Workspace not found." }, { status: 404 });
  const tag = `[upload ${crypto.randomUUID().slice(0, 8)}]`;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });
  let sheets;
  try {
    sheets = await readSheets(file);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
  const names = collectionNames(sheets.map((s) => s.name));
  // ponytail: sheet and file names only; rows can hold personal data
  console.log(tag, ws.dbName, `${sheets.length} sheet(s)`, form!.has("plans") ? "store" : "preview");

  if (form!.has("plans")) {
    let plans: { name: string; plan: unknown }[];
    try {
      plans = JSON.parse(String(form!.get("plans")));
      if (!Array.isArray(plans) || !plans.length) throw new Error();
    } catch {
      return Response.json({ error: "Choose at least one sheet to store." }, { status: 400 });
    }
    const stored = [];
    for (const { name, plan } of plans) {
      const i = sheets.findIndex((s) => s.name === name);
      if (i < 0) return Response.json({ error: `The file has no sheet named “${name}”. Upload it again.` }, { status: 400 });
      try {
        const r = standardise(sheets[i].grid, plan);
        const t = await storeTable(ws, name, names[i], r.columns, r.rows);
        stored.push({ sheet: name, collection: t.collection, rows: t.rows });
      } catch (e) {
        console.error(tag, "store failed", names[i], (e as Error).message);
        return Response.json({ error: `${name}: ${(e as Error).message}`, stored }, { status: 400 });
      }
    }
    console.log(tag, "stored", stored.map((s) => `${s.collection}(${s.rows})`).join(" "));
    return Response.json({ stored });
  }

  const preview = await Promise.all(
    sheets.map(async (s, i) => {
      const ai = await aiPlan(s.grid, tag);
      const replaces = ws.tables.find((t) => t.collection === names[i])?.rows ?? null;
      try {
        const r = standardise(s.grid, ai);
        return { name: s.name, collection: names[i], replaces, ai: ai !== null, plan: r.plan, columns: r.columns, rows: r.rows.slice(0, PREVIEW_ROWS), total: r.rows.length, changes: r.changes };
      } catch (e) {
        return { name: s.name, collection: names[i], replaces, error: (e as Error).message };
      }
    }),
  );
  return Response.json({ file: file.name, sheets: preview });
}
