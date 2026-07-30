/**
 * Desktop Office harness helpers — Word / Excel / PowerPoint / WordPad (Windows-first COM).
 */
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureDir } from "@heyagent/shared";

const execFileAsync = promisify(execFile);

export type OfficeApp = "word" | "excel" | "powerpoint" | "wordpad";

export function detectOfficeApp(text: string): OfficeApp | null {
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (/(wordpad|вордпад)/i.test(t)) return "wordpad";
  if (/(power\s*point|powerpoint|пауерпоинт|пауэрпоинт|\.pptx)/i.test(t)) return "powerpoint";
  if (/(excel|эксель|\.xlsx|таблиц\w*\s+excel)/i.test(t)) return "excel";
  if (/(ms\s*word|\bword\b|ворд|\.docx)/i.test(t) && !/google/i.test(t)) return "word";
  return null;
}

async function runPs(script: string): Promise<string> {
  const dir = join(tmpdir(), "heyagent-office");
  await mkdir(dir, { recursive: true });
  const f = join(dir, `office-${Date.now()}.ps1`);
  await writeFile(f, script, "utf-8");
  const { stdout, stderr } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", f],
    { timeout: 120_000, windowsHide: true },
  );
  return [stdout, stderr].filter(Boolean).join("\n").trim();
}

function saveDir(): string {
  return join(homedir(), "Documents", "HeyAgent-Office");
}

export async function officeWriteDocument(opts: {
  app: OfficeApp;
  title: string;
  content: string;
}): Promise<string> {
  const dir = saveDir();
  await ensureDir(dir, { mkdir } as typeof import("node:fs/promises"));
  const safe = (opts.title || "doc").replace(/[^\w\- а-яА-ЯёЁ]+/gi, "_").slice(0, 48) || "doc";
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");

  if (process.platform !== "win32") {
    const path = join(dir, `${safe}-${stamp}.txt`);
    await writeFile(path, `# ${opts.title}\n\n${opts.content}`, "utf-8");
    return `Office COM unavailable on this OS; wrote text: ${path}`;
  }

  if (opts.app === "wordpad") {
    const path = join(dir, `${safe}-${stamp}.rtf`);
    const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Segoe UI;}}\\f0\\fs24 ${opts.title.replace(/\\/g, "\\\\")}\\par\\par ${opts.content.replace(/\n/g, "\\par ").replace(/\\/g, "\\\\")}}`;
    await writeFile(path, rtf, "utf-8");
    try {
      await execFileAsync("cmd.exe", ["/c", "start", "", "wordpad", path], { windowsHide: true });
    } catch {
      /* ignore */
    }
    return `WordPad document saved: ${path}`;
  }

  if (opts.app === "word") {
    const path = join(dir, `${safe}-${stamp}.docx`);
    const contentLit = opts.content.replace(/'/g, "''");
    const titleLit = opts.title.replace(/'/g, "''");
    const pathLit = path.replace(/'/g, "''");
    const out = await runPs(`
$ErrorActionPreference = 'Stop'
$word = New-Object -ComObject Word.Application
$word.Visible = $true
$doc = $word.Documents.Add()
$sel = $word.Selection
$sel.TypeText('${titleLit}')
$sel.TypeParagraph()
$sel.TypeParagraph()
$sel.TypeText(@'
${contentLit}
'@)
$doc.SaveAs([ref]'${pathLit}')
Write-Output "OK:${pathLit}"
`);
    return out.includes("OK:") ? `Word document saved: ${path}` : `Word result: ${out || path}`;
  }

  if (opts.app === "excel") {
    const path = join(dir, `${safe}-${stamp}.xlsx`);
    const lines = opts.content.split(/\r?\n/).filter(Boolean).slice(0, 200);
    const cells = lines
      .map((line, i) => {
        const cols = line.split(/\t|;|\|/g).map((c) => c.trim());
        return cols
          .map((c, j) => `$ws.Cells.Item(${i + 1},${j + 1}) = '${c.replace(/'/g, "''")}'`)
          .join("\n");
      })
      .join("\n");
    const pathLit = path.replace(/'/g, "''");
    const out = await runPs(`
$ErrorActionPreference = 'Stop'
$xl = New-Object -ComObject Excel.Application
$xl.Visible = $true
$wb = $xl.Workbooks.Add()
$ws = $wb.Worksheets.Item(1)
$ws.Cells.Item(1,1) = '${opts.title.replace(/'/g, "''")}'
${cells}
$wb.SaveAs('${pathLit}')
Write-Output "OK:${pathLit}"
`);
    return out.includes("OK:") ? `Excel workbook saved: ${path}` : `Excel result: ${out || path}`;
  }

  // powerpoint
  const path = join(dir, `${safe}-${stamp}.pptx`);
  const bullets = opts.content
    .split(/\r?\n/)
    .map((l) => l.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 12);
  const bulletPs = bullets
    .map((b, i) => `$tf.TextFrame.TextRange.Paragraphs(${i + 1}).Text = '${b.replace(/'/g, "''")}'`)
    .join("\n");
  const pathLit = path.replace(/'/g, "''");
  const out = await runPs(`
$ErrorActionPreference = 'Stop'
$ppt = New-Object -ComObject PowerPoint.Application
$ppt.Visible = [Microsoft.Office.Core.MsoTriState]::msoTrue
$pres = $ppt.Presentations.Add()
$slide1 = $pres.Slides.Add(1, 1)
$slide1.Shapes.Title.TextFrame.TextRange.Text = '${opts.title.replace(/'/g, "''")}'
$slide2 = $pres.Slides.Add(2, 2)
$tf = $slide2.Shapes.Item(2)
${bulletPs || "$tf.TextFrame.TextRange.Text = 'Content'"}
$pres.SaveAs('${pathLit}')
Write-Output "OK:${pathLit}"
`);
  return out.includes("OK:") ? `PowerPoint saved: ${path}` : `PowerPoint result: ${out || path}`;
}
