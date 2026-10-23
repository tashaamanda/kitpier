import type { Metadata } from "next";
import { Suspense } from "react";
import { Instrument_Sans, Lato } from "next/font/google";
import Reveal from "@/components/Reveal";
import "./globals.css";

// Design system (kitpier-design.md): Instrument Sans for wordmark/headlines/figures, Lato for everything else.
const display = Instrument_Sans({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500"],
  style: ["normal", "italic"],
});

const body = Lato({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["300", "400", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Kitpier — the app store for AI-built software",
  description: "Discover, buy, and connect the services your app needs, with PayPal checkout.",
  robots: { index: false, follow: false }, // not listed in search engines until after the hackathon
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
        {/* reads the URL, so it streams in after prerendering (Cache Components) */}
        <Suspense fallback={null}>
          <Reveal />
        </Suspense>
      </body>
    </html>
  );
}
