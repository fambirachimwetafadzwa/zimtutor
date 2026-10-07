import { GradePicker } from "@/components/auth/GradePicker";
import { CardPage } from "@/components/layout/PageShell";
import { getLearnerProfile, requireRole } from "@/lib/auth/session";

export const metadata = { title: "Choose your grade" };

export default async function OnboardingPage() {
  const user = await requireRole("student", "/student/onboarding");
  const learner = await getLearnerProfile(user.id);
  return (
    <CardPage title="Which grade are you in?" intro="We'll start with the maths for your grade.">
      <GradePicker current={learner?.grade} />
    </CardPage>
  );
}
