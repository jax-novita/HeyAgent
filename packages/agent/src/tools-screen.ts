import type { ToolRegistry } from "./tools.js";
import {
  captureScreenVision,
  formatVisionToolResult,
  screenBounds,
  screenOcr,
  uiTree,
  uiFind,
  mouseMove,
  mouseScroll,
  mouseDrag,
  mouseDoubleClick,
} from "@heyagent/computer";

export function registerScreenTools(registry: ToolRegistry): void {
  registry.register({
    name: "screen.see",
    description:
      "Capture the screen and ATTACH the image to your vision. ALWAYS call this before clicking UI you cannot see. Returns screenshot + coordinate system.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        maxWidth: { type: "number", description: "Downscale width for vision (default 1280)" },
      },
    },
    execute: async (args) => {
      const shot = await captureScreenVision(Number(args.maxWidth ?? 1280));
      return formatVisionToolResult(
        shot,
        "You can now SEE the screen image. Identify buttons/labels and click with computer_click using pixel coordinates (origin top-left).",
      );
    },
  });

  registry.register({
    name: "screen.bounds",
    description: "Primary screen bounds (x,y,width,height) for coordinate planning",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => screenBounds(),
  });

  registry.register({
    name: "screen.ocr",
    description: "OCR text from the current screen (Windows). Fallback: use screen.see",
    category: "computer",
    parameters: { type: "object", properties: {} },
    execute: async () => screenOcr(),
  });

  registry.register({
    name: "ui.tree",
    description:
      "Read accessibility UI tree of the focused window: control types, names, bounds, click centers. Prefer with screen.see.",
    category: "computer",
    parameters: {
      type: "object",
      properties: { maxElements: { type: "number" } },
    },
    execute: async (args) => uiTree(Number(args.maxElements ?? 80)),
  });

  registry.register({
    name: "ui.find",
    description: "Find UI elements by name substring; returns click coordinates",
    category: "computer",
    parameters: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    execute: async (args) => uiFind(String(args.name ?? "")),
  });

  registry.register({
    name: "computer.move",
    description: "Move mouse cursor to x,y without clicking",
    category: "computer",
    parameters: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
    execute: async (args) => mouseMove(Number(args.x ?? 0), Number(args.y ?? 0)),
  });

  registry.register({
    name: "computer.scroll",
    description: "Mouse wheel scroll. Positive=up, negative=down (e.g. -120)",
    category: "computer",
    parameters: {
      type: "object",
      properties: { delta: { type: "number" } },
      required: ["delta"],
    },
    execute: async (args) => mouseScroll(Number(args.delta ?? -120)),
  });

  registry.register({
    name: "computer.drag",
    description: "Click-drag from (x1,y1) to (x2,y2)",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        x1: { type: "number" },
        y1: { type: "number" },
        x2: { type: "number" },
        y2: { type: "number" },
      },
      required: ["x1", "y1", "x2", "y2"],
    },
    execute: async (args) =>
      mouseDrag(
        Number(args.x1 ?? 0),
        Number(args.y1 ?? 0),
        Number(args.x2 ?? 0),
        Number(args.y2 ?? 0),
      ),
  });

  registry.register({
    name: "computer.double_click",
    description: "Double-click at x,y",
    category: "computer",
    parameters: {
      type: "object",
      properties: { x: { type: "number" }, y: { type: "number" } },
      required: ["x", "y"],
    },
    execute: async (args) =>
      mouseDoubleClick(Number(args.x ?? 0), Number(args.y ?? 0)),
  });

  registry.register({
    name: "tts.speak",
    description:
      "Speak status aloud (SAPI on Windows, say on macOS, espeak-ng on Linux). Use for short progress updates.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string" },
        lang: { type: "string", description: "e.g. ru or en" },
      },
      required: ["text"],
    },
    execute: async (args) => {
      const { speak } = await import("@heyagent/computer");
      return speak(String(args.text ?? ""), { lang: String(args.lang ?? "ru") });
    },
  });

  registry.register({
    name: "desktop.see_and_click",
    description:
      "REMOTE-DESKTOP style: capture the screen (vision), decide where to click for the given instruction, move the mouse and click. Use when UI is visual (icons, images, unlabeled buttons) or CDP text click is not enough. Set focusBrowser=true for browser tasks so the terminal does not cover the page.",
    category: "computer",
    parameters: {
      type: "object",
      properties: {
        instruction: {
          type: "string",
          description: "What to click, e.g. «замкнутая ломаная — треугольник» or «кнопка Далее»",
        },
        focusBrowser: { type: "boolean" },
        browser: { type: "string" },
      },
      required: ["instruction"],
    },
    execute: async (args) => {
      const { loadConfig } = await import("@heyagent/shared");
      const { resolveDefaultModel } = await import("@heyagent/models");
      const config = await loadConfig();
      const modelRef = resolveDefaultModel(config.models ?? {});
      const { desktopSeeAndClick } = await import("./harness/vision-desk.js");
      const raw = String(args.browser ?? "auto").toLowerCase();
      const preferredBrowser =
        raw === "yandex" || raw === "chrome" || raw === "edge" ? raw : "auto";
      return desktopSeeAndClick({
        modelRef,
        instruction: String(args.instruction ?? ""),
        focusBrowser: args.focusBrowser !== false,
        preferredBrowser,
      });
    },
  });
}
