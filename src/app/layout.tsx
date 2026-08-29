import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, Karla, Fraunces } from "next/font/google";
import "./globals.css";

/* --------------------------------------------------------------- */
/*  Fonts — loaded via next/font so they self-host at the edge.    */
/*  display:"swap" prevents FOIT and keeps the LCP text visible.   */
/* --------------------------------------------------------------- */
const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-bricolage",
  display: "swap",
  preload: true,
});
const karla = Karla({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-karla",
  display: "swap",
  preload: true,
});
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
  preload: false, // only used for accents; skip preload to save one round-trip
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://school-finance-navy.vercel.app";
const SITE_NAME = "Smart & Thrive O/S";
const SITE_DESC =
  "The operating system for ambitious schools — admissions, finance, attendance, CBT, report cards and a parent-facing website in one connected suite.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `${SITE_NAME} — The operating system for ambitious schools`,
    template: `%s · ${SITE_NAME}`,
  },
  description: SITE_DESC,
  applicationName: SITE_NAME,
  keywords: [
    "school management software",
    "school finance",
    "school admissions",
    "CBT",
    "computer-based testing",
    "student information system",
    "SIS",
    "attendance software",
    "report cards",
    "parent portal",
    "school SaaS",
    "school ERP",
    "Nigeria schools",
    "Africa education technology",
  ],
  authors: [{ name: SITE_NAME }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  formatDetection: {
    email: false,
    address: false,
    telephone: false,
  },
  openGraph: {
    title: `${SITE_NAME} — The operating system for ambitious schools`,
    description: SITE_DESC,
    url: SITE_URL,
    siteName: SITE_NAME,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: `${SITE_NAME} — The operating system for ambitious schools`,
    description: SITE_DESC,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
  category: "education",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#FAF7EF" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1F35" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${bricolage.variable} ${karla.variable} ${fraunces.variable}`}>
      <head>
        {/* DNS prefetch + preconnect for the Supabase host so the very
            first query has warm sockets ready. */}
        <link rel="dns-prefetch" href="https://dqlsdocmjudzyzmqisrx.supabase.co" />
        <link rel="preconnect" href="https://dqlsdocmjudzyzmqisrx.supabase.co" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
