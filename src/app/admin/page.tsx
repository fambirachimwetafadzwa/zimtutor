import { AppPage } from "@/components/layout/PageShell";
import { requireRole } from "@/lib/auth/session";

export const metadata = { title: "Admin" };

export default async function AdminHome() {
  await requireRole("admin", "/admin");
  return (
    <AppPage>
      <h1 className="text-3xl font-bold tracking-tight">Administration</h1>
      <p className="text-lg text-muted">The curriculum browser will appear here.</p>
    </AppPage>
  );
}
