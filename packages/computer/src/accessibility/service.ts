import type { ToolExecutionResult } from "@heyagent/shared";
import type {
  AccessibleElement,
  ElementLocator,
  ElementSource,
  ElementSourceProvider,
} from "./types.js";
import type { WaitOptions } from "../observer/types.js";

const SOURCE_PRIORITY: Record<ElementSource, number> = {
  dom: 4,
  accessibility: 3,
  ocr: 2,
  vision: 1,
};

export class AccessibilityService {
  constructor(private readonly providers: ElementSourceProvider[]) {}

  async findElement(locator: ElementLocator): Promise<AccessibleElement | undefined> {
    return (await this.findElements(locator))[0];
  }

  async findElements(locator: ElementLocator): Promise<AccessibleElement[]> {
    const minimum = locator.minimumConfidence ?? 0.5;
    const batches = await Promise.all(
      this.providers.map((provider) => provider.findElements(locator).catch(() => [])),
    );
    return deduplicate(batches.flat())
      .filter((element) => element.confidence >= minimum && matches(element, locator))
      .sort(
        (left, right) =>
          SOURCE_PRIORITY[right.source] - SOURCE_PRIORITY[left.source] ||
          right.confidence - left.confidence,
      );
  }

  async clickElement(locator: ElementLocator): Promise<ToolExecutionResult> {
    const element = await this.requireActionable(locator);
    return this.invoke(element, "click");
  }

  async focusElement(locator: ElementLocator): Promise<ToolExecutionResult> {
    const element = await this.requireActionable(locator);
    return this.invoke(element, "focus");
  }

  async setElementValue(locator: ElementLocator, value: string): Promise<ToolExecutionResult> {
    const element = await this.requireActionable(locator);
    return this.invoke(element, "setValue", value);
  }

  async readElement(locator: ElementLocator): Promise<ToolExecutionResult<AccessibleElement>> {
    const element = await this.findElement(locator);
    if (!element) return failed("ELEMENT_NOT_FOUND");
    const provider = this.providers.find((item) => item.source === element.source);
    if (provider?.read) return provider.read(element);
    const now = new Date().toISOString();
    return { success: true, data: element, evidence: [], startedAt: now, finishedAt: now };
  }

  waitForElement(locator: ElementLocator, options?: WaitOptions): Promise<AccessibleElement> {
    return poll(
      async () => this.findElement(locator),
      options,
      `element ${locator.name ?? locator.text ?? locator.automationId ?? ""}`,
    );
  }

  async waitForElementToDisappear(locator: ElementLocator, options?: WaitOptions): Promise<void> {
    await poll(async () => (await this.findElement(locator)) ? undefined : true, options, "element disappearance");
  }

  private async requireActionable(locator: ElementLocator): Promise<AccessibleElement> {
    const element = await this.findElement(locator);
    if (!element) throw new Error("ELEMENT_NOT_FOUND");
    if (!element.visible) throw new Error("ELEMENT_NOT_VISIBLE");
    if (!element.enabled) throw new Error("ELEMENT_NOT_ENABLED");
    if (element.bounds.width <= 0 || element.bounds.height <= 0) throw new Error("ELEMENT_INVALID_BOUNDS");
    if (locator.windowTitle && !element.windowId) throw new Error("ELEMENT_WINDOW_UNCONFIRMED");
    return element;
  }

  private async invoke(
    element: AccessibleElement,
    action: "click" | "focus" | "setValue",
    value?: string,
  ): Promise<ToolExecutionResult> {
    const provider = this.providers.find((item) => item.source === element.source);
    if (action === "click") {
      return provider?.click ? provider.click(element) : failed("ACTION_NOT_SUPPORTED:click");
    }
    if (action === "focus") {
      return provider?.focus ? provider.focus(element) : failed("ACTION_NOT_SUPPORTED:focus");
    }
    return provider?.setValue
      ? provider.setValue(element, value ?? "")
      : failed("ACTION_NOT_SUPPORTED:setValue");
  }
}

function matches(element: AccessibleElement, locator: ElementLocator): boolean {
  const includes = (actual: string | undefined, expected: string | undefined) =>
    !expected || Boolean(actual?.toLowerCase().includes(expected.toLowerCase()));
  if (!includes(element.name, locator.name)) return false;
  if (!includes(`${element.name ?? ""} ${element.value ?? ""}`, locator.text)) return false;
  if (!includes(element.role, locator.role)) return false;
  if (!includes(element.automationId, locator.automationId)) return false;
  if (!includes(element.className, locator.className)) return false;
  return true;
}

function deduplicate(elements: AccessibleElement[]): AccessibleElement[] {
  const selected = new Map<string, AccessibleElement>();
  for (const element of elements) {
    const key = [
      element.role ?? "",
      element.name?.toLowerCase() ?? "",
      Math.round(element.bounds.x / 5),
      Math.round(element.bounds.y / 5),
    ].join(":");
    const current = selected.get(key);
    if (
      !current ||
      SOURCE_PRIORITY[element.source] > SOURCE_PRIORITY[current.source] ||
      element.confidence > current.confidence
    ) {
      selected.set(key, element);
    }
  }
  return [...selected.values()];
}

async function poll<T>(
  probe: () => Promise<T | undefined>,
  options: WaitOptions = {},
  description: string,
): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  while (Date.now() <= deadline) {
    if (options.signal?.aborted) throw new Error(`Waiting for ${description} was cancelled`);
    const result = await probe();
    if (result !== undefined) return result;
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? 250));
  }
  throw new Error(`Timed out waiting for ${description}`);
}

function failed<T = unknown>(code: string): ToolExecutionResult<T> {
  const now = new Date().toISOString();
  return {
    success: false,
    error: { code, message: code, retryable: true },
    evidence: [],
    startedAt: now,
    finishedAt: now,
  };
}
