/// <reference path="../.stewrd/plugin-api.d.ts" />
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { PluginContext, PluginApi } from "stewrd-plugin-api";
import { Editor, trimTrailingBlank, type Palette } from "./editor";
import { ReadingView } from "./ReadingView";
import { initHarvester, isHarvesting, startHarvest, subscribeHarvesting } from "./harvester";
import { loadNote, saveNote } from "./note";
import { getWorstStatus, setStatus, setViewing, subscribeStatus } from "./status";
import { DEFAULT_SETTINGS, loadSettings, type NotepadSettings } from "./settings";
import copyIcon from "./assets/copy.png";
import clearIcon from "./assets/clear.png";
import harvestIcon from "./assets/harvest.png";
import wrapIcon from "./assets/wrap.png";

type Mode = "source" | "live-preview" | "reading";

// This plugin's own id - matches plugin.json's "id" (and this folder's name).
// Component only receives `api`, not `ctx`, so there's no PluginContext to
// pull pluginId from here; it's a constant since this file only ever is notepad.
const PLUGIN_ID = "notepad";

export function activate(ctx: PluginContext) {
  ctx.api.statusIcon.set("idle");
  initHarvester(ctx);
}

export function deactivate() {
  // Harvest teardown is registered per run via ctx.onDispose in startHarvest().
}

function toggleChecklistAt(content: string, index: number): string {
  const re = /^(\s*(?:[-*+]|\d+\.)\s\[)([ xX])(\])/gm;
  let count = -1;
  return content.replace(re, (match, before, mark, after) => {
    count += 1;
    if (count !== index) return match;
    return `${before}${mark.toLowerCase() === "x" ? " " : "x"}${after}`;
  });
}

const SCROLL_SAVE_DEBOUNCE_MS = 500;

