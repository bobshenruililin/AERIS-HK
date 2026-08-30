import type { Metadata } from "next";
import localFont from "next/font/local";
import { Noto_Sans_TC } from "next/font/google";
import "./globals.css";
import { AERIS_FULL_TITLE } from "@/lib/constants";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

const notoTc = Noto_Sans_TC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-tc",
  display: "swap",
});

export const metadata: Metadata = {
  title: AERIS_FULL_TITLE,
  description:
    "Aerospace-grade urban microclimate digital twin and Hospital Authority cardiovascular surge engine for Sham Shui Po and Yau Tsim Mong.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-HK" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${notoTc.variable} bg-[#05070c] antialiased`}
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
