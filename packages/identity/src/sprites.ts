import type { AvatarId } from "./types.js";
import { AVATAR_CATALOG } from "./types.js";

/** 8x8 pixel grid: 0 = transparent, 1 = main, 2 = dark, 3 = light/eye, 4 = accent */
export type Pixel = 0 | 1 | 2 | 3 | 4;
export type SpriteGrid = readonly (readonly Pixel[])[];

const BOT: SpriteGrid = [
  [0, 1, 1, 1, 1, 1, 1, 0],
  [1, 1, 3, 1, 1, 3, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 2, 2, 2, 2, 2, 2, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 1, 0, 1, 1, 0, 1, 0],
  [0, 1, 0, 1, 1, 0, 1, 0],
  [0, 2, 0, 0, 0, 0, 2, 0],
];

const SCOUT: SpriteGrid = [
  [0, 0, 4, 4, 4, 4, 0, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [1, 3, 1, 1, 1, 1, 3, 1],
  [1, 1, 1, 2, 2, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 0, 0, 0, 0, 1, 0],
  [0, 2, 0, 0, 0, 0, 2, 0],
];

const PILOT: SpriteGrid = [
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 4, 4, 4, 4, 1, 0],
  [1, 3, 1, 1, 1, 1, 3, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 2, 2, 2, 2, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 1, 0, 0, 1, 1, 0],
  [2, 2, 0, 0, 0, 0, 2, 2],
];

const RANGER: SpriteGrid = [
  [0, 4, 0, 1, 1, 0, 4, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 3, 1, 1, 3, 1, 0],
  [1, 1, 1, 2, 2, 1, 1, 1],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 0, 0, 0, 0, 1, 0],
  [0, 4, 0, 0, 0, 0, 4, 0],
];

const SAGE: SpriteGrid = [
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [1, 3, 4, 1, 1, 4, 3, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 2, 1, 1, 2, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 0, 1, 0, 0, 1, 0, 0],
  [0, 0, 2, 0, 0, 2, 0, 0],
];

const SPARK: SpriteGrid = [
  [0, 0, 0, 4, 4, 0, 0, 0],
  [0, 4, 1, 1, 1, 1, 4, 0],
  [0, 1, 3, 1, 1, 3, 1, 0],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [0, 1, 1, 2, 2, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 0, 0, 0, 0, 1, 0],
  [4, 0, 0, 0, 0, 0, 0, 4],
];

