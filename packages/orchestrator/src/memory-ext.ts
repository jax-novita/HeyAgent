import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getHeyAgentHome, ensureDir, generateId } from "@heyagent/shared";
import type { Domain, EpisodicEntry, PersonMemory } from "./types.js";

interface ExtendedStore {
  people: PersonMemory[];
  episodic: EpisodicEntry[];
  /** Tiny local "RAG": bag-of-words chunks from notes/actions. */
  chunks: { id: string; text: string; source: string; at: string }[];
}

const DEFAULT: ExtendedStore = { people: [], episodic: [], chunks: [] };

function path(): string {
  return join(getHeyAgentHome(), "memory-ext.json");
}

async function load(): Promise<ExtendedStore> {
  const p = path();
  if (!existsSync(p)) return structuredClone(DEFAULT);
  try {
    return { ...structuredClone(DEFAULT), ...(JSON.parse(await readFile(p, "utf-8")) as ExtendedStore) };
  } catch {
    return structuredClone(DEFAULT);
  }
}

async function save(store: ExtendedStore): Promise<void> {
  await ensureDir(getHeyAgentHome(), { mkdir } as typeof import("node:fs/promises"));
  await writeFile(path(), JSON.stringify(store, null, 2), "utf-8");
}

export async function rememberPerson(person: Omit<PersonMemory, "updatedAt"> & { updatedAt?: string }): Promise<void> {
  const store = await load();
  const key = person.name.trim().toLowerCase();
  const existing = store.people.find((p) => p.name.toLowerCase() === key);
  const next: PersonMemory = {
    ...person,
    name: person.name.trim(),
    aliases: person.aliases ?? [],
    updatedAt: new Date().toISOString(),
  };
  if (existing) Object.assign(existing, next);
  else store.people.push(next);
  store.people = store.people.slice(-80);
  await save(store);
}

export async function findPerson(query: string): Promise<PersonMemory | null> {
  const store = await load();
  const q = query.trim().toLowerCase();
  if (!q) return null;
  return (
    store.people.find(
      (p) =>
        p.name.toLowerCase() === q ||
        p.name.toLowerCase().startsWith(q) ||
        p.aliases.some((a) => a.toLowerCase() === q) ||
        (p.handle && p.handle.toLowerCase().includes(q)),
    ) ?? null
  );
}

export async function recordEpisode(input: {
  goal: string;
  domain: Domain;
  tried: string;
  outcome: "success" | "fail";
  lesson: string;
}): Promise<void> {
  const store = await load();
  store.episodic.push({
    id: generateId("ep"),
    at: new Date().toISOString(),
    ...input,
  });
  store.episodic = store.episodic.slice(-200);
  // also index as a RAG chunk
  store.chunks.push({
    id: generateId("chunk"),
    text: `${input.goal} | ${input.tried} | ${input.outcome} | ${input.lesson}`,
    source: "episodic",
    at: new Date().toISOString(),
  });
  store.chunks = store.chunks.slice(-500);
  await save(store);
}

export async function indexNote(text: string, source = "note"): Promise<void> {
  const store = await load();
  store.chunks.push({
    id: generateId("chunk"),
    text: text.slice(0, 2000),
    source,
    at: new Date().toISOString(),
  });
  store.chunks = store.chunks.slice(-500);
  await save(store);
}

/** Local TF-IDF "embeddings" — no native deps, works offline on all OSes. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
}

function tfidfVector(
  tokens: string[],
  df: Map<string, number>,
  nDocs: number,
): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) tf.set(t, (tf.get(t) ?? 0) + 1);
  const len = tokens.length || 1;
  const vec = new Map<string, number>();
  for (const [t, c] of tf) {
    const idf = Math.log((nDocs + 1) / ((df.get(t) ?? 0) + 1)) + 1;
    vec.set(t, (c / len) * idf);
  }
  return vec;
}

function cosine(a: Map<string, number>, b: Map<string, number>): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (const [, v] of a) na += v * v;
  for (const [, v] of b) nb += v * v;
  for (const [k, v] of a) {
    const w = b.get(k);
    if (w) dot += v * w;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Semantic-ish local RAG via TF-IDF cosine similarity (plus keyword boost). */
export async function ragSearch(
  query: string,
  limit = 5,
): Promise<{ text: string; source: string; score: number }[]> {
  const store = await load();
  if (!store.chunks.length) return [];
  const qTokens = tokenize(query);
  if (!qTokens.length) return [];

  const df = new Map<string, number>();
  const docs = store.chunks.map((c) => tokenize(c.text));
  for (const toks of docs) {
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const n = docs.length;
  const qVec = tfidfVector(qTokens, df, n);
  const scored = store.chunks.map((c, i) => {
    const dVec = tfidfVector(docs[i]!, df, n);
    let score = cosine(qVec, dVec);
    // keyword boost
    const hay = c.text.toLowerCase();
    for (const t of qTokens) if (hay.includes(t)) score += 0.05;
    return { text: c.text, source: c.source, score };
  });
  return scored
    .filter((s) => s.score > 0.02)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function recentLessons(limit = 8): Promise<EpisodicEntry[]> {
  const store = await load();
  return store.episodic.slice(-limit).reverse();
}

export async function memoryContextBlock(query: string): Promise<string> {
  const [lessons, hits, people] = await Promise.all([
    recentLessons(5),
    ragSearch(query, 4),
    load().then((s) => s.people.slice(-10)),
  ]);
  const lines: string[] = ["### Orchestrator memory"];
  if (people.length) {
    lines.push("People:");
    for (const p of people) {
      lines.push(
        `- ${p.name}${p.handle ? ` (${p.handle})` : ""}${p.tone ? ` tone=${p.tone}` : ""}${p.notes ? ` — ${p.notes}` : ""}`,
      );
    }
  }
  if (lessons.length) {
    lines.push("Recent lessons (do not repeat failures):");
    for (const e of lessons) {
      lines.push(`- [${e.outcome}] ${e.lesson} (tried: ${e.tried.slice(0, 80)})`);
    }
  }
  if (hits.length) {
    lines.push("RAG hits (prefer related tools / avoid past failures):");
    for (const h of hits) lines.push(`- (${h.source}, score=${h.score.toFixed(2)}) ${h.text.slice(0, 160)}`);
  }
  return lines.join("\n");
}
