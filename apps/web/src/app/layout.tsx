import { GeistMono } from "geist/font/mono";
import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { LanguageProvider } from "../i18n/language-provider.tsx";
import { PlannerProvider } from "../planner/planner-provider.tsx";
import "./globals.css";

const instrumentSerif = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument-serif",
});

export const metadata = {
  metadataBase: new URL(
    `http://localhost:${process.env.PLANNER_WEB_PORT ?? "3210"}`,
  ),
  title: "Roomkit",
  description: "Make a room that feels right.",
  openGraph: {
    title: "Roomkit",
    description: "Make a room that feels right.",
    images: [{ url: "/og-1200x630.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Roomkit",
    description: "Make a room that feels right.",
    images: ["/og-1200x630.png"],
  },
} satisfies Metadata;

type RootLayoutProps = { children: ReactNode };

export default function RootLayout(props: RootLayoutProps) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${GeistMono.variable} ${instrumentSerif.variable}`}
    >
      <body>
        <PlannerProvider>
          <LanguageProvider>{props.children}</LanguageProvider>
        </PlannerProvider>
      </body>
    </html>
  );
}
