import { generateId } from "@heyagent/shared";
import type { Plan, PlanStep, RouteDecision, StepKind } from "./types.js";

/** Build a concrete JSON plan from a routing decision — not LLM prose. */
export function buildPlan(goal: string, route: RouteDecision): Plan {
  const now = new Date().toISOString();
  const steps = planStepsFor(route);
  return {
    id: generateId("plan"),
    goal,
    domain: route.domain,
    agent: route.agent,
    steps,
    createdAt: now,
    updatedAt: now,
  };
}

function step(kind: StepKind, title: string, params?: Record<string, unknown>, verify?: string): PlanStep {
  return {
    id: generateId("step"),
    kind,
    title,
    status: "pending",
    params,
    verify,
  };
}

function planStepsFor(route: RouteDecision): PlanStep[] {
  const contact = route.slots.contact || "";
  const endPhrase = route.slots.endPhrase || "до свидания";

  // Cancellation is a terminal orchestration action, not a generic LLM task.
  // This must be before the domain fallbacks because cancel routes are general.
  if (route.slots.cancel === "1") {
    return [step("cancel", "Cancel active mission / UI work", {})];
  }

  if (route.missionKind === "chat_until") {
    return [
      step("open_chat", `Open Telegram chat with ${contact}`, { contact }, "chat_open"),
      step("confirm_focus", "Confirm chat focused (not search bar)", { contact }, "composer_focused"),
      step("click_composer", "Click message composer", {}, "composer_focused"),
      step("compose_reply", "Compose first message", { contact, role: "first" }),
      step("send_message_once", "Send first message once", { contact }, "message_sent"),
      step("wait_for_reply", `Wait for reply from ${contact}`, { contact, maxWaitSeconds: 480 }),
      step("read_reply", "Read incoming reply from screen", { contact }, "reply_received"),
      step(
        "custom",
        `Loop until end phrase «${endPhrase}»: compose → send once → wait → read`,
        { contact, endPhrase, loop: "chat_until" },
        "end_phrase_or_continue",
      ),
    ];
  }

  if (route.domain === "messaging" && route.missionKind === "one_shot") {
    return [
      step("open_chat", `Open Telegram chat with ${contact || "contact"}`, { contact }, "chat_open"),
      step("click_composer", "Click message composer", {}, "composer_focused"),
      step("compose_reply", "Compose message", { contact, role: "one_shot" }),
      step("send_message_once", "Send message once", { contact }, "message_sent"),
    ];
  }

  if (route.domain === "mail") {
    return [step("custom", "Handle mail via gmail browser tools", { channel: "mail" })];
  }

  if (route.domain === "system") {
    return [step("system_control", "Execute system control", {}, "system_ok")];
  }

  if (route.domain === "browser") {
    if (route.slots.openTab === "1") {
      return [
        step(
          "browser_open_and_verify",
          "List CDP tabs and focus already-open quiz/test tab",
          {
            openTab: "1",
            tabQuery: route.slots.tabQuery || "тест",
            tools: ["browser.tabs.list", "browser.tabs.focus", "browser.use_open_tab"],
          },
          "browser_url_ok",
        ),
        step(
          "custom",
          "Solve quiz: SELECT answer → VERIFY → NEXT until result (never Next first)",
          {
            quiz: "1",
            tools: ["browser.use_open_tab", "desktop.see_and_click", "browser.click_text"],
          },
        ),
      ];
    }
    return [
      step(
        "browser_open_and_verify",
        "Open/navigate and verify URL/title match intent",
        { tools: ["browser.open", "browser.page_state", "youtube.open_lesson"] },
        "browser_url_ok",
      ),
      step("custom", "Verify outcome matches owner goal", { tools: ["browser.page_state", "screen.see"] }),
    ];
  }

  if (route.domain === "research") {
    return [
      step("research", "Gather sources", { tools: ["browser.open", "web.analyze"] }),
      step("custom", "Write report", { tools: ["report.write", "file.write"] }),
    ];
  }

  if (route.domain === "desktop") {
    return [
      step("custom", "Observe screen", { tools: ["screen.see", "desktop.see_and_click"] }),
      step("custom", "Act on UI", { tools: ["computer.click", "computer.type", "app.open"] }),
      step("custom", "Verify result on screen", { tools: ["screen.see"] }),
    ];
  }

  if (route.domain === "coder") {
    return [
      step("custom", "Inspect files", { tools: ["file.read", "shell.exec"] }),
      step("custom", "Edit / run", { tools: ["file.write", "shell.exec"] }),
    ];
  }

  // general → structured soft plan for LLM loop continuity
  return [
    step("llm_tool_loop", "Understand goal + recall memory/RAG", {
      domain: route.domain,
      tools: ["memory.remember", "clock.now"],
    }),
    step("custom", "Execute with preferred tools", { domain: route.domain }),
    step("custom", "Verify outcome; retry on ERROR", { verifyHint: "tool_ok" }),
  ];
}

export function markStep(
  plan: Plan,
  stepId: string,
  status: PlanStep["status"],
  result?: string,
): Plan {
  const steps = plan.steps.map((s) =>
    s.id === stepId ? { ...s, status, result: result ?? s.result } : s,
  );
  return { ...plan, steps, updatedAt: new Date().toISOString() };
}

export function nextPendingStep(plan: Plan): PlanStep | undefined {
  return plan.steps.find((s) => s.status === "pending");
}
