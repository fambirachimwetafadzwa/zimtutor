import type { ReactNode } from "react";
import { AppHeader } from "@/components/layout/PageShell";
import { requireRole } from "@/lib/auth/session";

export default async function ParentLayout({ children }: { children: ReactNode }) {
  const user = await requireRole("parent");
  return (
    <>
      <AppHeader user={user} nav={[{ href: "/parent", label: "My learners" }]} />
      {children}
    </>
  );
}
