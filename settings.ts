// This plugin has no inline settings UI - every option is a field in this
// plugin's own settings.json, editable via Settings > Plugins > Configure
// (the same raw-JSON screen every plugin's settings.json already goes
// through). `read_plugin_settings_file` is an existing, already-registered
// host command (see src-tauri/src/commands/plugin_settings.rs) - reusing it
// directly needs no host changes at all.
import { invoke } from "@tauri-apps/api/core";

export interface NotepadSettings {
  defaultMode: "source" | "live-preview" | "reading";
  autosaveDebounceMs: number;
  harvestPrompt: string;
  aiEffort: "low" | "medium" | "high";
}

export const DEFAULT_HARVEST_PROMPT =
  "Extract the durable lessons learned, facts, and decisions from the note above. " +
  "Save each one as a separate memory using whatever memory tools or files you have available. " +
  "If nothing is worth keeping, save nothing.";

export const DEFAULT_SETTINGS: NotepadSettings = {
  defaultMode: "live-preview",
  autosaveDebounceMs: 1000,
  harvestPrompt: DEFAULT_HARVEST_PROMPT,
  aiEffort: "medium",
};

export async function loadSettings(pluginId: string): Promise<NotepadSettings> {
  try {
    const raw = await invoke<string>("read_plugin_settings_file", { dir: pluginId });
    const parsed = JSON.parse(raw) as Partial<NotepadSettings>;
    return {
      defaultMode:
        parsed.defaultMode === "source" || parsed.defaultMode === "reading" || parsed.defaultMode === "live-preview"
          ? parsed.defaultMode
          : DEFAULT_SETTINGS.defaultMode,
      autosaveDebounceMs: typeof parsed.autosaveDebounceMs === "number" ? parsed.autosaveDebounceMs : DEFAULT_SETTINGS.autosaveDebounceMs,
      harvestPrompt:
        typeof parsed.harvestPrompt === "string" && parsed.harvestPrompt.trim()
          ? parsed.harvestPrompt
          : DEFAULT_SETTINGS.harvestPrompt,
      aiEffort:
        parsed.aiEffort === "low" || parsed.aiEffort === "medium" || parsed.aiEffort === "high"
          ? parsed.aiEffort
          : DEFAULT_SETTINGS.aiEffort,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