export function Component({ api }: { api: PluginApi }) {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [savedTick, setSavedTick] = useState(0);
  const [mode, setMode] = useState<Mode>(DEFAULT_SETTINGS.defaultMode);
  const [settings, setSettings] = useState<NotepadSettings>(DEFAULT_SETTINGS);
  const [wordWrap, setWordWrap] = useState(true);
  const dotColor = useSyncExternalStore(subscribeStatus, getWorstStatus);
  const harvesting = useSyncExternalStore(subscribeHarvesting, isHarvesting);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentRef = useRef("");
  const scrollPosRef = useRef(0);
  const cursorRef = useRef(0);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const palette = api.theme.palette as Palette;

  useEffect(() => {
    (async () => {
      const [text, s, scrollPos, cursor, wrap] = await Promise.all([
        loadNote(api),
        loadSettings(PLUGIN_ID),
        api.storage.get<number>("scrollPos"),
        api.storage.get<number>("cursorPos"),
        api.storage.get<boolean>("wordWrap"),
      ]);
      setWordWrap(wrap ?? true);
      scrollPosRef.current = scrollPos ?? 0;
      cursorRef.current = cursor ?? 0;
      setContent(text);
      contentRef.current = text;
      setSettings(s);
      setMode(s.defaultMode);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setViewing(true);
    return () => setViewing(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function flushSave(value: string) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    // The editor pads itself with trailing blank lines to allow scrolling
    // past the end of the note (see editor.tsx's infiniteScroll) - trim
    // those back out before they ever touch disk. The live buffer/cursor/
    // scroll position are untouched; only the saved copy is trimmed.
    setStatus(api, "save", "in-progress");
    saveNote(api, value.trimEnd())
      .then(() => setStatus(api, "save", "success"))
      .catch(() => setStatus(api, "save", "error", "save failed"))
      .then(() => setSavedTick((t) => t + 1)); // separate step: a strip problem can't flip the save status
  }

  function onCursor(pos: number) {
    cursorRef.current = pos;
    if (cursorTimer.current) clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => {
      cursorTimer.current = undefined;
      api.storage.set("cursorPos", pos).catch(() => {});
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }

  function onScrollPos(rawPos: number) {
    // Never save a position inside blank padding; it would be rebuilt on remount.
    const pos = Math.min(rawPos, contentRef.current.trimEnd().length);
    scrollPosRef.current = pos;
    if (scrollTimer.current) clearTimeout(scrollTimer.current);
    scrollTimer.current = setTimeout(() => {
      scrollTimer.current = undefined;
      api.storage.set("scrollPos", pos).catch(() => {});
    }, SCROLL_SAVE_DEBOUNCE_MS);
  }

  // Save 1s after typing stops, independent of the editor keeping focus -
  // the timer lives here (not tied to any DOM focus state) so it fires
  // regardless of what else has focus by the time it goes off.
  function onChange(value: string) {
    // Keep padding out of React state so mode switches don't carry it forward.
    const text = value.trimEnd();
    setContent(text);
    contentRef.current = text;
    setStatus(api, "save", "warning"); // unsaved changes pending
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => flushSave(value), settings.autosaveDebounceMs);
  }

  // If the plugin's view unmounts (switching to another sidebar item) with a
  // pending autosave, flush immediately instead of losing/delaying it.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveNote(api, contentRef.current.trimEnd())
          .then(() => setStatus(api, "save", "success"))
          .catch(() => setStatus(api, "save", "error", "save failed"));
      }
      if (cursorTimer.current) {
        clearTimeout(cursorTimer.current);
        api.storage.set("cursorPos", cursorRef.current).catch(() => {});
      }
      if (scrollTimer.current) {
        clearTimeout(scrollTimer.current);
        api.storage.set("scrollPos", scrollPosRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleClear() {
    onChange("");
  }

  function handleHarvest() {
    if (!content.trim() || isHarvesting()) return;
    startHarvest(api, content, () => onChange(""));
  }

  function handleWrapToggle() {
    const next = !wordWrap;
    setWordWrap(next);
    api.storage.set("wordWrap", next).catch(() => {});
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(trimTrailingBlank(content));
      api.toast.show({ message: "Copied To Clipboard", kind: "success" });
    } catch {
      api.toast.show({ message: "Copy Failed", kind: "error" });
    }
  }

  function handleChecklistToggle(index: number) {
    onChange(toggleChecklistAt(content, index));
  }

  if (!loaded) return <p>Loading...</p>;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", width: "100%", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <api.ui.Tabs
          tabs={[
            { label: "Source", value: "source" },
            { label: "Live Preview", value: "live-preview" },
            { label: "Reading", value: "reading" },
          ]}
          value={mode}
          onChange={(v) => setMode(v as Mode)}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span title={wordWrap ? "Word Wrap: On" : "Word Wrap: Off"}>
            <api.ui.IconButton label="Word Wrap" icon={wrapIcon} accent={wordWrap} onClick={handleWrapToggle} />
          </span>
          <api.ui.StatusDot color={dotColor} />
          <span title="Copy Note To Clipboard">
            <api.ui.IconButton label="Copy" icon={copyIcon} onClick={handleCopy} disabled={!content.trim()} />
          </span>
          <span title="Clear The Note">
            <api.ui.IconButton label="Clear" icon={clearIcon} onClick={handleClear} disabled={!content.trim()} />
          </span>
          <span title="Sends this note to the AI with your Harvest Prompt (Settings > Plugins > Configure), after masking anything that looks like a secret. The note is cleared right away.">
            <api.ui.IconButton label="Harvest" icon={harvestIcon} onClick={handleHarvest} disabled={!content.trim() || harvesting} />
          </span>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: "flex", marginTop: 8 }}>
        {mode === "reading" ? (
          <ReadingView content={content} palette={palette} onChecklistToggle={handleChecklistToggle} />
        ) : (
          <Editor
            value={content}
            onChange={onChange}
            mode={mode === "live-preview" ? "live-preview" : "source"}
            palette={palette}
            initialScrollPos={scrollPosRef.current}
            onScrollPos={onScrollPos}
            initialCursor={cursorRef.current}
            onCursor={onCursor}
            savedTick={savedTick}
            wordWrap={wordWrap}
          />
        )}
      </div>
    </div>
  );
}
