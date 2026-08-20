import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "School Finance Suite",
  description: "Every naira in and out of your school, reconciled and auditable.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
