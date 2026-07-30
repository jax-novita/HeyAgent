/**
 * Interactive HTML Reveal-style presentation + optional simple PPTX-less export as deck folder.
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { ensureDir } from "@heyagent/shared";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execAsync = promisify(exec);

export interface DeckSlide {
  title: string;
  bullets?: string[];
  notes?: string;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function buildRevealHtml(deckTitle: string, slides: DeckSlide[]): string {
  const sections = slides
    .map((s) => {
      const bullets = (s.bullets || [])
        .map((b) => `<li class="fragment fade-up">${escapeHtml(b)}</li>`)
        .join("\n");
      return `
      <section>
        <h2>${escapeHtml(s.title)}</h2>
        ${bullets ? `<ul>${bullets}</ul>` : ""}
        ${s.notes ? `<aside class="notes">${escapeHtml(s.notes)}</aside>` : ""}
      </section>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html lang="ru"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${escapeHtml(deckTitle)}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/theme/black.css"/>
<style>
  :root { --r-background-color: #0b1220; --r-main-font: "Segoe UI", system-ui, sans-serif; }
  .reveal h1, .reveal h2 { color: #5eead4; letter-spacing: -0.02em; }
  .reveal ul { font-size: .9em; }
  .reveal .progress { color: #14b8a6; }
</style>
</head>
<body>
<div class="reveal"><div class="slides">
  <section>
    <h1>${escapeHtml(deckTitle)}</h1>
    <p class="fragment">HeyAgent presentation</p>
  </section>
  ${sections}
</div></div>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
<script>
  Reveal.initialize({ hash: true, slideNumber: true, transition: "slide", backgroundTransition: "fade" });
</script>
</body></html>`;
}

export async function createPresentationDeck(opts: {
  title: string;
  slides: DeckSlide[];
  destDir?: string;
  open?: boolean;
}): Promise<{ dir: string; indexPath: string; message: string }> {
  const base =
    opts.destDir?.trim() ||
    join(homedir(), "Documents", "HeyAgent-Presentations");
  await ensureDir(base, { mkdir } as typeof import("node:fs/promises"));
  const slug =
    (opts.title || "deck")
      .replace(/[^\w\- а-яА-ЯёЁ]+/gi, "_")
      .trim()
      .slice(0, 48) || "deck";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const dir = join(base, `${slug}-${stamp}`);
  await mkdir(dir, { recursive: true });
  const indexPath = join(dir, "index.html");
  const html = buildRevealHtml(opts.title, opts.slides.length ? opts.slides : [{ title: opts.title, bullets: ["(empty)"] }]);
  await writeFile(indexPath, html, "utf-8");
  await writeFile(
    join(dir, "slides.json"),
    JSON.stringify({ title: opts.title, slides: opts.slides }, null, 2),
    "utf-8",
  );

  if (opts.open !== false) {
    try {
      const url = pathToFileURL(indexPath).href;
      if (process.platform === "win32") await execAsync(`start "" "${indexPath}"`);
      else if (process.platform === "darwin") await execAsync(`open "${indexPath}"`);
      else await execAsync(`xdg-open "${url}"`);
    } catch {
      /* ignore open errors */
    }
  }

  return {
    dir,
    indexPath,
    message: `Presentation deck written: ${indexPath} (Reveal.js — open in browser, arrows/space for animations)`,
  };
}
