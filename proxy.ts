import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, verifyToken } from "./app/auth";

// Every page and API call needs a valid session, except the login page and static files.
export function proxy(req: NextRequest) {
  const user = verifyToken(req.cookies.get(COOKIE)?.value);
  const { pathname } = req.nextUrl;
  if (pathname === "/login") return user ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  if (user) return NextResponse.next();
  if (pathname.startsWith("/api/")) return Response.json({ error: "Please sign in again." }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|logo.svg).*)"],
};
