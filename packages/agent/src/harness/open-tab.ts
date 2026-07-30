/**
 * DETERMINISTIC harness: owner already opened a tab — find it via CDP titles/URLs,
 * focus it, never open Yandex/Dzen/search as a substitute.
 * If it's a quiz/test — answer ALL questions (do not stop after «Далее»).
 */
import { chatCompletion, type ModelRef } from "@heyagent/models";
import { buildSystemPrompt } from "@heyagent/identity";
import type { SupportedLocale } from "@heyagent/shared";
import { globalTimeline } from "@heyagent/orchestrator";
import { isQuizContinueIntent, rememberLastQuiz } from "./quiz-memory.js";

type StatusFn = (status: "idle" | "thinking" | "working" | "done", detail?: string) => void;

export function detectOpenTabIntent(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (
    /(я\s+.{0,60}открыл|уже\s+открыт|на\s+(этой\s+)?вкладк|перейди\s+на\s+вкладк|открой\s+вкладк)/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/(пройд\w*|реши|заполни|сделай|продолж\w*).{0,40}(тест|опрос|квиз|quiz|exam)/i.test(t)) {
    return true;
  }
  if (/(тест|опрос|квиз|quiz).{0,40}(пройд\w*|реши|заполни|продолж\w*)/i.test(t)) {
    return true;
  }
  if (isQuizContinueIntent(text)) return true;
  return false;
}

export function wantsQuizSolve(text: string): boolean {
  const t = text.toLowerCase().replace(/ё/g, "е");
  if (
    /(пройди|пройти|пройдем|продолж|реш(и|ить)|заполни|ответь).{0,60}(тест|опрос|квиз|quiz|вопрос|exam)/i.test(
      t,
    ) ||
    /(тест|опрос|квиз|quiz).{0,40}(пройди|пройти|продолж|реш|заполни)/i.test(t)
  ) {
    return true;
  }
  if (isQuizContinueIntent(text)) return true;
  return false;
}

/**
 * Focus matching open tab; if it's a quiz — answer every question until done.
 */
