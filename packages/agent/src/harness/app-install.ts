/**
 * Install a desktop app via winget/choco/scoop (not notepad.compose theatre).
 */
import { applicationInstall, applicationSearch } from "@heyagent/computer";

const STOP =
  /\b(скача(й|ть)|загруз(и|ить)|download|установ(и|ить)|install|мне|нам|пожалуйста|программу|программа|программы|приложен\w*|soft\w*|app|через|winget|с\s+официального\s+сайта)\b/gi;

/** Extract package query from «скачай программу notepad++». */
export function extractAppPackage(text: string): string {
  let q = text
    .replace(STOP, " ")
    .replace(/[«»"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Prefer known tokens that survive stripping poorly
  const known = text.match(
    /\b(notepad\+\+|visual\s*studio\s*code|vs\s*code|vscode|google\s*chrome|chrome|firefox|discord|7-?zip|obs(?:\s*studio)?|steam|git|nodejs|node\.js)\b/i,
  );
  if (known?.[1]) q = known[1].replace(/\s+/g, " ").trim();
  if (q.length < 2) q = text.trim().slice(0, 80);
  return q.slice(0, 120);
}

function pickWingetId(searchOut: string, query: string): string | null {
  const lines = searchOut.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const q = query.toLowerCase().replace(/\s+/g, "");
  for (const line of lines) {
    // winget: Name  Id  Version  Source
    const parts = line.split(/\s{2,}|\t+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 2) continue;
    const id = parts.find((p) => p.includes(".")) || parts[1];
    const name = parts[0] || "";
    if (!id || /^-{2,}|name|id|version|source/i.test(id)) continue;
    const blob = `${name} ${id}`.toLowerCase().replace(/\s+/g, "");
    if (blob.includes(q) || q.includes(name.toLowerCase().replace(/\s+/g, ""))) {
      return id;
    }
  }
  return null;
}

export async function runAppInstall(opts: {
  userText: string;
  onStatus?: (s: "working" | "thinking" | "done" | "idle", d?: string) => void;
}): Promise<{ summary: string; packageQuery: string }> {
  const packageQuery = extractAppPackage(opts.userText);
  opts.onStatus?.("working", "app.install.search");
  let id: string | null = null;
  try {
    const search = await applicationSearch(packageQuery);
    if (/ERROR:/i.test(search)) {
      return { packageQuery, summary: search };
    }
    id = pickWingetId(search, packageQuery);
  } catch (err) {
    return {
      packageQuery,
      summary: `ERROR: поиск пакета: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const target = id || packageQuery;
  opts.onStatus?.("working", "app.install");
  const result = await applicationInstall(target, Boolean(id));
  if (/ERROR:/i.test(result)) {
    return {
      packageQuery,
      summary: [
        `ERROR: не удалось установить «${packageQuery}» (target: ${target}).`,
        result,
        "Проверь winget/choco/scoop и права. Можно повторить с точным ID пакета.",
      ].join("\n"),
    };
  }
  return {
    packageQuery,
    summary: [`DONE: программа «${packageQuery}» установлена.`, `target: ${target}`, result].join("\n"),
  };
}
