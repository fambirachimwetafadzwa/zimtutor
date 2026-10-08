import { notFound, redirect } from "next/navigation";
import { AppPage } from "@/components/layout/PageShell";
import { Lesson } from "@/components/learn/Lesson";
import { getLearnerProfile, requireRole } from "@/lib/auth/session";
import { createTutorDeps } from "@/lib/tutor/server";
import { buildView } from "@/lib/tutor/service";
import { LESSON_MODES, type LessonMode } from "@/lib/tutor/state";

type Params = Promise<{ objectiveId: string }>;
type Search = Promise<{ mode?: string; for?: string }>;

export const metadata = { title: "Lesson" };

export default async function LessonPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Search;
}) {
  const { objectiveId } = await params;
  const query = await searchParams;
  const user = await requireRole("student", `/student/learn/${objectiveId}`);
  const learner = await getLearnerProfile(user.id);
  if (!learner || !learner.onboardingCompleted) redirect("/student/onboarding");

  const deps = createTutorDeps();
  const facts = await deps.curriculum.facts(objectiveId);
  if (!facts || facts.grade > learner.grade) notFound();

  // Opening this page never starts a lesson (a page view must not change anything): it shows the one
  // already open, or a Start button.
  const open = await deps.store.findActiveSession(user.id, objectiveId);
  const initialView = open ? await buildView(deps, open) : null;

  const mode: LessonMode | undefined = LESSON_MODES.find((m) => m === query.mode);
  return (
    <AppPage>
      <Lesson
        goal={{
          id: facts.id,
          text: facts.text,
          grade: facts.grade,
          topic: facts.topicName,
          subtopic: facts.subtopicName,
        }}
        initialView={initialView}
        {...(mode ? { mode } : {})}
        {...(query.for ? { forObjectiveId: query.for } : {})}
      />
    </AppPage>
  );
}
