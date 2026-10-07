import type { Metadata, Viewport } from "next";
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

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
