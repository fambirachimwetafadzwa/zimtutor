import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ExamPaper } from "@/components/exam/ExamPaper";
import { ExamResults } from "@/components/exam/ExamResults";
import { AppPage } from "@/components/layout/PageShell";
import { getLearnerProfile, requireRole } from "@/lib/auth/session";
import { createExamDeps } from "@/lib/exam/server";
import { ExamError, getPaperView } from "@/lib/exam/service";

type Params = Promise<{ id: string }>;

export const metadata = { title: "Practice paper" };

export default async function PaperPage({ params }: { params: Params }) {
  const { id } = await params;
  const user = await requireRole("student", `/student/exams/${id}`);
  const learner = await getLearnerProfile(user.id);
  if (!learner || !learner.onboardingCompleted) redirect("/student/onboarding");
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) notFound();

  let view;
  try {
    view = await getPaperView(createExamDeps(), { setId: parsed.data, learnerId: user.id });
  } catch (error) {
    if (error instanceof ExamError) notFound(); // not theirs, or not a paper
    throw error;
  }
  return (
    <AppPage>
      {view.status === "COMPLETED" ? <ExamResults view={view} /> : <ExamPaper view={view} />}
    </AppPage>
  );
}
