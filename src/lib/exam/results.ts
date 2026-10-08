import { BANDS, type SkillBand } from "./structure";
import type { PaperPlan } from "./plan";

/**
 * Turning the marks of a paper into what a child, a parent and the planner need: the mark, how it
 * divides between the skills and the topics, and what to practise. Pure.
 *
 * The mark is a ZIMTUTOR PRACTICE SCORE. It says how a child did on this practice paper; it is never a
 * ZIMSEC result and must never be shown as one.
 */

export interface ResultItem {
  section: string;
  number: number;
  part: number;
  marks: number;
  band: SkillBand;
  topicCode: string;
  objectiveId: string;
  /** Share of the marks earned, 0 to 1. */
  awarded: number;
  answered: boolean;
  /** Misconceptions shown by a wrong answer. */
  tags: string[];
}

export interface Share {
  awarded: number;
  available: number;
  percent: number;
}

export interface PaperResult {
  marksAwarded: number;
  marksAvailable: number;
  percent: number;
  bands: Array<{ band: SkillBand } & Share>;
  topics: Array<{ topicCode: string } & Share>;
  /** The questions that counted, as "section:number". */
  counted: string[];
  /** Questions the child left alone altogether, among those that count. */
  unanswered: number;
  /** Objectives where marks were lost, most marks lost first. */
  revisit: Array<{ objectiveId: string; lost: number }>;
  /** Misconceptions that showed up, most often first. */
  misconceptions: Array<{ tag: string; count: number }>;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const share = (awarded: number, available: number): Share => ({
  awarded: round2(awarded),
  available: round2(available),
  percent: available === 0 ? 0 : Math.round((awarded / available) * 1000) / 10,
});

export function summarise(plan: PaperPlan, items: readonly ResultItem[]): PaperResult {
  const counted: ResultItem[] = [];
  const countedQuestions: string[] = [];
  let unanswered = 0;

  for (const section of plan.sections) {
    const inSection = items.filter((i) => i.section === section.id);
    const numbers = [...new Set(inSection.map((i) => i.number))].sort((a, b) => a - b);
    const questions = numbers.map((number) => {
      const parts = inSection.filter((i) => i.number === number);
      return {
        number,
        parts,
        score: parts.reduce((n, p) => n + p.marks * p.awarded, 0),
        attempted: parts.some((p) => p.answered),
      };
    });
    // when the child chooses, the best answered questions count; if fewer were answered, the rest
    // of what should have counted counts as nothing
    const chosen =
      section.counted >= section.offered
        ? questions
        : [
            ...questions
              .filter((q) => q.attempted)
              .sort((a, b) => b.score - a.score || a.number - b.number),
            ...questions.filter((q) => !q.attempted).sort((a, b) => a.number - b.number),
          ].slice(0, section.counted);
    for (const q of chosen) {
      counted.push(...q.parts);
      countedQuestions.push(`${section.id}:${q.number}`);
      if (!q.attempted) unanswered += 1;
    }
  }

  const available = counted.reduce((n, i) => n + i.marks, 0);
  const awarded = counted.reduce((n, i) => n + i.marks * i.awarded, 0);

  const bands = BANDS.map((band) => {
    const mine = counted.filter((i) => i.band === band);
    return {
      band,
      ...share(
        mine.reduce((n, i) => n + i.marks * i.awarded, 0),
        mine.reduce((n, i) => n + i.marks, 0),
      ),
    };
  });
  const topicCodes = [...new Set(counted.map((i) => i.topicCode))].sort();
  const topics = topicCodes.map((topicCode) => {
    const mine = counted.filter((i) => i.topicCode === topicCode);
    return {
      topicCode,
      ...share(
        mine.reduce((n, i) => n + i.marks * i.awarded, 0),
        mine.reduce((n, i) => n + i.marks, 0),
      ),
    };
  });

  const lost = new Map<string, number>();
  const tags = new Map<string, number>();
  for (const item of counted) {
    const missed = item.marks * (1 - item.awarded);
    if (missed > 0.001) lost.set(item.objectiveId, (lost.get(item.objectiveId) ?? 0) + missed);
    if (item.awarded < 1) for (const tag of item.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  }

  return {
    marksAwarded: round2(awarded),
    marksAvailable: round2(available),
    percent: share(awarded, available).percent,
    bands,
    topics,
    counted: countedQuestions,
    unanswered,
    revisit: [...lost]
      .map(([objectiveId, marks]) => ({ objectiveId, lost: round2(marks) }))
      .sort((a, b) => b.lost - a.lost || a.objectiveId.localeCompare(b.objectiveId)),
    misconceptions: [...tags]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
}
