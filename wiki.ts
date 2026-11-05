// File access for the wiki memory folder. Inside the plugin's data/ root it uses
// api.fs. Anywhere else it goes through a short PowerShell script that copies
// between the folder and data/tmp/ (content never travels on the command line,
// and stdout is never used for file text, so UTF-8 survives).
import type { PluginApi } from "stewrd-plugin-api";
import { relativeToRoot } from "./wizard.mjs";

export type WriteMode = "create" | "overwrite" | "append";

const utf8Base64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

function encodeCommand(script: string): string {
  let bin = "";
  for (const ch of script) {
    const c = ch.charCodeAt(0);
    bin += String.fromCharCode(c & 0xff, c >> 8);
  }
  return btoa(bin);
}

let tmpCounter = 0;

async function runPs(api: PluginApi, body: string): Promise<number> {
  const script = `$ProgressPreference='SilentlyContinue';$ErrorActionPreference='Stop'\n$enc=New-Object Text.UTF8Encoding($false)\n${body}\nexit 0`;
  const r = await api.shell.exec("powershell", ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodeCommand(script)]);
  return r.code;
}

const psString = (name: string, value: string) =>
  `$${name}=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${utf8Base64(value)}'))`;

async function target(api: PluginApi, folder: string, rel: string) {
  const root = await api.fs.getRootPath();
  const inside = relativeToRoot(folder, root);
  const full = `${folder.replace(/[\\/]+$/, "")}\\${rel.replace(/\//g, "\\")}`;
  return { root, inside, full, fsPath: inside === null ? "" : [inside, rel].filter(Boolean).join("/") };
}

/** Text of a wiki file, or null when it does not exist. */
export async function readWikiFile(api: PluginApi, folder: string, rel: string): Promise<string | null> {
  const t = await target(api, folder, rel);
  if (t.inside !== null) return api.fs.readTextFile(t.fsPath).catch(() => null);
  const tmpRel = `tmp/r-${Date.now()}-${tmpCounter++}.txt`;
  const tmpFull = `${t.root.replace(/[\\/]+$/, "")}\\${tmpRel.replace(/\//g, "\\")}`;
  const code = await runPs(
    api,
    `${psString("t", t.full)}\n${psString("s", tmpFull)}\nif(-not (Test-Path -LiteralPath $t)){exit 3}\nNew-Item -ItemType Directory -Force -Path (Split-Path $s)|Out-Null\nCopy-Item -LiteralPath $t -Destination $s -Force`,
  );
  if (code !== 0) return null;
  const text = await api.fs.readTextFile(tmpRel).catch(() => null);
  await api.fs.deleteFile(tmpRel).catch(() => {});
  return text;
}

/** Writes a wiki file. "create" is a no-op when the file exists; returns false in that case. */
export async function writeWikiFile(api: PluginApi, folder: string, rel: string, text: string, mode: WriteMode): Promise<boolean> {
  const t = await target(api, folder, rel);
  if (t.inside !== null) {
    const existing = await api.fs.readTextFile(t.fsPath).catch(() => null);
    if (mode === "create" && existing !== null) return false;
    await api.fs.writeTextFile(t.fsPath, mode === "append" && existing !== null ? existing + text : text);
    return true;
  }
  const tmpRel = `tmp/w-${Date.now()}-${tmpCounter++}.txt`;
  const tmpFull = `${t.root.replace(/[\\/]+$/, "")}\\${tmpRel.replace(/\//g, "\\")}`;
  await api.fs.writeTextFile(tmpRel, text);
  try {
    const copy =
      mode === "append"
        ? `[IO.File]::AppendAllText($t,[IO.File]::ReadAllText($s,$enc),$enc)`
        : `Copy-Item -LiteralPath $s -Destination $t -Force`;
    const guard = mode === "create" ? `if(Test-Path -LiteralPath $t){exit 4}\n` : "";
    const code = await runPs(
      api,
      `${psString("t", t.full)}\n${psString("s", tmpFull)}\n${guard}New-Item -ItemType Directory -Force -Path (Split-Path $t)|Out-Null\n${copy}`,
    );
    if (code === 4) return false;
    if (code !== 0) throw new Error(`Could not write ${rel} (exit code ${code})`);
    return true;
  } finally {
    await api.fs.deleteFile(tmpRel).catch(() => {});
  }
}

/** The user's profile folder, for suggesting a permanent wiki location. */
export async function userProfileFolder(api: PluginApi): Promise<string> {
  const r = await api.shell.exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", "[Environment]::GetFolderPath('UserProfile')"]);
  return r.stdout.trim();
}
