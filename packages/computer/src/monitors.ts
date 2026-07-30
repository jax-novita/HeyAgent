import type { MonitorState, Rectangle } from "@heyagent/shared";

export interface MonitorPoint {
  monitorId: string;
  global: { x: number; y: number };
  local: { x: number; y: number };
  deviceLocal: { x: number; y: number };
  scaleFactor: number;
}

export function monitorForPoint(
  monitors: MonitorState[],
  x: number,
  y: number,
): MonitorState | undefined {
  return monitors.find(
    (monitor) =>
      x >= monitor.x &&
      x < monitor.x + monitor.width &&
      y >= monitor.y &&
      y < monitor.y + monitor.height,
  );
}

export function toMonitorPoint(
  monitors: MonitorState[],
  x: number,
  y: number,
): MonitorPoint {
  const monitor = monitorForPoint(monitors, x, y);
  if (!monitor) throw new Error(`Point (${x}, ${y}) is outside the monitor layout`);
  const local = { x: x - monitor.x, y: y - monitor.y };
  return {
    monitorId: monitor.id,
    global: { x, y },
    local,
    deviceLocal: {
      x: Math.round(local.x * monitor.scaleFactor),
      y: Math.round(local.y * monitor.scaleFactor),
    },
    scaleFactor: monitor.scaleFactor,
  };
}

export function monitorForRectangle(
  monitors: MonitorState[],
  rectangle: Rectangle,
): MonitorState | undefined {
  return monitors
    .map((monitor) => ({ monitor, area: intersectionArea(monitor, rectangle) }))
    .sort((left, right) => right.area - left.area)[0]?.monitor;
}

function intersectionArea(left: Rectangle, right: Rectangle): number {
  const width = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const height = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return width * height;
}
