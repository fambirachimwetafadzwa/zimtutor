import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ZimTutor — Zimbabwe Junior Mathematics",
    template: "%s · ZimTutor",
  },
  description:
    "An adaptive Mathematics tutor for Grades 3–7, built on the MoPSE Junior Mathematics Syllabus 2024–2030.",
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f6b4f",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Every page is rendered for the request it answers: the Content Security Policy carries a nonce made
  // for that request, which a page built ahead of time could not have.
  await connection();
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
