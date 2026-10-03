// Central status for the sidebar icon and the in-pane dot. Each activity
// (the note's save, the harvester) reports its own color; the sidebar icon
// shows the highest-priority one (see CLAUDE.md "Status Color Rules").
import type { PluginApi, StatusColor } from "stewrd-plugin-api";

export type StatusSource = "save" | "harvester";

const PRIORITY: StatusColor[] = ["idle", "success", "in-progress", "warning", "error"];
const SUCCESS_RESET_MS = 3000;

const colors: Record<StatusSource, StatusColor> = { save: "idle", harvester: "idle" };
const listeners = new Set<() => void>();
let lastApi: PluginApi | undefined;
let viewing = false;
let resetTimer: ReturnType<typeof setTimeout> | undefined;

export function getStatus(source: StatusSource): StatusColor {
  return colors[source];
}

export function subscribeStatus(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setStatus(api: PluginApi, source: StatusSource, color: StatusColor, tooltip?: string) {
  lastApi = api;
  colors[source] = color;
  publish(tooltip);
  scheduleReset();
}

/** Called by the pane on mount/unmount: success only fades while it is showing. */
export function setViewing(value: boolean) {
  viewing = value;
  scheduleReset();
}

function publish(tooltip?: string) {
  const worst = Object.values(colors).reduce((a, b) => (PRIORITY.indexOf(b) > PRIORITY.indexOf(a) ? b : a), "idle" as StatusColor);
  try {
    lastApi?.statusIcon.set(worst, tooltip); // throws after deactivation/hot-reload
  } catch {
    // plugin deactivated
  }
  listeners.forEach((fn) => fn());
}

// Success fades to idle 3s after the pane is on screen AND the app has focus.
// Leaving the pane or the app cancels the countdown; returning restarts it.
function scheduleReset() {
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = undefined;
  const pending = Object.values(colors).includes("success");
  if (!pending || !viewing || !document.hasFocus()) return;
  resetTimer = setTimeout(() => {
    resetTimer = undefined;
    for (const source of Object.keys(colors) as StatusSource[]) {
      if (colors[source] === "success") colors[source] = "idle";
    }
    publish();
  }, SUCCESS_RESET_MS);
}

window.addEventListener("focus", scheduleReset);
window.addEventListener("blur", scheduleReset);
