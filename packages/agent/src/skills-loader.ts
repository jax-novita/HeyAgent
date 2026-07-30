import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getHeyAgentHome } from "@heyagent/shared";

export interface SkillMeta {
  name: string;
  description: string;
  body: string;
}

function candidateSkillRoots(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  // packages/agent/dist → repo/skills ; also ~/.heyagent/skills
  return [
    join(here, "..", "..", "..", "skills"),
    join(getHeyAgentHome(), "skills"),
    join(process.cwd(), "skills"),
  ];
}

export async function loadSkills(): Promise<SkillMeta[]> {
  const skills: SkillMeta[] = [];
  const seen = new Set<string>();

  for (const root of candidateSkillRoots()) {
    if (!existsSync(root)) continue;
    let dirs: string[] = [];
    try {
      dirs = await readdir(root);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const skillFile = join(root, d, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      try {
        const raw = await readFile(skillFile, "utf-8");
        const name =
          raw.match(/^name:\s*(.+)$/m)?.[1]?.trim() ||
          raw.match(/^---\s*\nname:\s*(.+)$/m)?.[1]?.trim() ||
          d;
        if (seen.has(name)) continue;
        seen.add(name);
        const description =
          raw.match(/^description:\s*(.+)$/m)?.[1]?.trim() ||
          "HeyAgent skill";
        const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
        skills.push({ name, description, body: body.slice(0, 2400) });
      } catch {
        /* skip */
      }
    }
  }
  return skills;
}

/** Pick skills relevant to the user text; always keep autonomous-execution. */
export function selectRelevantSkills(skills: SkillMeta[], userText: string, limit = 6): SkillMeta[] {
  const q = userText.toLowerCase().replace(/ё/g, "е");
  const scored = skills.map((s) => {
    const hay = `${s.name} ${s.description} ${s.body}`.toLowerCase();
    let score = 0;
    if (s.name === "autonomous-execution") score += 50;
    for (const tok of q.split(/[^a-zа-я0-9]+/i).filter((t) => t.length >= 4)) {
      if (hay.includes(tok)) score += 3;
    }
    // Domain boosts
    if (/ютуб|youtube|видос|видео/.test(q) && /youtube/.test(hay)) score += 20;
    if (/телеграм|telegram|напиши|ответь/.test(q) && /telegram/.test(hay)) score += 20;
    if (/браузер|тест|вкладк|quiz/.test(q) && /browser|quiz|vision/.test(hay)) score += 20;
    if (/блокнот|рассказ|стих|notepad|файл/.test(q) && /notepad|file/.test(hay)) score += 15;
    if (/почт|gmail|письмо/.test(q) && /gmail|mail|gog/.test(hay)) score += 15;
    return { s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.filter((x) => x.score > 0).slice(0, limit).map((x) => x.s);
  if (!picked.find((s) => s.name === "autonomous-execution")) {
    const auto = skills.find((s) => s.name === "autonomous-execution");
    if (auto) picked.unshift(auto);
  }
  return picked.length ? picked : skills.slice(0, Math.min(4, skills.length));
}

export async function buildSkillsPromptBlock(userText = ""): Promise<string> {
  const all = await loadSkills();
  if (!all.length) return "";
  const skills = userText ? selectRelevantSkills(all, userText) : all.slice(0, 8);
  const lines = [
    "## Skills (relevant playbooks — follow when they match)",
    ...skills.map(
      (s) => `### skill:${s.name}\n${s.description}\n${s.body.slice(0, 1400)}`,
    ),
  ];
  return lines.join("\n\n");
}
