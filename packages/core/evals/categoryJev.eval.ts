/**
 * DEVELOPMENT-TIME audit of `classifyCategory` against TypeSafe/Jev. Not part of `pnpm test`, not
 * shipped, not imported by the app — see docs/adr/0007.
 *
 *   TYPESAFE_API_KEY=... CATEGORY_NAMES_FILE=names.json pnpm --filter @testcard/core eval:categories
 *
 * `names.json` is `{ "live": string[], "movie": string[], "series": string[] }` of provider category
 * names. Only those names (plus the content kind) are ever sent — no source names, hosts, URLs,
 * usernames or passwords, none of which this script has access to. Jev's answers are cached in
 * `evals/.cache/` (gitignored) so reruns cost nothing; delete it, or bump QUESTION_VERSION, to
 * re-ask. The report lists where the rules and Jev disagree so the *rules* can be improved; Jev never
 * writes anything the app reads.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GENRES, classifyCategory } from "../src/normalise/classifyCategory.js";
import { isSafeToSend } from "./safeToSend.js";

const API = "https://api.typesafe.ai/v1/systemone";
/** Bump when the questions below change, so cached answers to the old wording aren't reused. */
const QUESTION_VERSION = 1;
const CONCURRENCY = 6;

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(here, ".cache", "jev-categories.json");
const apiKey = process.env["TYPESAFE_API_KEY"];
const namesFile = process.env["CATEGORY_NAMES_FILE"];

interface JevLabel {
  readonly genre: string;
  readonly genreConfidence: number;
  readonly junk: number;
}

const GENRE_CRITERIA: Record<string, string> = {
  sports: "Sports events, leagues, teams or sports channels",
  kids: "Content for children: kids channels, cartoons, children's programming",
  news: "News, weather, business or politics coverage",
  documentary: "Documentaries, nature, history, science or true-crime factual content",
  music: "Music, concerts, music videos, musicals or radio",
  reality: "Reality TV, lifestyle, cooking or home shows",
  comedy: "Comedy, sitcoms or stand-up",
  drama: "Drama, soaps or telenovelas",
  action: "Action, adventure, war, western or martial arts",
  horror: "Horror or thriller",
  scifi: "Science fiction or fantasy",
  romance: "Romance or romantic comedy",
  animation: "Animation or anime for a general audience",
  holiday: "Seasonal or holiday content such as Christmas or Halloween",
  adult: "Adult or explicit content",
  none: "General or mixed content, a streaming brand, a country or language group, or nothing that indicates a specific genre",
};

async function ask(kind: string, name: string): Promise<JevLabel> {
  const response = await fetch(API, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "jev-latest",
      state: { content_type: kind, provider_category_name: name },
      questions: {
        genre: {
          type: "choice",
          instructions:
            "What is this IPTV provider category mainly about? Judge only from the category name; the content_type says whether it holds live channels, movies or series.",
          criteria: GENRE_CRITERIA,
        },
        junk: {
          type: "noul",
          instructions:
            "The category name carries no real information about its content: it is only a divider, decoration, or a quality/format badge.",
        },
      },
    }),
  });
  if (!response.ok) throw new Error(`TypeSafe request failed with HTTP ${response.status}`);
  const body = (await response.json()) as {
    answers: {
      genre: { choice: string; confidence: number };
      junk: { noul: number };
    };
  };
  return { genre: body.answers.genre.choice, genreConfidence: body.answers.genre.confidence, junk: body.answers.junk.noul };
}

const keyFor = (kind: string, name: string): string =>
  createHash("sha1").update(`${QUESTION_VERSION}|${kind}|${name}`).digest("hex");

async function pool<T>(items: readonly T[], worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) await worker(items[next++] as T);
    }),
  );
}

describe.skipIf(apiKey === undefined || namesFile === undefined)("classifyCategory vs TypeSafe/Jev", () => {
  it("reports where the rules and Jev disagree", { timeout: 15 * 60_000 }, async () => {
    const names = JSON.parse(readFileSync(namesFile as string, "utf8")) as Record<"live" | "movie" | "series", string[]>;
    const cache: Record<string, JevLabel> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};

    // Only names that pass the safety filter are ever transmitted; the rest are skipped and counted.
    const all = (["live", "movie", "series"] as const).flatMap((kind) => names[kind].map((name) => ({ kind, name })));
    const work = all.filter(({ name }) => isSafeToSend(name));
    if (work.length !== all.length) console.log(`skipped ${all.length - work.length} name(s) that did not pass isSafeToSend`);
    const missing = work.filter(({ kind, name }) => cache[keyFor(kind, name)] === undefined);
    await pool(missing, async ({ kind, name }) => {
      cache[keyFor(kind, name)] = await ask(kind, name);
    });
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));

    const rows = work.map(({ kind, name }) => {
      const jev = cache[keyFor(kind, name)] as JevLabel;
      const rule = classifyCategory(name);
      return { kind, name, rule: rule.genre ?? "none", ruleTags: rule.tags, jev: jev.genre, conf: jev.genreConfidence, junk: jev.junk };
    });

    const agree = rows.filter((row) => row.rule === row.jev);
    const disagree = rows.filter((row) => row.rule !== row.jev).sort((a, b) => b.conf - a.conf);
    const confidentMisses = disagree.filter((row) => row.conf >= 0.7);
    const junkMismatch = rows.filter((row) => (row.junk >= 0.7) !== row.ruleTags.some((tag) => tag === "junk" || tag === "separator"));

    const lines = [
      `categories: ${rows.length}   agree: ${agree.length} (${((agree.length / rows.length) * 100).toFixed(1)}%)   disagree: ${disagree.length}   Jev>=0.7 disagreements: ${confidentMisses.length}   junk mismatches: ${junkMismatch.length}`,
      "",
      "Disagreements, most confident Jev answer first (rule -> jev):",
      ...disagree.slice(0, 80).map((row) => `  [${row.kind}] ${row.name}   rule=${row.rule}  jev=${row.jev} (${row.conf.toFixed(2)})`),
      "",
      "Junk/separator disagreements:",
      ...junkMismatch.slice(0, 30).map((row) => `  [${row.kind}] ${row.name}   jev.junk=${row.junk.toFixed(2)} rule.tags=${row.ruleTags.join(",") || "-"}`),
    ];
    const reportFile = join(here, ".cache", "last-report.txt");
    writeFileSync(reportFile, lines.join("\n"));
    console.log(lines.join("\n"));
    console.log(`\n(report also written to ${reportFile})`);

    // WRITE_GOLDEN=1: freeze the cases where the rules and Jev independently agree with high
    // confidence as the offline regression fixture (src/__tests__/fixtures/categoryGolden.json).
    if (process.env["WRITE_GOLDEN"] === "1") {
      const perGenre = new Map<string, number>();
      const golden = agree
        .filter((row) => row.conf >= 0.9)
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter((row) => {
          const n = perGenre.get(row.rule) ?? 0;
          perGenre.set(row.rule, n + 1);
          return n < 14;
        })
        .map((row) => ({ name: row.name, kind: row.kind, genre: row.rule === "none" ? null : row.rule }));
      const goldenFile = join(here, "..", "src", "__tests__", "fixtures", "categoryGolden.json");
      mkdirSync(dirname(goldenFile), { recursive: true });
      writeFileSync(goldenFile, `${JSON.stringify(golden, null, 2)}\n`);
      console.log(`wrote ${golden.length} golden cases to ${goldenFile}`);
    }

    expect(GENRES.length).toBeGreaterThan(0); // the value of this run is the report, not an assertion
  });
});
