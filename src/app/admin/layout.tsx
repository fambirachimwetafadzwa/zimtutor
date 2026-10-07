import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/PageShell";
import { requireRole } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("admin");
  return (
    <>
      <AppHeader user={user} nav={[{ href: "/admin", label: "Admin" }]} />
      {children}
    </>
  );
}
