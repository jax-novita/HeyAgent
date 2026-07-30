export * from "./types.js";
export * from "./desktop-observer.js";
export * from "./windows-backend.js";

import { DesktopObserver } from "./desktop-observer.js";
import { SystemDesktopObserverBackend } from "./windows-backend.js";

export const systemDesktopObserver = new DesktopObserver(new SystemDesktopObserverBackend());
