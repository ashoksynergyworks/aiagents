import type { Metadata } from "next";
import { DM_Sans, Newsreader } from "next/font/google";
import "./globals.css";
import ThemeScript from "./ThemeScript";

const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], axes: ["opsz"] });

export const metadata: Metadata = {
  title: "SW Prompt KPI",
  description: "AI reporting assistant for referrals, PCPs and specialists",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: the script below sets data-theme before React hydrates
    <html lang="en" suppressHydrationWarning className={`${dmSans.variable} ${newsreader.variable} h-full antialiased`}>
      <head>
        <ThemeScript />
      </head>
      <body className="h-full">{children}</body>
    </html>
  );
}
