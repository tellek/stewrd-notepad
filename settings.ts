// This plugin has no inline settings UI - every option is a field in this
// plugin's own settings.json, editable via Settings > Plugins > Configure
// (the same raw-JSON screen every plugin's settings.json already goes
// through). `read_plugin_settings_file` is an existing, already-registered
// host command (see src-tauri/src/commands/plugin_settings.rs) - reusing it
// directly needs no host changes at all.
import { invoke } from "@tauri-apps/api/core";
import { DEFAULT_HARVEST_PROMPT } from "./wizard.mjs";

export interface NotepadSettings {
  defaultMode: "source" | "live-preview" | "reading";
  autosaveDebounceMs: number;
  harvestPrompt: string;
  aiEffort: "low" | "medium" | "high";
  launchWizard: boolean;
  enableHarvest: boolean;
  wikiFolder: string;
}

// Lives in wizard.mjs so node --test can load it without Tauri.
export { DEFAULT_HARVEST_PROMPT };

export const DEFAULT_SETTINGS: NotepadSettings = {
  defaultMode: "live-preview",
  autosaveDebounceMs: 1000,
  harvestPrompt: DEFAULT_HARVEST_PROMPT,
  aiEffort: "medium",
  launchWizard: false,
  enableHarvest: true,
  wikiFolder: "",
};

/** Merges `patch` into the plugin's settings.json. Writing it hot-reloads the plugin, so call it once. */
export async function saveSettings(pluginId: string, patch: Partial<NotepadSettings>): Promise<void> {
  const raw = await invoke<string>("read_plugin_settings_file", { dir: pluginId });
  const merged = { ...JSON.parse(raw), ...patch };
  await invoke("write_plugin_settings_file", { dir: pluginId, contents: JSON.stringify(merged, null, 2) + "\n" });
}

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
      launchWizard: parsed.launchWizard === true,
      enableHarvest: parsed.enableHarvest !== false,
      wikiFolder: typeof parsed.wikiFolder === "string" ? parsed.wikiFolder.trim() : "",
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}