export async function runOpenTabTask(params: {
  modelRef: ModelRef;
  identity: Parameters<typeof buildSystemPrompt>[0];
  locale?: SupportedLocale;
  task: string;
  tabQuery?: string;
  preferredBrowser?: "auto" | "yandex" | "chrome" | "edge";
  onStatus?: StatusFn;
  maxQuestions?: number;
}): Promise<string> {
  const {
    modelRef,
    identity,
    task,
    onStatus,
    preferredBrowser = "auto",
    maxQuestions = 40,
  } = params;
  const computer = await import("@heyagent/computer");
  let query =
    computer.extractTabQueryFromMessage(task) ||
    params.tabQuery?.trim() ||
    "тест";
  // Bare «Пройди!!!!» → use last quiz topic if we have one
  if (isQuizContinueIntent(task) || query === "тест") {
    try {
      const { loadLastQuiz } = await import("./quiz-memory.js");
      const last = await loadLastQuiz();
      if (last?.tabQuery && (isQuizContinueIntent(task) || !params.tabQuery)) {
        query = last.tabQuery;
      }
    } catch {
      /* ignore */
    }
  }

  const log = async (s: string) => {
    onStatus?.("working", s.slice(0, 100));
    await globalTimeline.push({ kind: "step", name: "open_tab", detail: s });
  };

  await log(`tabs.list → ищу «${query}»`);
  const listing = await computer.browserListTabs(preferredBrowser);
  await log("tabs.focus");
  const focus = await computer.browserFocusTab(query, preferredBrowser);
  if (focus.startsWith("ERROR")) {
    return [
      focus,
      "",
      "Сырой список вкладок:",
      listing,
      "",
      "Я НЕ открывал Дзен/поиск — нужна уже открытая вкладка с подходящим названием.",
    ].join("\n");
  }

  const lines: string[] = [focus];
  let snap = await computer.browserReadQuiz(preferredBrowser);

  // Intro: only if no options yet (start screen)
  if (!snap.done && snap.options.length < 2) {
    for (const label of ["Далее", "Начать", "Приступить", "Start", "Next"]) {
      const click = await computer.browserClickText(label, preferredBrowser, {
        exclude: ["завершить", "finish"],
      });
      if (click.startsWith("OK")) {
        lines.push(click);
        await log(`intro: ${label}`);
        await sleep(900);
        snap = await computer.browserReadQuiz(preferredBrowser);
        break;
      }
    }
  }

  const solve =
    wantsQuizSolve(task) ||
    snap.looksLikeQuiz ||
    /тест|quiz|onlinetestpad|testometrika/i.test(snap.url + " " + snap.title);

  if (!solve) {
    const text = await computer.browserReadPageText(preferredBrowser, 4000);
    lines.push("--- страница ---", text.slice(0, 3000));
    return lines.join("\n");
  }

  lines.push(
    `Решаю тест ДО КОНЦА: ${snap.title || snap.url} (${snap.progress || "старт"}) — без вопросов владельцу`,
  );
  await rememberLastQuiz({
    tabQuery: query,
    browser: preferredBrowser,
    url: snap.url,
    title: snap.title,
    progress: snap.progress,
  });

  const persona = buildSystemPrompt(identity, params.locale);
  let answered = 0;
  let stuckSame = 0;
  const { visionSolveQuizQuestion, heuristicMatchingValues } = await import("./vision-desk.js");

  for (let i = 0; i < maxQuestions; i++) {
    if (computer.isBrowserMissionCancelled()) {
      lines.push("CANCELLED");
      break;
    }

    snap = await computer.browserReadQuiz(preferredBrowser);
    await rememberLastQuiz({
      tabQuery: query,
      browser: preferredBrowser,
      url: snap.url,
      title: snap.title,
      progress: snap.progress,
    }).catch(() => undefined);

    if (snap.done) {
      lines.push(`Готово. Отвечено: ${answered}.`);
      lines.push(await computer.browserReadPageText(preferredBrowser, 1500));
      break;
    }

    // Landing: «Начать тест» (testometrika / any site) — only before questions start
    if (
      (snap.hasStart && !snap.progress && (snap.radioCount || 0) < 2) ||
      ((snap.radioCount || 0) < 2 &&
        !snap.textInput &&
        !snap.matching &&
        (snap.selectCount || 0) < 2 &&
        !snap.progress &&
        !snap.question)
    ) {
      const start = await computer.browserQuizClickStart(preferredBrowser);
      lines.push(`start → ${start}`);
      await sleep(1500);
      continue;
    }

    // Intro without progress/controls — try start then далее
    if (
      !snap.progress &&
      (snap.radioCount || 0) < 2 &&
      !snap.textInput &&
      !snap.matching &&
      (snap.selectCount || 0) < 2
    ) {
      const start = await computer.browserQuizClickStart(preferredBrowser);
      if (start.startsWith("OK")) {
        lines.push(`start → ${start}`);
        await sleep(1200);
        continue;
      }
      const adv = await computer.browserQuizAdvance(preferredBrowser, false, false);
      lines.push(`intro/далее → ${adv}`);
      await sleep(800);
      continue;
    }

    // Question page with weak DOM (custom UI) → vision handles it
    await log(`Q ${snap.progress || i + 1}: ${snap.question.slice(0, 50)}`);

    // Fast matching path: set all selects, then verify via vision if needed
    if (snap.matching || (snap.selectCount || 0) >= 2) {
      const pageTxt = await computer.browserReadPageText(preferredBrowser, 3000);
      let vals = heuristicMatchingValues(pageTxt + "\n" + snap.question);
      if (!vals.length) {
        vals = await pickMatchingValues(modelRef, persona, task, snap, pageTxt);
      }
      if (vals.length) {
        const set = await computer.browserQuizSetSelects(vals, preferredBrowser);
        lines.push(`matching selects [${vals.join(",")}] → ${set}`);
      }
    }

    // Fast text blank
    if (snap.textInput && (snap.radioCount || 0) < 2 && !snap.matching) {
      const answer = await pickTextAnswer(modelRef, persona, task, snap);
      if (answer) {
        const filled = await computer.browserQuizFillText(answer, preferredBrowser);
        lines.push(`textbox «${answer}» → ${filled}`);
      }
    }

    // Fast radio/checkbox if clear — SELECT only, never Далее here
    if ((snap.radioCount || 0) >= 2 && !snap.matching) {
      const multi =
        !!snap.multiSelect ||
        /какие|отметьте все|выберите все|из предложенн/i.test(snap.question);
      let picks = await pickAnswerIndices(modelRef, persona, task, {
        ...snap,
        options:
          snap.options.length >= 2
            ? snap.options
            : Array.from({ length: snap.radioCount }, (_, j) => `вариант ${j + 1}`),
        multi,
      });
      if (!picks.length) picks = heuristicPicks(snap.question, snap.options);
      if (!picks.length && /наименьш/i.test(snap.question)) {
        const frac = heuristicSmallestFraction(snap.options);
        if (frac != null) picks = [frac];
      }
      for (const pick of picks) {
        const r = await computer.browserSelectQuizOptionWithCursor(pick, preferredBrowser);
        lines.push(`option #${pick} → ${r.startsWith("OK") ? "OK" : r}`);
      }
    }

    // FSM: SELECT → VERIFY → NEXT (code-enforced; model cannot spam Далее)
    const vision = await visionSolveQuizQuestion({
      modelRef,
      task: `${task}\nСначала выбери ответ (кружок), потом код сам нажмёт Далее. НЕ кликай Далее сам.`,
      preferredBrowser,
      maxRounds: snap.matching || snap.needsVision ? 10 : 8,
      onStatus: (s) => log(s),
    });
    lines.push(...vision.log);
    if (vision.ok) {
      answered++;
      stuckSame = 0;
      await sleep(700);
      continue;
    }

    // One more full FSM attempt — still no blind Далее
    lines.push(`retry FSM on ${snap.progress}`);
    const retry = await visionSolveQuizQuestion({
      modelRef,
      task: task + " Кликни правильный кружок ответа. Далее нажмёт код после проверки.",
      preferredBrowser,
      maxRounds: 6,
      onStatus: (s) => log(s),
    });
    lines.push(...retry.log);
    if (retry.ok) {
      answered++;
      stuckSame = 0;
      continue;
    }

    // Last resort: pick an option explicitly, VERIFY, then Next with requireSelection
    lines.push(`last-resort select on ${snap.progress}`);
    let picked = false;
    for (const idx of [1, 2, 3, 4]) {
      const r = await computer.browserSelectQuizOptionWithCursor(idx, preferredBrowser);
      if (r.startsWith("OK")) {
        lines.push(`last-resort option #${idx} OK`);
        picked = true;
        break;
      }
    }
    if (!picked) {
      stuckSame++;
      lines.push(`не смог выбрать вариант на ${snap.progress} (stuck=${stuckSame})`);
      if (stuckSame >= 4) {
        lines.push(`STOP: не могу выбрать ответ на ${snap.progress}. Q: ${snap.question}`);
        break;
      }
      continue;
    }

    await sleep(500);
    const hasSel = await computer.browserQuizHasSelection(preferredBrowser);
    const prog = snap.progress.match(/(\d+)\s*(?:из|\/)\s*(\d+)/i);
    const isLast = !!(prog && prog[1] === prog[2]);
    // requireSelection when DOM sees it; if custom UI and we got OK from click, allow once
    const adv = await computer.browserQuizAdvance(
      preferredBrowser,
      isLast || !snap.hasNext,
      hasSel,
    );
    lines.push(`Далее (after select) → ${adv}`);
    if (!adv.startsWith("OK") && !hasSel) {
      // Custom UI path only after successful option click
      const adv2 = await computer.browserQuizAdvance(preferredBrowser, isLast, false);
      lines.push(`Далее (armed custom) → ${adv2}`);
      if (!adv2.startsWith("OK")) {
        stuckSame++;
        continue;
      }
    } else if (!adv.startsWith("OK")) {
      stuckSame++;
      continue;
    }

    await sleep(900);
    const after = await computer.browserReadQuiz(preferredBrowser);
    if (after.progress !== snap.progress || after.done || isLast) {
      answered++;
      stuckSame = 0;
    } else {
      stuckSame++;
      lines.push(`progress stuck on ${snap.progress}`);
      if (stuckSame >= 4) {
        lines.push(`STOP: прогресс не двигается с ${snap.progress}`);
        break;
      }
    }
    await sleep(500);
  }

  const finalText = await computer.browserReadPageText(preferredBrowser, 2000);
  lines.push("--- итог ---", finalText.slice(0, 1800));
  lines.push(`Отвечено вопросов: ${answered}`);
  if (answered === 0) {
    lines.push("WARNING: ни одного ответа — проверь вкладку теста и CDP.");
  } else if (!/результат|заверш|score|баллов/i.test(finalText)) {
    lines.push(
      "Тест ещё может быть не закончен. Напиши «продолжи» / «пройди» — продолжу СРАЗУ без вопросов.",
    );
  }
  return lines.join("\n");
}

