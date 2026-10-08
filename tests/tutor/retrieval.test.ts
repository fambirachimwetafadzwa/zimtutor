import { describe, expect, it, vi } from "vitest";
import { createLocalHashProvider } from "../../src/lib/ai/embeddings";
import { createMockProvider } from "../../src/lib/ai/llm/mock";
import {
  bestLine,
  bestQuote,
  contextPhrase,
  createRetriever,
  fuse,
  searchQuery,
  type Passage,
  type SearchPort,
  type Retriever,
} from "../../src/lib/tutor/retrieval";
import { act, startOrResume, type TutorDeps } from "../../src/lib/tutor/service";
import { createVoice } from "../../src/lib/tutor/voice";
import { MemoryBankStore } from "../questions/memory-store";
import { FixtureCurriculum } from "./learner";
import { MemoryTutorStore } from "./memory-store";
import { factsFor, objectiveById } from "./support";

const GOAL = "G5-OPS-ADDITION-WHOLE-NUMBERS-001";
const objective = factsFor(objectiveById(GOAL));

const passage = (id: string, text: string, page: number | null = 42): Passage => ({
  id,
  objectiveId: id.replace("obj:", ""),
  section: "COMPETENCY_OBJECTIVE",
  text,
  page,
  pageEnd: null,
});

const OWN = passage(
  `obj:${GOAL}`,
  [
    "Grade 5 Mathematics — Operations",
    "Sub-topic: Addition of whole numbers",
    "Objective (pupils should be able to): demonstrate an understanding of basic addition facts",
    "Content:",
    "- Addition of whole numbers whose sum is less than or equal to 100 000",
    "Suggested notes and activities:",
    "- Adding whole numbers which require carrying twice",
    "- Working out problems involving the commutative law",
  ].join("\n"),
);

describe("searching the syllabus", () => {
  it("turns a child's question into content words for the full-text search", () => {
    expect(searchQuery("why do we carry the one?")).toBe("carry");
    expect(searchQuery("What is a numerator and a denominator?")).toBe("numerator or denominator");
    expect(searchQuery("how?")).toBe("");
    expect(searchQuery("carry carry CARRY and borrow")).toBe("carry or borrow");
    expect(
      searchQuery(
        "a b cc dddd eeeee ffffff gggggggg hhhhhhhh iiiiiiii jjjjjjjj kkkkkkkk llllllll",
      ).split(" or ").length,
    ).toBe(8);
  });

  it("builds the embedded phrase from the curriculum, never from the child's words", () => {
    const phrase = contextPhrase(objective);
    expect(phrase).toContain(objective.text.replace(/[.]+$/, ""));
    expect(phrase).toContain(objective.subtopicName);
    expect(phrase).toContain(objective.topicName);
  });

  it("fuses ranked lists, rewarding what several lists agree on", () => {
    const a = passage("obj:A", "a");
    const b = passage("obj:B", "b");
    const c = passage("obj:C", "c");
    expect(
      fuse(
        [
          [a, b],
          [b, c],
        ],
        3,
      ).map((p) => p.id),
    ).toEqual(["obj:B", "obj:A", "obj:C"]);
    expect(fuse([[a], [], [c]], 1).map((p) => p.id)).toEqual(["obj:A"]);
    expect(fuse([], 3)).toEqual([]);
  });

  it("always considers the goal's own text, searches only this grade and topic, and embeds only context", async () => {
    const seen: Record<string, unknown> = {};
    const port: SearchPort = {
      forObjective: async () => OWN,
      text: async (query, filter, limit) => {
        Object.assign(seen, { query, textFilter: filter, textLimit: limit });
        return [passage("obj:G5-OPS-ADDITION-WHOLE-NUMBERS-002", "- carrying over a hundred"), OWN];
      },
      vector: async (_vector, filter) => {
        Object.assign(seen, { vectorFilter: filter });
        return [OWN];
      },
    };
    const embed = vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2]));
    const retriever = createRetriever(port, { model: "test", embed });
    const found = await retriever.passages({ message: "why do we carry the one?", objective });
    // the passage both searches and the goal itself agree on comes first
    expect(found[0]!.id).toBe(OWN.id);
    expect(found.length).toBeLessThanOrEqual(3);
    expect(seen).toMatchObject({
      query: "carry",
      textFilter: { grade: 5, topic: "Operations" },
      vectorFilter: { grade: 5, topic: "Operations" },
    });
    // what was embedded: the curriculum phrase, and none of the child's words
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0]![0]).toEqual([contextPhrase(objective)]);
    expect(JSON.stringify(embed.mock.calls)).not.toMatch(/carry the one/);
  });

  it("works without an embedding provider, and skips the text search for a question with no content words", async () => {
    const text = vi.fn(async () => []);
    const vector = vi.fn(async () => []);
    const port: SearchPort = { forObjective: async () => OWN, text, vector };
    const found = await createRetriever(port, null).passages({ message: "why?", objective });
    expect(found).toEqual([OWN]);
    expect(text).not.toHaveBeenCalled();
    expect(vector).not.toHaveBeenCalled();
  });

  it("keeps long passages short, cutting at a line", async () => {
    const long = passage(
      "obj:LONG",
      Array.from({ length: 60 }, (_, i) => `- line number ${i} of the syllabus`).join("\n"),
    );
    const port: SearchPort = {
      forObjective: async () => long,
      text: async () => [],
      vector: async () => [],
    };
    const [found] = await createRetriever(port, null).passages({ message: "x", objective });
    expect(found!.text.length).toBeLessThanOrEqual(700);
    expect(found!.text.endsWith("of the syllabus")).toBe(true);
  });
});

