import type { Rectangle, WindowState } from "@heyagent/shared";
import type { AccessibleElement } from "../accessibility/types.js";
import type { DesktopSnapshot } from "../observer/types.js";

export interface WindowStateChange {
  windowId: string;
  type: "opened" | "closed" | "focused" | "moved" | "resized" | "state_changed";
  before?: WindowState;
  after?: WindowState;
}

export interface AccessibilityChange {
  elementId: string;
  type: "appeared" | "disappeared" | "changed";
}

export interface TextChange {
  before?: string;
  after?: string;
  bounds?: Rectangle;
}

export interface ExpectedStateChange {
  type: WindowStateChange["type"] | "text_appeared" | "element_appeared";
  value?: string;
}

export interface ScreenTransition {
  before: DesktopSnapshot;
  after: DesktopSnapshot;
  changedRegions: Rectangle[];
  windowChanges: WindowStateChange[];
  accessibilityChanges: AccessibilityChange[];
  extractedTextChanges: TextChange[];
  expectedChanges: ExpectedStateChange[];
  matchedExpectations: boolean;
  confidence: number;
}

export function compareDesktopSnapshots(
  before: DesktopSnapshot,
  after: DesktopSnapshot,
  options: {
    beforeElements?: AccessibleElement[];
    afterElements?: AccessibleElement[];
    beforeText?: string[];
    afterText?: string[];
    expectedChanges?: ExpectedStateChange[];
  } = {},
): ScreenTransition {
  const windowChanges = compareWindows(before.windows, after.windows);
  const accessibilityChanges = compareElements(
    options.beforeElements ?? [],
    options.afterElements ?? [],
  );
  const extractedTextChanges = compareText(options.beforeText ?? [], options.afterText ?? []);
  const expectedChanges = options.expectedChanges ?? [];
  const matched = expectedChanges.every((expected) =>
    matchesExpected(expected, windowChanges, accessibilityChanges, extractedTextChanges),
  );
  return {
    before,
    after,
    changedRegions: changedRegions(windowChanges),
    windowChanges,
    accessibilityChanges,
    extractedTextChanges,
    expectedChanges,
    matchedExpectations: matched,
    confidence: expectedChanges.length === 0 ? 0.5 : matched ? 0.95 : 0.2,
  };
}

function compareWindows(before: WindowState[], after: WindowState[]): WindowStateChange[] {
  const old = new Map(before.map((window) => [window.id, window]));
  const current = new Map(after.map((window) => [window.id, window]));
  const changes: WindowStateChange[] = [];
  for (const window of after) {
    const previous = old.get(window.id);
    if (!previous) changes.push({ windowId: window.id, type: "opened", after: window });
    else if (!previous.focused && window.focused) changes.push({ windowId: window.id, type: "focused", before: previous, after: window });
    else if (previous.bounds.x !== window.bounds.x || previous.bounds.y !== window.bounds.y) changes.push({ windowId: window.id, type: "moved", before: previous, after: window });
    else if (previous.bounds.width !== window.bounds.width || previous.bounds.height !== window.bounds.height) changes.push({ windowId: window.id, type: "resized", before: previous, after: window });
    else if (previous.displayState !== window.displayState) changes.push({ windowId: window.id, type: "state_changed", before: previous, after: window });
  }
  for (const window of before) if (!current.has(window.id)) changes.push({ windowId: window.id, type: "closed", before: window });
  return changes;
}

function compareElements(before: AccessibleElement[], after: AccessibleElement[]): AccessibilityChange[] {
  const old = new Map(before.map((element) => [element.id, element]));
  const current = new Map(after.map((element) => [element.id, element]));
  const changes: AccessibilityChange[] = [];
  for (const element of after) {
    const previous = old.get(element.id);
    if (!previous) changes.push({ elementId: element.id, type: "appeared" });
    else if (JSON.stringify(previous) !== JSON.stringify(element)) changes.push({ elementId: element.id, type: "changed" });
  }
  for (const element of before) if (!current.has(element.id)) changes.push({ elementId: element.id, type: "disappeared" });
  return changes;
}

function compareText(before: string[], after: string[]): TextChange[] {
  const old = new Set(before);
  const current = new Set(after);
  return [
    ...after.filter((text) => !old.has(text)).map((afterText) => ({ after: afterText })),
    ...before.filter((text) => !current.has(text)).map((beforeText) => ({ before: beforeText })),
  ];
}

function changedRegions(changes: WindowStateChange[]): Rectangle[] {
  return changes.flatMap((change) => [change.before?.bounds, change.after?.bounds])
    .filter((bounds): bounds is Rectangle => Boolean(bounds));
}

function matchesExpected(
  expected: ExpectedStateChange,
  windows: WindowStateChange[],
  elements: AccessibilityChange[],
  text: TextChange[],
): boolean {
  if (["opened", "closed", "focused", "moved", "resized", "state_changed"].includes(expected.type)) {
    return windows.some((change) =>
      change.type === expected.type &&
      (!expected.value || `${change.after?.title ?? ""} ${change.before?.title ?? ""}`.includes(expected.value)),
    );
  }
  if (expected.type === "element_appeared") {
    return elements.some((change) => change.type === "appeared" && (!expected.value || change.elementId.includes(expected.value)));
  }
  return text.some((change) => Boolean(change.after?.includes(expected.value ?? "")));
}
