import { CreateLearnerForm } from "@/components/auth/CreateLearnerForm";
import { CardPage } from "@/components/layout/PageShell";
import { requireRole } from "@/lib/auth/session";

export const metadata = { title: "Add a learner" };

export default async function NewLearnerPage() {
  await requireRole("parent", "/parent/learners/new");
  return (
    <CardPage
      title="Add a learner"
      intro="Your child doesn't need an email address. They sign in with the username and password you choose here."
    >
      <CreateLearnerForm />
    </CardPage>
  );
}