/** Pick 1-based index of smallest simple fraction among options. */
export function heuristicSmallestFraction(options: string[]): number | null {
  const vals = options.map((o, i) => {
    const m = String(o).replace(/,/g, ".").match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return { i: i + 1, v: NaN };
    return { i: i + 1, v: parseInt(m[1]!, 10) / parseInt(m[2]!, 10) };
  });
  const ok = vals.filter((x) => Number.isFinite(x.v));
  if (!ok.length) return null;
  ok.sort((a, b) => a.v - b.v);
  return ok[0]!.i;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function pickMatchingValues(
  modelRef: ModelRef,
  persona: string,
  task: string,
  snap: { question: string; progress: string; selectCount: number },
  pageText: string,
): Promise<string[]> {
  try {
    const res = await chatCompletion(modelRef, [
      {
        role: "system",
        content: [
          persona,
          "Тест «установите соответствие». Верни ТОЛЬКО JSON-массив номеров для select слева сверху вниз, например [4,1,2,3].",
          "Каждый элемент — номер из правой колонки.",
          `Задача: ${task}`,
        ].join("\n"),
      },
      {
        role: "user",
        content: `Прогресс: ${snap.progress}\nВопрос: ${snap.question}\nSelects: ${snap.selectCount}\n\n${pageText.slice(0, 2500)}\n\nJSON массив:`,
      },
    ]);
    const m = (res.content || "").match(/\[[\s\S]*?\]/);
    if (!m) return [];
    const arr = JSON.parse(m[0]) as unknown[];
    return arr.map((x) => String(x).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function pickTextAnswer(
  modelRef: ModelRef,
  persona: string,
  task: string,
  snap: { question: string; progress: string; title: string; textValue?: string },
): Promise<string | null> {
  const heur = heuristicTextAnswer(snap.question);
  if (heur) return heur;
  try {
    const res = await chatCompletion(modelRef, [
      {
        role: "system",
        content: [
          persona,
          "Ты решаешь задание с пропуском / текстовым полем. Ответь ТОЛЬКО значением для поля (число или короткое слово).",
          "Без единиц, без кавычек, без пояснений.",
          `Задача владельца: ${task}`,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Прогресс: ${snap.progress || "?"}`,
          `Вопрос/условие: ${snap.question || snap.title}`,
          "",
          "Что вписать в текстовое поле?",
        ].join("\n"),
      },
    ]);
    const raw = (res.content || "").trim().split("\n")[0]?.trim() ?? "";
    const cleaned = raw.replace(/^["«]|["»]$/g, "").trim();
    if (!cleaned || cleaned.length > 40 || /^stop$/i.test(cleaned)) return null;
    return cleaned;
  } catch {
    return heur;
  }
}

/** Algebra / blank heuristics for common 5th-grade items. */
export function heuristicTextAnswer(question: string): string | null {
  const q = question.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
  // 14x - _x = 6x  →  14 - ? = 6  →  8
  const m = q.match(/(\d+)\s*x\s*[-−–]\s*(?:_+\s*)?x\s*=\s*(\d+)\s*x/i)
    || question.match(/(\d+)\s*x\s*[-−–]\s*_+\s*x\s*=\s*(\d+)\s*x/i);
  if (m) {
    const a = parseInt(m[1]!, 10);
    const b = parseInt(m[2]!, 10);
    if (Number.isFinite(a) && Number.isFinite(b)) return String(a - b);
  }
  // generic: "(\d+)x - ?x = (\d+)x"
  const m2 = question.match(/(\d+)\s*x\s*[-−–]\s*.{0,3}x\s*=\s*(\d+)\s*x/i);
  if (m2) {
    const a = parseInt(m2[1]!, 10);
    const b = parseInt(m2[2]!, 10);
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) return String(a - b);
  }
  return null;
}

async function pickAnswerIndices(
  modelRef: ModelRef,
  persona: string,
  task: string,
  snap: {
    question: string;
    options: string[];
    progress: string;
    title: string;
    multi?: boolean;
  },
): Promise<number[]> {
  const listed = snap.options.map((o, i) => `${i + 1}. ${o}`).join("\n");
  const multi = !!snap.multi;
  try {
    const res = await chatCompletion(modelRef, [
      {
        role: "system",
        content: [
          persona,
          multi
            ? "Ты решаешь тест с НЕСКОЛЬКИМИ верными ответами (галочки). Верни номера через запятую, например: 1,2,5"
            : "Ты решаешь онлайн-тест. Ответь ТОЛЬКО номером варианта (одна цифра: 1, 2, 3…).",
          "Без текста и пояснений. Если не знаешь — 0.",
          `Задача владельца: ${task}`,
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Прогресс: ${snap.progress || "?"}`,
          `Вопрос: ${snap.question || snap.title}`,
          "Варианты:",
          listed,
          "",
          multi ? "Номера всех верных вариантов:" : "Номер правильного варианта:",
        ].join("\n"),
      },
    ]);
    const raw = (res.content || "").trim();
    const nums = [...raw.matchAll(/[1-9]\d*/g)]
      .map((m) => parseInt(m[0], 10))
      .filter((n) => n >= 1 && n <= snap.options.length);
    const uniq = [...new Set(nums)];
    if (uniq.length) return multi ? uniq : [uniq[0]!];
    return heuristicPicks(snap.question, snap.options);
  } catch {
    return heuristicPicks(snap.question, snap.options);
  }
}

/** Fallbacks for common grade-5 items. */
function heuristicPicks(question: string, options: string[]): number[] {
  const q = question.toLowerCase().replace(/ё/g, "е");
  const norm = (s: string) => s.toLowerCase().replace(/,/g, ".").replace(/\s+/g, "");

  if (/миллион.*двадцать\s+четыре\s+тысяч.*сто\s+сорок\s+семь/i.test(q)) {
    const want = "1024147";
    const idx = options.findIndex((o) => o.replace(/\D/g, "") === want);
    return idx >= 0 ? [idx + 1] : [];
  }

  // 2/5 = 0.4 = 4/10 = 20/50
  if (/равносильн|эквивалент|равны.*(2\s*\/\s*5|2\/5)|числу\s*2\s*\/\s*5/i.test(q)) {
    const hits: number[] = [];
    options.forEach((o, i) => {
      const n = norm(o);
      if (n === "0.4" || n === "4/10" || n === "20/50" || n === "2/5") hits.push(i + 1);
    });
    return hits;
  }

  return [];
}
