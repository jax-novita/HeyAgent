export type CapabilityRisk = "read" | "write" | "sensitive" | "financial" | "destructive";

export interface CapabilityDefinition {
  id: string;
  description: string;
  platforms: string[];
  risk: CapabilityRisk;
  requiresApproval: boolean;
  supportsDryRun: boolean;
  supportsVerification: boolean;
  inputSchema: unknown;
  outputSchema: unknown;
}

export interface CapabilityCheck {
  available: boolean;
  reason?: "unknown" | "unsupported_platform" | "policy_denied" | "approval_required";
  capability?: CapabilityDefinition;
}

export class CapabilityRegistry {
  private definitions = new Map<string, CapabilityDefinition>();

  constructor(initial: CapabilityDefinition[] = DEFAULT_CAPABILITIES) {
    for (const capability of initial) this.register(capability);
  }

  register(capability: CapabilityDefinition): void {
    if (!capability.id.includes(".")) throw new Error("Capability id must be namespaced");
    this.definitions.set(capability.id, structuredClone(capability));
  }

  get(id: string): CapabilityDefinition | undefined {
    const value = this.definitions.get(id);
    return value ? structuredClone(value) : undefined;
  }

  list(platform?: string): CapabilityDefinition[] {
    return [...this.definitions.values()]
      .filter((item) => !platform || item.platforms.includes("*") || item.platforms.includes(platform))
      .map((item) => structuredClone(item));
  }

  check(
    id: string,
    context: { platform: string; policyAllows: boolean; approvalGranted: boolean },
  ): CapabilityCheck {
    const capability = this.definitions.get(id);
    if (!capability) return { available: false, reason: "unknown" };
    if (!capability.platforms.includes("*") && !capability.platforms.includes(context.platform)) {
      return { available: false, reason: "unsupported_platform", capability };
    }
    if (!context.policyAllows) return { available: false, reason: "policy_denied", capability };
    if (capability.requiresApproval && !context.approvalGranted) {
      return { available: false, reason: "approval_required", capability };
    }
    return { available: true, capability };
  }
}

const objectSchema = { type: "object", additionalProperties: true };

export const DEFAULT_CAPABILITIES: CapabilityDefinition[] = [
  capability("desktop.read_screen", "Observe the desktop", "read", false, ["*"]),
  capability("desktop.click", "Click a grounded desktop element", "write", false, ["win32", "darwin", "linux"]),
  capability("browser.navigate", "Navigate a browser tab", "write", false, ["*"]),
  capability("browser.fill_form", "Fill a browser form", "sensitive", true, ["*"]),
  capability("telegram.send_message", "Send a Telegram message", "sensitive", true, ["*"]),
  capability("system.shutdown", "Shut down the computer", "destructive", true, ["*"]),
  capability("shopping.add_to_cart", "Add an item to a cart", "write", false, ["*"]),
  capability("shopping.submit_order", "Submit a purchase", "financial", true, ["*"]),
  capability("booking.prepare", "Prepare a booking", "write", false, ["*"]),
  capability("booking.confirm", "Commit a booking", "financial", true, ["*"]),
];

function capability(
  id: string,
  description: string,
  risk: CapabilityRisk,
  requiresApproval: boolean,
  platforms: string[],
): CapabilityDefinition {
  return {
    id,
    description,
    platforms,
    risk,
    requiresApproval,
    supportsDryRun: risk !== "read",
    supportsVerification: true,
    inputSchema: objectSchema,
    outputSchema: objectSchema,
  };
}
