import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Schibsted_Grotesk } from "next/font/google";

import { Header } from "@/components/header";
import { Providers } from "@/components/providers";
import "./globals.css";

const display = Schibsted_Grotesk({ subsets: ["latin"], variable: "--font-schibsted", weight: ["500", "600", "700"] });
const sans = Inter({ subsets: ["latin"], variable: "--font-inter" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Kinpot · Pay the bill, not the person",
  description:
    "Siblings abroad pool money for a family bill. It goes straight to the school, hospital or landlord, and only when the bill is covered, confirmed and due.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f3ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1014" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh">
        <Providers>
          <Header />
          <main className="mx-auto w-full max-w-5xl px-4 pb-24 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
