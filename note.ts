// A single always-present, unnamed note stored as one .md file under this
// plugin's own sandboxed storage folder.
import type { PluginApi } from "stewrd-plugin-api";

const NOTE_PATH = "note.md";
const LEGACY_STORAGE_KEY = "content";

export async function loadNote(api: PluginApi): Promise<string> {
  // Check existence via listDir first (never errors, never logged) instead
  // of attempting a read that's expected to fail on a fresh install - the
  // host logs every fs_read_text_file error to the status bar regardless of
  // whether this catches it.
  const entries = await api.fs.listDir();
  if (entries.some((e) => !e.isDir && e.name === NOTE_PATH)) {
    return await api.fs.readTextFile(NOTE_PATH);
  }

  // No note.md yet - migrate the old single-note api.storage blob if present,
  // then create the file.
  const legacy = await api.storage.get<string>(LEGACY_STORAGE_KEY);
  const content = legacy ?? "";
  await api.fs.writeTextFile(NOTE_PATH, content);
  return content;
}

export async function saveNote(api: PluginApi, content: string): Promise<void> {
  await api.fs.writeTextFile(NOTE_PATH, content);
}
