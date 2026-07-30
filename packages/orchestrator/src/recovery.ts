export type FailureClass =
  | "element_not_found"
  | "wrong_window"
  | "unexpected_dialog"
  | "application_not_running"
  | "application_not_responding"
  | "browser_disconnected"
  | "page_changed"
  | "network_error"
  | "authentication_required"
  | "permission_required"
  | "ambiguous_target"
  | "external_blocker"
  | "verification_failed"
  | "unknown";

export interface RecoveryAttempt {
  failureClass: FailureClass;
  strategy: string;
  attempt: number;
  exhausted: boolean;
}

const DEFAULT_LADDERS: Record<FailureClass, string[]> = {
  element_not_found: [
    "refresh_accessibility",
    "check_active_window",
    "dismiss_overlay",
    "scroll",
    "alternate_locator",
    "ocr",
    "vision",
    "maximize_window",
    "restart_application",
    "ask_user",
  ],
  wrong_window: ["focus_expected_window", "restore_window", "ask_user"],
  unexpected_dialog: ["inspect_dialog", "dismiss_safe_dialog", "ask_user"],
  application_not_running: ["start_application", "wait_for_window", "ask_user"],
  application_not_responding: ["wait", "restore_window", "restart_application", "ask_user"],
  browser_disconnected: ["reconnect_cdp", "restart_browser", "ask_user"],
  page_changed: ["refresh_dom", "replan_page", "ask_user"],
  network_error: ["wait", "retry_network", "ask_user"],
  authentication_required: ["reuse_session", "ask_user"],
  permission_required: ["request_permission", "ask_user"],
  ambiguous_target: ["refine_locator", "ask_user"],
  external_blocker: ["wait", "ask_user"],
  verification_failed: ["refresh_observation", "alternate_verifier", "ask_user"],
  unknown: ["refresh_observation", "replan", "ask_user"],
};

export class RecoveryEngine {
  private counts = new Map<string, number>();

  constructor(
    private readonly maxAttempts = 10,
    private readonly ladders: Record<FailureClass, string[]> = DEFAULT_LADDERS,
  ) {}

  classify(error: unknown): FailureClass {
    const message = error instanceof Error ? error.message : String(error);
    const rules: Array<[RegExp, FailureClass]> = [
      [/element|locator|not found/i, "element_not_found"],
      [/wrong window|focus/i, "wrong_window"],
      [/dialog|modal|overlay/i, "unexpected_dialog"],
      [/not responding|hung/i, "application_not_responding"],
      [/not running|process.*missing/i, "application_not_running"],
      [/cdp|browser.*disconnect/i, "browser_disconnected"],
      [/network|econn|timeout/i, "network_error"],
      [/auth|login|sign.?in/i, "authentication_required"],
      [/permission|access denied/i, "permission_required"],
      [/ambiguous/i, "ambiguous_target"],
      [/verify|criterion/i, "verification_failed"],
    ];
    return rules.find(([pattern]) => pattern.test(message))?.[1] ?? "unknown";
  }

  next(missionId: string, stepId: string, failure: FailureClass): RecoveryAttempt {
    const key = `${missionId}:${stepId}:${failure}`;
    const attempt = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, attempt);
    const ladder = this.ladders[failure];
    const exhausted = attempt > this.maxAttempts || attempt > ladder.length;
    return {
      failureClass: failure,
      strategy: exhausted ? "ask_user" : ladder[attempt - 1]!,
      attempt,
      exhausted,
    };
  }

  reset(missionId: string, stepId: string): void {
    const prefix = `${missionId}:${stepId}:`;
    for (const key of this.counts.keys()) if (key.startsWith(prefix)) this.counts.delete(key);
  }
}
