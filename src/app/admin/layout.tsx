import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/PageShell";
import { requireRole } from "@/lib/auth/session";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("admin");
  return (
    <>
      <AppHeader
        user={user}
        nav={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/curriculum", label: "Curriculum" },
          { href: "/admin/supplemental", label: "Supplemental content" },
          { href: "/admin/audit", label: "Audit log" },
        ]}
      />
      {children}
    </>
  );
}
