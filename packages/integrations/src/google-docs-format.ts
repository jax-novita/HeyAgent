export interface GoogleDocsFormattedContent {
  plainText: string;
  requests: Record<string, unknown>[];
}

interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}

interface StyleRun {
  startIndex: number;
  endIndex: number;
  style: TextStyle;
}

interface ParsedInline {
  text: string;
  runs: StyleRun[];
}

function styleKey(style: TextStyle): string {
  return `${style.bold ? "b" : ""}${style.italic ? "i" : ""}${style.underline ? "u" : ""}`;
}

function parseInlineMarkup(source: string, absoluteStart: number): ParsedInline {
  source = normalizeWorkspaceMath(source);
  let text = "";
  let index = 0;
  const active: TextStyle = {};
  const runs: StyleRun[] = [];

  const append = (value: string) => {
    if (!value) return;
    const startIndex = absoluteStart + text.length;
    text += value;
    const endIndex = absoluteStart + text.length;
    if (!styleKey(active)) return;
    const previous = runs.at(-1);
    if (
      previous &&
      previous.endIndex === startIndex &&
      styleKey(previous.style) === styleKey(active)
    ) {
      previous.endIndex = endIndex;
      return;
    }
    runs.push({ startIndex, endIndex, style: { ...active } });
  };

  while (index < source.length) {
    if (source.startsWith("\\*", index)) {
      append("*");
      index += 2;
    } else if (source.startsWith("***", index)) {
      if (active.bold) delete active.bold;
      else active.bold = true;
      if (active.italic) delete active.italic;
      else active.italic = true;
      index += 3;
    } else if (source.startsWith("**", index)) {
      if (active.bold) delete active.bold;
      else active.bold = true;
      index += 2;
    } else if (source.startsWith("<u>", index)) {
      active.underline = true;
      index += 3;
    } else if (source.startsWith("</u>", index)) {
      delete active.underline;
      index += 4;
    } else if (source[index] === "*") {
      if (active.italic) delete active.italic;
      else active.italic = true;
      index += 1;
    } else {
      append(source[index]!);
      index += 1;
    }
  }

  return { text, runs };
}

/**
 * Convert the small, controlled markup emitted by docs.compose into native
 * Google Docs batchUpdate requests. Markdown markers never reach the document.
 */
export function buildGoogleDocsFormatting(content: string): GoogleDocsFormattedContent {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  let plainText = "";
  let seenTextParagraph = false;
  const inlineRuns: StyleRun[] = [];
  const paragraphRequests: Record<string, unknown>[] = [];
  const bulletRequests: Record<string, unknown>[] = [];

  for (const originalLine of lines) {
    let line = originalLine.trimEnd();
    if (/^\s*---+\s*$/u.test(line)) line = "";
    let headingLevel = 0;
    let bullet: "unordered" | "ordered" | null = null;

    const markdownHeading = line.match(/^(#{1,3})\s+(.+)$/u);
    if (markdownHeading) {
      headingLevel = markdownHeading[1]!.length;
      line = markdownHeading[2]!;
    } else {
      const boldOnlyHeading = line.match(/^\s*\*\*(.+)\*\*\s*$/u);
      if (boldOnlyHeading && boldOnlyHeading[1]!.length <= 120) {
        headingLevel = seenTextParagraph ? 2 : 1;
        line = boldOnlyHeading[1]!;
      }
    }

    const unordered = line.match(/^\s*[-•]\s+(.+)$/u);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/u);
    if (!headingLevel && unordered) {
      bullet = "unordered";
      line = unordered[1]!;
    } else if (!headingLevel && ordered) {
      bullet = "ordered";
      line = ordered[1]!;
    }

    const startIndex = 1 + plainText.length;
    const parsed = parseInlineMarkup(line, startIndex);
    plainText += `${parsed.text}\n`;
    inlineRuns.push(...parsed.runs);
    const endIndex = 1 + plainText.length;

    if (parsed.text.trim()) {
      seenTextParagraph = true;
      if (headingLevel) {
        const namedStyleType =
          headingLevel === 1 ? "TITLE" : headingLevel === 2 ? "HEADING_1" : "HEADING_2";
        paragraphRequests.push({
          updateParagraphStyle: {
            range: { startIndex, endIndex },
            paragraphStyle: {
              namedStyleType,
              alignment: headingLevel === 1 ? "CENTER" : "START",
              spaceAbove: { magnitude: headingLevel === 1 ? 0 : 12, unit: "PT" },
              spaceBelow: { magnitude: headingLevel === 1 ? 16 : 6, unit: "PT" },
            },
            fields: "namedStyleType,alignment,spaceAbove,spaceBelow",
          },
        });
      } else {
        paragraphRequests.push({
          updateParagraphStyle: {
            range: { startIndex, endIndex },
            paragraphStyle: {
              alignment: "JUSTIFIED",
              lineSpacing: 115,
              spaceBelow: { magnitude: 6, unit: "PT" },
            },
            fields: "alignment,lineSpacing,spaceBelow",
          },
        });
      }
    }

    if (bullet) {
      bulletRequests.push({
        createParagraphBullets: {
          range: { startIndex, endIndex },
          bulletPreset:
            bullet === "ordered" ? "NUMBERED_DECIMAL_NESTED" : "BULLET_DISC_CIRCLE_SQUARE",
        },
      });
    }
  }

  const requests: Record<string, unknown>[] = [
    {
      insertText: {
        location: { index: 1 },
        text: plainText,
      },
    },
  ];

  if (plainText.length) {
    requests.push({
      updateTextStyle: {
        range: { startIndex: 1, endIndex: 1 + plainText.length },
        textStyle: {
          weightedFontFamily: { fontFamily: "Arial" },
          fontSize: { magnitude: 11, unit: "PT" },
        },
        fields: "weightedFontFamily,fontSize",
      },
    });
  }

  requests.push(...paragraphRequests, ...bulletRequests);
  for (const run of inlineRuns) {
    requests.push({
      updateTextStyle: {
        range: { startIndex: run.startIndex, endIndex: run.endIndex },
        textStyle: run.style,
        fields: Object.keys(run.style).join(","),
      },
    });
  }

  return { plainText, requests };
}
import { normalizeWorkspaceMath } from "./workspace-text.js";
