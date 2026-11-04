"use client";

// Applies the saved theme (ThemePicker in page.tsx) before first paint. The server sends a real script that runs
// during HTML parsing; when React renders it on the client (dev remount, error recovery) it is an inert text/plain
// block, which is all a client-made script can be anyway, and React skips its "script tag" warning for those.
// Pattern from node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md
export default function ThemeScript() {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem("theme");if(t)document.documentElement.dataset.theme=t}catch(e){}` }}
    />
  );
}
