import { ProgressBar } from "@/components/student/ProgressBar";
import { BAND_LABELS } from "@/lib/exam/structure";
import type { PaperSummary } from "@/lib/exam/service";
import { formatDay } from "@/lib/format";

const KIND_WORDS = {
  EXAM_STYLE_PAPER_1: "Paper 1 style (multiple choice)",
  EXAM_STYLE_PAPER_2: "Paper 2 style (structured questions)",
} as const;

/** Practice papers a child has finished. Always called what they are: ZimTutor practice scores. */
export function PapersList({ papers, name }: { papers: readonly PaperSummary[]; name: string }) {
  return (
    <>
      <p className="text-base text-muted">
        Practice papers follow the shape of the Grade 7 examination. A mark on one is a ZimTutor
        practice score. It is not a ZIMSEC result and does not predict one.
      </p>
      {papers.length === 0 ? (
        <p className="rounded-2xl border border-border bg-surface p-5 text-lg">
          {name} has not finished a practice paper yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {papers.map((paper) => (
            <li
              key={paper.id}
              className="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4"
            >
              <p className="text-sm font-semibold text-muted">
                {KIND_WORDS[paper.kind]} · {paper.length === "FULL" ? "full paper" : "short paper"}{" "}
                · {formatDay(paper.completedAt)}
              </p>
              <p className="text-xl font-bold">
                {paper.marksAwarded} of {paper.marksAvailable} · {paper.percent}%
                <span className="text-base font-normal text-muted"> practice score</span>
              </p>
              <ProgressBar percent={paper.percent ?? 0} label="Practice score" />
              {paper.bands.length > 0 ? (
                <p className="text-sm text-muted">
                  {paper.bands.map((b) => `${BAND_LABELS[b.band]} ${b.percent}%`).join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
