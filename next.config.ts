import type { NextConfig } from "next";

/**
 * Security headers. ZimTutor is a children's learning product, so the policy is
 * deliberately strict: no framing, no sensors (camera/microphone/geolocation are
 * never needed), and no referrer leakage.
 */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // pdfjs-dist is only used by the offline ingestion CLI, never bundled into the app.
  serverExternalPackages: ["pdfjs-dist", "postgres"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
