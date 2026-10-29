import type { Metadata } from "next";
import { Newsreader, Poppins } from "next/font/google";
import "./globals.css";

// Poppins is not a variable font: only the weights the UI uses (normal, font-medium, font-semibold)
const poppins = Poppins({ variable: "--font-poppins", subsets: ["latin"], weight: ["400", "500", "600"] });
const newsreader = Newsreader({ variable: "--font-newsreader", subsets: ["latin"], axes: ["opsz"] });

export const metadata: Metadata = {
  title: "Referral Reports",
  description: "AI reporting assistant for referrals, PCPs and specialists",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${poppins.variable} ${newsreader.variable} h-full antialiased`}>
      <body className="h-full">{children}</body>
    </html>
  );
}
