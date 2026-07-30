/**
 * Remote-desktop style control: see screen/page → decide → move mouse / click.
 * Quiz solver uses OpenClaw-style hard gate: SELECT → VERIFY → only then NEXT.
 */
import { readFile } from "node:fs/promises";
import { chatCompletion, type ModelRef } from "@heyagent/models";

export async function visionPickQuizOption(params: {
  modelRef: ModelRef;
  question: string;
  optionCount: number;
  imagePath: string;
  progress?: string;
}): Promise<number | null> {
  const { modelRef, question, optionCount, imagePath, progress } = params;
  const buf = await readFile(imagePath);
  const res = await chatCompletion(modelRef, [
    {
      role: "system",
      content: [
        "Ты смотришь на скриншот онлайн-теста. Варианты ответа — картинки/фигуры слева направо или сверху вниз (1…N).",
        `Ответь ТОЛЬКО номером варианта от 1 до ${optionCount}. Без текста.`,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        progress ? `Прогресс: ${progress}` : "",
        `Вопрос: ${question}`,
        `Вариантов: ${optionCount}. Какой номер правильный?`,
      ]
        .filter(Boolean)
        .join("\n"),
      images: [{ mimeType: "image/jpeg", data: buf.toString("base64"), detail: "high" }],
    },
  ]);
  const raw = (res.content || "").trim();
  const num = parseInt(raw.match(/[1-9]\d*/)?.[0] || "", 10);
  if (!num || num < 1 || num > optionCount) return null;
  return num;
}

/**
 * Full-screen vision click: focus optional app → screenshot → model returns x,y → mouse click.
 * Like remote desktop control of the PC.
 */