const GHOST: SpriteGrid = [
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [1, 3, 1, 1, 1, 1, 3, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [1, 1, 0, 1, 1, 0, 1, 1],
  [1, 0, 0, 1, 1, 0, 0, 1],
  [1, 0, 0, 0, 0, 0, 0, 1],
];

const KNIGHT: SpriteGrid = [
  [0, 2, 2, 2, 2, 2, 2, 0],
  [2, 1, 1, 1, 1, 1, 1, 2],
  [1, 3, 1, 1, 1, 1, 3, 1],
  [1, 1, 1, 4, 4, 1, 1, 1],
  [2, 1, 1, 1, 1, 1, 1, 2],
  [0, 2, 1, 1, 1, 1, 2, 0],
  [0, 1, 0, 0, 0, 0, 1, 0],
  [0, 2, 0, 0, 0, 0, 2, 0],
];

const WISP: SpriteGrid = [
  [0, 0, 0, 4, 0, 0, 0, 0],
  [0, 0, 1, 1, 1, 0, 0, 0],
  [0, 1, 3, 1, 3, 1, 0, 0],
  [0, 1, 1, 1, 1, 1, 0, 0],
  [0, 0, 1, 4, 1, 0, 0, 0],
  [0, 0, 0, 1, 0, 0, 4, 0],
  [0, 4, 0, 1, 0, 0, 0, 0],
  [0, 0, 0, 2, 0, 0, 0, 0],
];

const CORE: SpriteGrid = [
  [0, 2, 1, 1, 1, 1, 2, 0],
  [2, 1, 1, 1, 1, 1, 1, 2],
  [1, 3, 2, 1, 1, 2, 3, 1],
  [1, 1, 1, 4, 4, 1, 1, 1],
  [1, 1, 1, 1, 1, 1, 1, 1],
  [2, 1, 1, 1, 1, 1, 1, 2],
  [0, 2, 1, 0, 0, 1, 2, 0],
  [0, 0, 2, 0, 0, 2, 0, 0],
];

const SUNRISE: SpriteGrid = [
  [0, 4, 0, 4, 4, 0, 4, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [4, 1, 3, 1, 1, 3, 1, 4],
  [0, 1, 1, 1, 1, 1, 1, 0],
  [0, 0, 1, 2, 2, 1, 0, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 0, 0, 0, 0, 1, 0],
  [0, 2, 0, 0, 0, 0, 2, 0],
];

const OWL: SpriteGrid = [
  [0, 2, 0, 0, 0, 0, 2, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 1, 3, 1, 1, 3, 1, 0],
  [1, 1, 4, 1, 1, 4, 1, 1],
  [0, 1, 1, 2, 2, 1, 1, 0],
  [0, 0, 1, 1, 1, 1, 0, 0],
  [0, 0, 1, 0, 0, 1, 0, 0],
  [0, 0, 2, 0, 0, 2, 0, 0],
];

export const AVATAR_SPRITES: Record<AvatarId, SpriteGrid> = {
  "sprite-01": BOT,
  "sprite-02": SCOUT,
  "sprite-03": PILOT,
  "sprite-04": RANGER,
  "sprite-05": SAGE,
  "sprite-06": SPARK,
  "sprite-07": GHOST,
  "sprite-08": KNIGHT,
  "sprite-09": WISP,
  "sprite-10": CORE,
  "sprite-11": SUNRISE,
  "sprite-12": OWL,
};

/** Enable ANSI colors in Windows console (same process). */
export function enableTerminalColor(): void {
  if (process.platform !== "win32") return;
  process.env.FORCE_COLOR = process.env.FORCE_COLOR ?? "3";
  try {
    // Soft VT enable probe — if unsupported, ASCII fallback still works
    process.stdout.write("\x1b[0m");
  } catch {
    /* ignore */
  }
}

function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR && process.env.FORCE_COLOR !== "0") return true;
  return Boolean(process.stdout.isTTY);
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function shade(
  rgb: { r: number; g: number; b: number },
  factor: number,
): { r: number; g: number; b: number } {
  return {
    r: Math.max(0, Math.min(255, Math.round(rgb.r * factor))),
    g: Math.max(0, Math.min(255, Math.round(rgb.g * factor))),
    b: Math.max(0, Math.min(255, Math.round(rgb.b * factor))),
  };
}

const ASCII_CHARS: Record<Pixel, string> = {
  0: "  ",
  1: "██",
  2: "▓▓",
  3: "░░",
  4: "▒▒",
};

function cellAnsi(pixel: Pixel, mainHex: string): string {
  if (pixel === 0) return "  ";
  if (!supportsColor()) return ASCII_CHARS[pixel];
  const main = hexToRgb(mainHex);
  const map: Record<1 | 2 | 3 | 4, { r: number; g: number; b: number }> = {
    1: main,
    2: shade(main, 0.45),
    3: { r: 240, g: 240, b: 245 },
    4: shade(main, 1.35),
  };
  const c = map[pixel];
  return `\x1b[38;2;${c.r};${c.g};${c.b}m██\x1b[0m`;
}

export function renderAvatarAnsi(avatarId: AvatarId, color: string): string[] {
  const grid = AVATAR_SPRITES[avatarId];
  return grid.map((row) => row.map((p) => cellAnsi(p, color)).join(""));
}

/** Print gallery: 4 columns of skins with number + label. */
export function printAvatarGallery(): void {
  enableTerminalColor();
  const cols = 4;
  const rows = Math.ceil(AVATAR_CATALOG.length / cols);
  const spriteH = 8;

  console.log("");
  for (let row = 0; row < rows; row++) {
    const batch = AVATAR_CATALOG.slice(row * cols, row * cols + cols);
    const rendered = batch.map((a) => renderAvatarAnsi(a.id, a.color));

    const headers = batch.map((a, i) => {
      const n = row * cols + i + 1;
      return `${n}. ${a.label}`.padEnd(18);
    });
    console.log("  " + headers.join("  "));

    for (let y = 0; y < spriteH; y++) {
      const line = rendered.map((sprite) => sprite[y] ?? "                ").join("  ");
      console.log("  " + line);
    }
    console.log();
  }
}

export function printAvatarPreview(avatarId: AvatarId): void {
  enableTerminalColor();
  const meta = AVATAR_CATALOG.find((a) => a.id === avatarId);
  if (!meta) return;
  for (const line of renderAvatarAnsi(avatarId, meta.color)) {
    console.log("  " + line);
  }
}

export type AvatarAnimState = "idle" | "thinking" | "working" | "done";

/** Live terminal sprite animation (bob / shake) while agent thinks or works. */
export class AvatarAnimator {
  private timer: ReturnType<typeof setInterval> | null = null;
  private frame = 0;
  private state: AvatarAnimState = "idle";
  private readonly lines: number = 8;
  private drawn = false;

  constructor(
    private readonly avatarId: AvatarId,
    private readonly out: NodeJS.WritableStream = process.stderr,
  ) {}

  private meta() {
    return AVATAR_CATALOG.find((a) => a.id === this.avatarId)!;
  }

  private renderFrame(): string[] {
    const base = renderAvatarAnsi(this.avatarId, this.meta().color);
    const f = this.frame % 4;
    if (this.state === "thinking") {
      // bob up/down via leading spaces
      const pad = f === 1 || f === 2 ? "  " : "";
      return base.map((line) => pad + line);
    }
    if (this.state === "working") {
      // shake left/right
      const pad = f % 2 === 0 ? "" : "  ";
      return base.map((line) => pad + line);
    }
    if (this.state === "done") {
      return base.map((line) => "  " + line);
    }
    return base;
  }

  private clear(): void {
    if (!this.drawn) return;
    // move cursor up and clear lines
    this.out.write(`\x1b[${this.lines + 2}A`);
    for (let i = 0; i < this.lines + 2; i++) {
      this.out.write("\x1b[2K\n");
    }
    this.out.write(`\x1b[${this.lines + 2}A`);
  }

  private paint(label: string): void {
    this.clear();
    const frames = this.renderFrame();
    this.out.write(`\n  [${label}]\n`);
    for (const line of frames) {
      this.out.write(`  ${line}\n`);
    }
    this.drawn = true;
  }

  setState(state: AvatarAnimState, detail?: string): void {
    this.state = state;
    const label =
      state === "thinking"
        ? "thinking…"
        : state === "working"
          ? `working${detail ? `: ${detail}` : ""}…`
          : state === "done"
            ? "done"
            : "idle";

    if (state === "idle") {
      this.stop();
      return;
    }

    this.paint(label);
    if (this.timer) clearInterval(this.timer);
    if (state === "done") {
      this.timer = setTimeout(() => this.stop(), 600) as unknown as ReturnType<typeof setInterval>;
      return;
    }
    this.timer = setInterval(() => {
      this.frame++;
      this.paint(label);
    }, 180);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.drawn) {
      this.clear();
      this.drawn = false;
    }
  }
}
