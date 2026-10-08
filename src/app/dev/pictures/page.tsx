import { readFileSync } from "node:fs";
import { notFound } from "next/navigation";
import { Picture } from "@/components/learn/pictures";
import { snapshotSchema } from "@/ingestion/snapshot";
import { generateQuestion } from "@/lib/questions/generate";
import { objectivesFromSnapshot } from "@/lib/questions/objectives";
import { ALL_TEMPLATES } from "@/lib/questions/templates";
import type { StemData } from "@/lib/questions/types";

/**
 * A development-only sheet of every kind of question picture, drawn from real generated questions, for
 * checking them by eye. It does not exist in a production build.
 */

export const metadata = { title: "Question pictures (development)" };
export const dynamic = "force-dynamic";

export default function PictureGallery() {
  if (process.env.NODE_ENV === "production") notFound();
  const snapshot = snapshotSchema.parse(
    JSON.parse(
      readFileSync("curriculum/snapshots/mopse-junior-mathematics-2024-2030.json", "utf8"),
    ),
  );
  const objectives = objectivesFromSnapshot(snapshot);
  const byKind = new Map<string, Array<{ data: StemData; stem: string; where: string }>>();
  for (const objective of objectives) {
    for (const difficulty of [1, 2, 3, 4, 5] as const) {
      for (const seed of ["gallery-a", "gallery-b", "gallery-c"]) {
        let q;
        try {
          q = generateQuestion({ objective, difficulty, seed, templates: ALL_TEMPLATES });
        } catch {
          break;
        }
        if (!q.stemData) continue;
        const list = byKind.get(q.stemData.kind) ?? [];
        if (
          list.length < 3 &&
          !list.some(
            (e) => e.stem === q.stem && JSON.stringify(e.data) === JSON.stringify(q.stemData),
          )
        )
          list.push({
            data: q.stemData,
            stem: q.stem,
            where: `${q.templateId} · ${objective.id} · level ${difficulty}`,
          });
        byKind.set(q.stemData.kind, list);
      }
    }
  }
  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-8">
      <h1 className="text-3xl font-bold">Question pictures</h1>
      {[...byKind.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([kind, items]) => (
          <section key={kind} id={kind} className="flex flex-col gap-3">
            <h2 className="text-xl font-bold">{kind}</h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {items.map((item, i) => (
                <figure
                  key={i}
                  className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4"
                >
                  <Picture data={item.data} />
                  <figcaption className="text-sm text-muted">
                    <span className="block font-semibold text-foreground">{item.stem}</span>
                    {item.where}
                  </figcaption>
                </figure>
              ))}
            </div>
          </section>
        ))}
    </main>
  );
}