export async function desktopSeeAndClick(params: {
  modelRef: ModelRef;
  instruction: string;
  /** Prefer focusing Yandex/Chrome before shot */
  focusBrowser?: boolean;
  preferredBrowser?: "auto" | "yandex" | "chrome" | "edge";
}): Promise<string> {
  const computer = await import("@heyagent/computer");
  if (params.focusBrowser) {
    await computer.focusBrowserOsWindow(params.preferredBrowser ?? "auto");
  }
  const shot = await computer.captureScreenVision(1400);
  const buf = await readFile(shot.visionPath);
  const res = await chatCompletion(params.modelRef, [
    {
      role: "system",
      content: [
        "Ты управляешь ПК удалённо: видишь скриншот и указываешь, куда кликнуть мышью.",
        `Экран ${shot.width}x${shot.height}, начало (0,0) — левый верх, x вправо, y вниз.`,
        'Ответь ОДНОЙ строкой JSON: {"x":123,"y":456,"why":"кратко"}. Без markdown.',
      ].join("\n"),
    },
    {
      role: "user",
      content: `Задача: ${params.instruction}\nКуда кликнуть?`,
      images: [{ mimeType: shot.mimeType || "image/jpeg", data: buf.toString("base64"), detail: "high" }],
    },
  ]);
  const raw = (res.content || "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return `ERROR: модель не вернула координаты: ${raw.slice(0, 200)}`;
  let parsed: { x?: number; y?: number; why?: string };
  try {
    parsed = JSON.parse(jsonMatch[0]) as { x?: number; y?: number; why?: string };
  } catch {
    return `ERROR: bad JSON: ${raw.slice(0, 200)}`;
  }
  const x = Math.round(Number(parsed.x));
  const y = Math.round(Number(parsed.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return `ERROR: invalid coords ${raw.slice(0, 120)}`;
  }
  await computer.mouseMove(x, y);
  await computer.mouseClick(x, y);
  return `OK clicked (${x},${y}) — ${parsed.why || params.instruction.slice(0, 80)}. Screen ${shot.width}x${shot.height}`;
}

export type QuizVisionPlan = {
  actions: Array<Record<string, unknown>>;
  readyForNext?: boolean;
  note?: string;
  /** 1-based option index when model knows the answer */
  optionIndex?: number;
};

type NormAction =
  | { op: "click"; x: number; y: number }
  | { op: "click_text"; text: string }
  | { op: "type"; text: string }
  | { op: "select"; index: number; value: string | number }
  | { op: "selects"; values: Array<string | number> }
  | { op: "option"; index: number }
  | { op: "next" };

/**
 * OpenClaw-style hard gate for one quiz question:
 * OBSERVE → SELECT (no Next) → VERIFY selection → NEXT → VERIFY progress.
 * Code enforces order; the model cannot spam «Далее».
 */
export async function visionSolveQuizQuestion(params: {
  modelRef: ModelRef;
  task: string;
  preferredBrowser?: "auto" | "yandex" | "chrome" | "edge";
  maxRounds?: number;
  onStatus?: (s: string) => void;
}): Promise<{ ok: boolean; log: string[] }> {
  const computer = await import("@heyagent/computer");
  const preferred = params.preferredBrowser ?? "auto";
  const maxRounds = params.maxRounds ?? 8;
  const log: string[] = [];
  const startProgress = (await computer.browserReadQuiz(preferred)).progress;
  /** Capability token: Next is blocked until this is true (like OpenClaw displayFrameId). */
  let answerArmed = false;

  for (let round = 0; round < maxRounds; round++) {
    params.onStatus?.(`quiz FSM round ${round + 1}`);
    const snap = await computer.browserReadQuiz(preferred);
    if (snap.done) {
      log.push("page says done");
      return { ok: true, log };
    }

    // Landing CTA
    if (snap.hasStart && !snap.progress && (snap.radioCount || 0) < 2) {
      const start = await computer.browserQuizClickStart(preferred);
      log.push(`start → ${start}`);
      await sleep(1200);
      continue;
    }

    const pageImg = await computer.browserCapturePageImage(preferred);
    const buf = await readFile(pageImg.path);
    const pageText = await computer.browserReadPageText(preferred, 2500);

    // ——— PHASE SELECT (Next forbidden in plan + executor) ———
    if (!answerArmed) {
      const already = await computer.browserQuizHasSelection(preferred);
      if (already) {
        answerArmed = true;
        log.push(`round${round + 1}: selection already present → arm`);
      }
    }

    if (!answerArmed) {
      const plan = await planAnswerOnly({
        modelRef: params.modelRef,
        task: params.task,
        snap,
        pageText,
        pageImg,
        buf,
      });
      log.push(`round${round + 1} SELECT: ${plan.note || ""}`);

      let actions = (plan.actions || [])
        .map(normalizeAction)
        .filter((a): a is NormAction => !!a)
        .filter((a) => a.op !== "next");

      // Strip click_text that is Next
      actions = actions.filter(
        (a) => !(a.op === "click_text" && /^(далее|next|продолжить|ответить)$/i.test(a.text.trim())),
      );

      if (snap.matching && snap.selectCount >= 2 && !actions.some((a) => a.op === "selects" || a.op === "select")) {
        const heur = heuristicMatchingValues(pageText + "\n" + snap.question);
        if (heur.length) {
          actions.unshift({ op: "selects", values: heur });
          log.push(`matching heuristic → ${heur.join(",")}`);
        }
      }

      // Prefer explicit optionIndex from model
      const idx =
        plan.optionIndex && plan.optionIndex >= 1
          ? plan.optionIndex
          : actions.find((a) => a.op === "option")?.op === "option"
            ? (actions.find((a) => a.op === "option") as { op: "option"; index: number }).index
            : null;

      if (idx && (snap.radioCount || 0) >= 1 && !actions.some((a) => a.op === "option")) {
        actions.unshift({ op: "option", index: idx });
      }

      // If still nothing useful — ask for option number only
      if (
        !actions.length &&
        (snap.radioCount || 0) >= 2 &&
        !snap.matching &&
        !snap.textInput
      ) {
        const n = await visionPickQuizOption({
          modelRef: params.modelRef,
          question: snap.question || snap.title,
          optionCount: snap.radioCount,
          imagePath: pageImg.path,
          progress: snap.progress,
        });
        if (n) {
          actions = [{ op: "option", index: n }];
          log.push(`option-only pick → #${n}`);
        }
      }

      if (!actions.length) {
        log.push(`round${round + 1}: no select actions — retry (Next BLOCKED)`);
        continue;
      }

      const execLog = await computer.browserExecuteVisionActions(actions, preferred, {
        allowNext: false,
      });
      log.push(...execLog.map((l) => `  ${l}`));

      const selectedSomething = actions.some(
        (a) =>
          a.op === "option" ||
          a.op === "type" ||
          a.op === "select" ||
          a.op === "selects" ||
          a.op === "click" ||
          a.op === "click_text",
      );
      const okLines = execLog.filter((l) => /^OK/i.test(l));
      if (selectedSomething && okLines.length > 0) {
        answerArmed = true;
        log.push("answer ARMED (select executed OK)");
      }

      await sleep(400);
      const has = await computer.browserQuizHasSelection(preferred);
      if (has) {
        answerArmed = true;
        log.push("answer ARMED (DOM selection verified)");
      }

      if (!answerArmed) {
        log.push(`round${round + 1}: select did not stick — Next still BLOCKED`);
        continue;
      }
    }

    // ——— PHASE VERIFY then NEXT ———
    const hasSel = await computer.browserQuizHasSelection(preferred);
    if (!hasSel && !answerArmed) {
      log.push("VERIFY fail — no selection, refuse Next");
      answerArmed = false;
      continue;
    }

    // Re-snapshot before Next (OpenClaw stale-frame idea)
    const before = await computer.browserReadQuiz(preferred);
    params.onStatus?.(`quiz NEXT on ${before.progress}`);
    const adv = await computer.browserQuizAdvance(
      preferred,
      false,
      /* requireSelection */ hasSel,
    );
    if (!adv.startsWith("OK") && answerArmed && !hasSel) {
      // Custom UI: we clicked an option but DOM has no .checked — allow one armed Next
      log.push("custom UI: armed Next without DOM .checked");
      const forced = await computer.browserQuizAdvance(preferred, false, false);
      log.push(`Далее → ${forced}`);
      if (!forced.startsWith("OK")) {
        answerArmed = false;
        continue;
      }
    } else {
      log.push(`Далее → ${adv}`);
      if (!adv.startsWith("OK")) {
        // Do NOT spam Next — re-select
        answerArmed = false;
        log.push("Next failed — disarm, will re-select");
        continue;
      }
    }

    await sleep(900);
    const after = await computer.browserReadQuiz(preferred);
    if (after.progress !== startProgress || after.done) {
      log.push(`progress ${startProgress || "?"} → ${after.progress || "done"}`);
      return { ok: true, log };
    }

    // Next clicked but same question — yellow warning / empty answer
    log.push("progress unchanged after Next — disarm and pick answer again");
    answerArmed = false;
  }

  return { ok: false, log };
}

async function planAnswerOnly(params: {
  modelRef: ModelRef;
  task: string;
  snap: {
    progress: string;
    question: string;
    title: string;
    matching: boolean;
    selectCount: number;
    textInput: boolean;
    radioCount: number;
    multiSelect: boolean;
    options: string[];
  };
  pageText: string;
  pageImg: { width: number; height: number };
  buf: Buffer;
}): Promise<QuizVisionPlan> {
  const { modelRef, task, snap, pageText, pageImg, buf } = params;
  const res = await chatCompletion(modelRef, [
    {
      role: "system",
      content: [
        "Ты решаешь ОДИН вопрос онлайн-теста. Сейчас фаза SELECT — только выбор ответа.",
        "ЗАПРЕЩЕНО: next, Далее, Next, Продолжить — кнопка «Далее» нажмётся КОДОМ после проверки.",
        "Верни ТОЛЬКО JSON:",
        '{"note":"...","optionIndex":3,"actions":[...]}',
        "Допустимые actions:",
        '{"op":"option","index":2} — выбрать кружок/radio #2 сверху вниз (предпочтительно)',
        '{"op":"click","x":123,"y":456} — клик в КРУЖОК слева от варианта (CSS page coords)',
        '{"op":"click_text","text":"..."} — клик по тексту варианта (не Далее)',
        '{"op":"type","text":"8"} — текстовое поле',
        '{"op":"selects","values":["4","1","2","3"]} — соответствия',
        "Кликай в белый кружок слева, не в рекламу.",
        `Страница ~ ${pageImg.width}x${pageImg.height}.`,
      ].join("\n"),
    },
    {
      role: "user",
      content: [
        `Задача: ${task}`,
        `Прогресс: ${snap.progress || "?"}`,
        `Вопрос: ${snap.question || snap.title}`,
        snap.options?.length ? `Варианты: ${snap.options.map((o, i) => `${i + 1}) ${o}`).join(" | ")}` : "",
        snap.matching ? `MATCHING selects=${snap.selectCount}` : "",
        snap.textInput ? "TYPE: текстовое поле" : "",
        `radios=${snap.radioCount} multi=${snap.multiSelect}`,
        "",
        pageText.slice(0, 1600),
        "",
        "Выбери правильный ответ. БЕЗ кнопки Далее.",
      ]
        .filter(Boolean)
        .join("\n"),
      images: [{ mimeType: "image/jpeg", data: buf.toString("base64"), detail: "high" }],
    },
  ]);

  const raw = (res.content || "").trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { actions: [], note: `bad plan ${raw.slice(0, 80)}` };
  try {
    const plan = JSON.parse(jsonMatch[0]) as QuizVisionPlan;
    if (plan.optionIndex == null && typeof (plan as { answer?: number }).answer === "number") {
      plan.optionIndex = (plan as { answer?: number }).answer;
    }
    return plan;
  } catch {
    return { actions: [], note: "JSON parse fail" };
  }
}

function normalizeAction(a: Record<string, unknown>): NormAction | null {
  const op = String(a.op || a.type || "").toLowerCase();
  if (op === "click" && a.x != null && a.y != null) {
    return { op: "click", x: Number(a.x), y: Number(a.y) };
  }
  if ((op === "click_text" || op === "clicktext") && a.text) {
    return { op: "click_text", text: String(a.text) };
  }
  if ((op === "type" || op === "type_text") && a.text != null) {
    return { op: "type", text: String(a.text) };
  }
  if (op === "select" && a.index != null && a.value != null) {
    return { op: "select", index: Number(a.index), value: a.value as string | number };
  }
  if ((op === "selects" || op === "matching") && Array.isArray(a.values)) {
    return { op: "selects", values: a.values as Array<string | number> };
  }
  if ((op === "option" || op === "radio" || op === "checkbox") && a.index != null) {
    return { op: "option", index: Number(a.index) };
  }
  if (op === "next" || op === "далее") return { op: "next" };
  return null;
}

/** Common Online Test Pad matching: дроби ↔ номера. */
export function heuristicMatchingValues(pageText: string): string[] {
  const t = pageText.toLowerCase().replace(/ё/g, "е");
  if (!/соответств|десятичн|смешанн|правильн|неправильн/.test(t)) return [];
  if (/десятичн[\s\S]{0,80}смешан[\s\S]{0,80}правильн[\s\S]{0,80}неправильн/i.test(t)) {
    return ["4", "1", "2", "3"];
  }
  return [];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
