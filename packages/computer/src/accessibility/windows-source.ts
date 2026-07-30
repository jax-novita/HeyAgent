import { generateId, type ToolExecutionResult } from "@heyagent/shared";
import { xplatMouseClick } from "../platform-input.js";
import { uiTree } from "../screen.js";
import type { AccessibleElement, ElementLocator, ElementSourceProvider } from "./types.js";

export class WindowsAccessibilitySource implements ElementSourceProvider {
  readonly source = "accessibility" as const;

  async findElements(locator: ElementLocator): Promise<AccessibleElement[]> {
    const raw = await uiTree(180);
    const windowTitle = raw.match(/^WINDOW:\s*(.+)$/m)?.[1]?.trim();
    return raw.split(/\r?\n/).flatMap((line, index) => {
      const match = line.match(/^([^|]+)\|\s*"([^"]*)"\s*\|\s*click=\((-?\d+),(-?\d+)\)\s*\|\s*bounds=\((-?\d+),(-?\d+),(\d+),(\d+)\)/);
      if (!match) return [];
      const role = match[1]!.trim().replace(/^ControlType\./, "");
      const name = match[2]!.trim();
      const element: AccessibleElement = {
        id: `uia-${index}-${match[5]}-${match[6]}`,
        role,
        name,
        enabled: true,
        focused: false,
        visible: Number(match[7]) > 0 && Number(match[8]) > 0,
        bounds: {
          x: Number(match[5]),
          y: Number(match[6]),
          width: Number(match[7]),
          height: Number(match[8]),
        },
        source: "accessibility",
        confidence: 0.9,
        windowId: windowTitle,
      };
      return matches(element, locator) ? [element] : [];
    });
  }

  async click(element: AccessibleElement): Promise<ToolExecutionResult> {
    const startedAt = new Date().toISOString();
    const x = Math.round(element.bounds.x + element.bounds.width / 2);
    const y = Math.round(element.bounds.y + element.bounds.height / 2);
    try {
      await xplatMouseClick(x, y);
      const finishedAt = new Date().toISOString();
      return {
        success: true,
        data: { x, y, elementId: element.id },
        evidence: [{
          id: generateId("evidence"),
          kind: "accessibility",
          summary: `Clicked ${element.role ?? "element"} ${element.name ?? ""} at ${x},${y}`,
          capturedAt: finishedAt,
        }],
        startedAt,
        finishedAt,
      };
    } catch (error) {
      const finishedAt = new Date().toISOString();
      return {
        success: false,
        error: {
          code: "ACCESSIBILITY_CLICK_FAILED",
          message: error instanceof Error ? error.message : String(error),
          retryable: true,
        },
        evidence: [],
        startedAt,
        finishedAt,
      };
    }
  }
}

function matches(element: AccessibleElement, locator: ElementLocator): boolean {
  const hay = `${element.name ?? ""} ${element.role ?? ""}`.toLowerCase();
  return [locator.name, locator.text, locator.role]
    .filter((value): value is string => Boolean(value))
    .every((value) => hay.includes(value.toLowerCase()));
}
