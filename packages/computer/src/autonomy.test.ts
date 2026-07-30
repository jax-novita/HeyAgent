import { test } from "node:test";
import assert from "node:assert/strict";
import type { MonitorState, WindowState } from "@heyagent/shared";
import { monitorForRectangle, toMonitorPoint } from "./monitors.js";
import { DesktopObserver } from "./observer/desktop-observer.js";
import type { DesktopObserverBackend } from "./observer/types.js";
import { AccessibilityService } from "./accessibility/service.js";
import type { AccessibleElement, ElementSourceProvider } from "./accessibility/types.js";
import { compareDesktopSnapshots } from "./vision/screen-transition.js";

const monitors: MonitorState[] = [
  {
    id: "left",
    x: -1280,
    y: 0,
    width: 1280,
    height: 1024,
    scaleFactor: 1.25,
    dpi: 120,
    primary: false,
  },
  {
    id: "primary",
    x: 0,
    y: 0,
    width: 1920,
    height: 1080,
    scaleFactor: 1,
    dpi: 96,
    primary: true,
  },
  {
    id: "vertical",
    x: 1920,
    y: -500,
    width: 1080,
    height: 1920,
    scaleFactor: 1.5,
    dpi: 144,
    primary: false,
  },
];

test("monitor coordinates support negative X and DPI scaling", () => {
  const point = toMonitorPoint(monitors, -1000, 200);
  assert.equal(point.monitorId, "left");
  assert.deepEqual(point.local, { x: 280, y: 200 });
  assert.deepEqual(point.deviceLocal, { x: 350, y: 250 });
  assert.equal(point.scaleFactor, 1.25);
});

test("monitor selection supports a vertical monitor", () => {
  const point = toMonitorPoint(monitors, 2000, -300);
  assert.equal(point.monitorId, "vertical");
  assert.deepEqual(point.local, { x: 80, y: 200 });
});

test("window spanning monitors belongs to monitor with largest intersection", () => {
  const monitor = monitorForRectangle(monitors, { x: -200, y: 10, width: 500, height: 500 });
  assert.equal(monitor?.id, "primary");
});

test("desktop observer reports active window and waits for a new window", async () => {
  const first: WindowState = {
    id: "1",
    title: "Editor",
    bounds: { x: 10, y: 10, width: 500, height: 400 },
    displayState: "normal",
    focused: true,
    responding: true,
  };
  let calls = 0;
  const backend: DesktopObserverBackend = {
    getMonitorLayout: async () => monitors,
    listWindows: async () => {
      calls += 1;
      return calls < 3
        ? [first]
        : [
            { ...first, focused: false },
            { ...first, id: "2", title: "Confirmation", focused: true, modal: true },
          ];
    },
    getCursor: async () => ({ x: -1000, y: 100 }),
    getClipboardType: async () => "text",
  };
  const observer = new DesktopObserver(backend);
  assert.equal((await observer.getActiveWindow())?.title, "Editor");
  const modal = await observer.waitForWindow(
    { title: "Confirmation", modal: true },
    { timeoutMs: 200, pollIntervalMs: 1 },
  );
  assert.equal(modal.id, "2");
});

test("visual grounding prefers DOM/accessibility over OCR duplicates", async () => {
  const element = (source: AccessibleElement["source"], confidence: number): AccessibleElement => ({
    id: `${source}-save`,
    role: "Button",
    name: "Save",
    enabled: true,
    focused: false,
    visible: true,
    bounds: { x: 100, y: 50, width: 80, height: 30 },
    source,
    confidence,
  });
  const provider = (
    source: ElementSourceProvider["source"],
    value: AccessibleElement,
  ): ElementSourceProvider => ({
    source,
    findElements: async () => [value],
  });
  const service = new AccessibilityService([
    provider("ocr", element("ocr", 0.99)),
    provider("accessibility", element("accessibility", 0.8)),
    provider("dom", element("dom", 0.7)),
  ]);
  const matches = await service.findElements({ name: "Save" });
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.source, "dom");
});

test("screen transition verifies an opened modal and changed text", async () => {
  const backend: DesktopObserverBackend = {
    getMonitorLayout: async () => monitors,
    listWindows: async () => [],
  };
  const observer = new DesktopObserver(backend);
  const before = await observer.observeDesktop();
  const dialog: WindowState = {
    id: "dialog",
    title: "Success",
    bounds: { x: 100, y: 100, width: 300, height: 200 },
    displayState: "normal",
    focused: true,
    responding: true,
    modal: true,
  };
  const after = {
    ...before,
    windows: [dialog],
    desktop: { ...before.desktop, activeWindowId: dialog.id, modalWindowIds: [dialog.id] },
  };
  const transition = compareDesktopSnapshots(before, after, {
    beforeText: [],
    afterText: ["Saved successfully"],
    expectedChanges: [
      { type: "opened", value: "Success" },
      { type: "text_appeared", value: "Saved" },
    ],
  });
  assert.equal(transition.matchedExpectations, true);
  assert.equal(transition.windowChanges[0]?.type, "opened");
  assert.ok(transition.confidence > 0.9);
});