describe("choosing the line that answers", () => {
  it("picks the syllabus line that shares the most words with the question, never a heading", () => {
    expect(bestLine(OWN, "why do we carry the one?")).toBe(
      "Adding whole numbers which require carrying twice",
    );
    expect(bestLine(OWN, "what is the commutative law")).toBe(
      "Working out problems involving the commutative law",
    );
    expect(bestLine(OWN, "something unrelated about triangles")).toBeNull();
    // the sub-topic heading mentions 'addition' but headings are never quoted
    expect(bestLine(OWN, "addition")).toBe(
      "Addition of whole numbers whose sum is less than or equal to 100 000",
    );
  });

  it("picks across passages", () => {
    const other = passage("obj:X", "- explain borrowing when subtracting");
    const quote = bestQuote([OWN, other], "what is borrowing");
    expect(quote!.line).toBe("explain borrowing when subtracting");
    expect(quote!.passage.id).toBe("obj:X");
    expect(bestQuote([OWN], "triangles")).toBeNull();
    expect(bestQuote([], "anything")).toBeNull();
  });
});

describe("answering a child's question with the syllabus", () => {
  const learner = "learner-1";
  const world = (
    retriever: Retriever | undefined,
    provider?: ReturnType<typeof createMockProvider>,
  ) => {
    const bank = new MemoryBankStore();
    const store = new MemoryTutorStore(bank);
    let n = 0;
    const deps: TutorDeps = {
      store,
      bank,
      curriculum: new FixtureCurriculum(),
      voice: createVoice(provider ? { provider } : {}),
      seed: () => `seed-${++n}`,
      ...(retriever ? { retriever } : {}),
    };
    return { deps, store };
  };
  const portWith = (hits: Passage[]): SearchPort => ({
    forObjective: async () => OWN,
    text: async () => hits,
    vector: async () => [],
  });

  it("shows the syllabus's own line apart from the tutor's words, with its page", async () => {
    const { deps } = world(createRetriever(portWith([]), createLocalHashProvider()));
    const start = await startOrResume(deps, {
      learnerId: learner,
      objectiveId: GOAL,
      mode: "PRACTISE",
    });
    const view = await act(deps, {
      learnerId: learner,
      sessionId: start.sessionId,
      action: { type: "ASK", text: "why do we carry the one?" },
    });
    const reply = view.messages.at(-1)!;
    expect(reply.kind).toBe("ANSWER");
    expect(reply.quotes).toEqual([
      { label: "From the syllabus", items: ["Adding whole numbers which require carrying twice"] },
    ]);
    expect(reply.citation).toMatch(/Junior Mathematics Syllabus.*, page 42/);
    expect(reply.text).toMatch(/box below/);
    expect(reply.source).toBe("template");
  });

  it("gives the model the passages to answer from, and accepts an answer that stays inside them", async () => {
    const provider = createMockProvider(
      () =>
        "Good question! When adding, you carry when a column adds up to ten or more. The syllabus has practice for carrying twice.",
    );
    const { deps } = world(createRetriever(portWith([]), null), provider);
    const start = await startOrResume(deps, {
      learnerId: learner,
      objectiveId: GOAL,
      mode: "PRACTISE",
    });
    const view = await act(deps, {
      learnerId: learner,
      sessionId: start.sessionId,
      action: { type: "ASK", text: "why do we carry the one?" },
    });
    expect(view.messages.at(-1)).toMatchObject({ source: "model" });
    const prompt = provider.calls.at(-1)!.messages[0]!.content;
    expect(prompt).toContain("official syllabus passages");
    expect(prompt).toContain("[1] (page 42)");
    expect(prompt).toContain("carrying twice");
    expect(prompt).toContain("<learner_message>");
  });

  it("answers from the goal alone when there is no retriever, or when the search fails", async () => {
    for (const retriever of [
      undefined,
      {
        passages: async () => {
          throw new Error("search is down");
        },
      } as Retriever,
    ]) {
      const { deps } = world(retriever);
      const start = await startOrResume(deps, {
        learnerId: learner,
        objectiveId: GOAL,
        mode: "PRACTISE",
      });
      const view = await act(deps, {
        learnerId: learner,
        sessionId: start.sessionId,
        action: { type: "ASK", text: "why do we carry the one?" },
      });
      const reply = view.messages.at(-1)!;
      expect(reply).toMatchObject({ kind: "ANSWER", quotes: [] });
      expect(reply.text).toMatch(/Hint button/);
    }
  });
});
