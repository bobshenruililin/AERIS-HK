import type { Metadata, Viewport } from "next";
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

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: AERIS_FULL_TITLE,
  description:
    "A living thermal Earth of Kowloon West: ISO 7243 WBGT, Gagge two-node physiology, and Hospital Authority M/M/c surge — queryable like a map, citable like a paper.",
  applicationName: "AERIS-HK",
  keywords: [
    "AERIS-HK",
    "Kowloon West",
    "WBGT",
    "ISO 7243",
    "digital twin",
    "Hospital Authority",
    "Sham Shui Po",
    "Yau Tsim Mong",
  ],
  openGraph: {
    title: "AERIS-HK · Kowloon West Earth",
    description:
      "Organize the city's thermal truth. ISO 7243 WBGT · Gagge two-node · M/M/c. 把一座城市的熱真實，做成可查詢的地球。",
    locale: "zh_HK",
    type: "website",
    images: [{ url: "/decade/harbour_approach.png", width: 1536, height: 1024, alt: "Victoria Harbour approach into Kowloon West" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AERIS-HK · Kowloon West Earth",
    description: "A living thermal Earth of Sham Shui Po and Yau Tsim Mong.",
    images: ["/decade/harbour_approach.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#05070c",
  width: "device-width",
  initialScale: 1,
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
