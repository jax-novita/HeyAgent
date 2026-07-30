import type { Rectangle, ToolExecutionResult } from "@heyagent/shared";

export type ElementSource = "dom" | "accessibility" | "ocr" | "vision";

export interface AccessibleElement {
  id: string;
  role?: string;
  name?: string;
  value?: string;
  description?: string;
  automationId?: string;
  className?: string;
  enabled: boolean;
  focused: boolean;
  selected?: boolean;
  visible: boolean;
  bounds: Rectangle;
  children?: AccessibleElement[];
  source: ElementSource;
  confidence: number;
  windowId?: string;
}

export interface ElementLocator {
  application?: string;
  windowTitle?: string;
  role?: string;
  name?: string;
  text?: string;
  automationId?: string;
  className?: string;
  nearText?: string;
  boundsHint?: Rectangle;
  minimumConfidence?: number;
}

export interface ElementSourceProvider {
  source: ElementSource;
  findElements(locator: ElementLocator): Promise<AccessibleElement[]>;
  click?(element: AccessibleElement): Promise<ToolExecutionResult>;
  focus?(element: AccessibleElement): Promise<ToolExecutionResult>;
  setValue?(element: AccessibleElement, value: string): Promise<ToolExecutionResult>;
  read?(element: AccessibleElement): Promise<ToolExecutionResult<AccessibleElement>>;
}
