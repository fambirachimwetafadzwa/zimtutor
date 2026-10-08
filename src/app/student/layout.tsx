import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/PageShell";
import { requireRole } from "@/lib/auth/session";

export default async function StudentLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("student");
  return (
    <>
      <AppHeader
        user={user}
        nav={[
          { href: "/student", label: "Home" },
          { href: "/student/progress", label: "My progress" },
        ]}
      />
      {children}
    </>
  );
}
