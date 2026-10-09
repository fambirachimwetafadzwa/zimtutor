import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { CardPage } from "@/components/layout/PageShell";
import { getCurrentUser } from "@/lib/auth/session";
import { redirect } from "next/navigation";

export const metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  // only someone who has followed the link in their email (and so has a session) can be here
  const user = await getCurrentUser();
  if (!user || user.role !== "parent") redirect("/forgot-password");
  return (
    <CardPage title="Choose a new password" intro={`Hello, ${user.displayName}.`}>
      <ResetPasswordForm />
    </CardPage>
  );
}
