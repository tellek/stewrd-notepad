// First-run wizard for Harvest. All answers stay in component state; settings.json
// is written once, in finish(), because writing it hot-reloads the plugin.
import { useEffect, useRef, useState } from "react";
import type { PluginApi } from "stewrd-plugin-api";
import { saveSettings, type NotepadSettings } from "./settings";
import { setStatus } from "./status";
import { userProfileFolder, writeWikiFile } from "./wiki";
import {
  DEFAULT_HARVEST_PROMPT,
  WIKI_BASE_PROMPT,
  buildRulesText,
  cleanGeneratedPrompt,
  defaultWikiFolder,
  isAbsoluteWinPath,
  scaffoldIndex,
  scaffoldLog,
} from "./wizard.mjs";
import wikiPlan from "./llm-wiki-plan.md";

type Step = "hasMemory" | "pastePrompt" | "offerWiki" | "folder" | "review" | "rules";

const PLUGIN_ID = "notepad";

export function HarvestWizard({
  api,
  onClose,
  onFinished,
}: {
  api: PluginApi;
  onClose: () => void;
  onFinished: (patch: Partial<NotepadSettings>) => void;
}) {
  const [step, setStep] = useState<Step>("hasMemory");
  const [userPrompt, setUserPrompt] = useState("");
  const [folder, setFolder] = useState("");
  const [generated, setGenerated] = useState("");
  const [useWiki, setUseWiki] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const killRef = useRef<(() => void) | undefined>(undefined);
  const palette = api.theme.palette;

  useEffect(() => {
    api.fs.getRootPath().then((root) => setFolder(defaultWikiFolder(root))).catch(() => {});
    return () => {
      killRef.current?.();
      setStatus(api, "wizard", "idle");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate(instruction: string): Promise<string> {
    const handle = api.ai.run(instruction, { effort: "low" });
    killRef.current = () => handle.kill();
    try {
      return cleanGeneratedPrompt(await handle.done);
    } finally {
      killRef.current = undefined;
    }
  }

  async function work(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setStatus(api, "wizard", "in-progress", "Harvest setup in progress");
    try {
      await task();
      setStatus(api, "wizard", "idle");
    } catch (err) {
      setStatus(api, "wizard", "error", "Harvest setup failed");
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const finish = (patch: Partial<NotepadSettings>) =>
    work(async () => {
      await saveSettings(PLUGIN_ID, { ...patch, launchWizard: false });
      onFinished({ ...patch, launchWizard: false });
    });

  function makePrompt(base: string, extra: string) {
    return work(async () => {
      const text = await generate(
        "Write one prompt that an AI will receive together with a note, telling it how to store lasting memories from that note. " +
          `Start from this base prompt:\n${base}\n\n${extra}\n\n` +
          "Keep the base prompt's intent, keep it short, and do not mention specific note contents. Output ONLY the prompt text, with no preface and no code fences.",
      );
      if (!text) throw new Error("The AI returned an empty prompt. Try again.");
      setGenerated(text);
      setStep("review");
    });
  }

  function scaffold() {
    const target = folder.trim();
    if (!isAbsoluteWinPath(target)) {
      setError("Enter a full path such as C:\\Users\\You\\wiki-memory");
      return;
    }
    return work(async () => {
      await writeWikiFile(api, target, "CLAUDE.md", wikiPlan, "create");
      await writeWikiFile(api, target, "index.md", scaffoldIndex(), "create");
      await writeWikiFile(api, target, "log.md", scaffoldLog(), "create");
      await writeWikiFile(api, target, "raw/.gitkeep", "", "create");
      await writeWikiFile(api, target, "wiki/.gitkeep", "", "create");
      setUseWiki(true);
      const text = await generate(
        "Write one prompt that an AI will receive together with a note, telling it how to extract lasting memories from that note into a markdown wiki. " +
          `Start from this base prompt:\n${WIKI_BASE_PROMPT}\n\n` +
          "Keep it short. Do not mention tools, file paths or output formats, because the host app adds those. Output ONLY the prompt text, with no preface and no code fences.",
      );
      if (!text) throw new Error("The AI returned an empty prompt. Try again.");
      setGenerated(text);
      setStep("review");
    });
  }

  async function copyRules() {
    try {
      await navigator.clipboard.writeText(buildRulesText(folder.trim()));
      api.toast.show({ message: "Copied To Clipboard", kind: "success" });
    } catch {
      api.toast.show({ message: "Copy Failed", kind: "error" });
    }
  }

  async function useProfileFolder() {
    const home = await userProfileFolder(api).catch(() => "");
    if (home) setFolder(`${home}\\wiki-memory`);
  }

  const muted = { color: palette.textMuted, margin: 0 } as const;
  const row = { display: "flex", gap: 8, flexWrap: "wrap" } as const;
  const { TextButton, TextBox, Banner, Spinner } = api.ui;

  return (
    <api.ui.InlineDialog open onClose={() => (busy ? undefined : onClose())} title="Set Up Harvest">
      <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
        {error && <Banner message={error} tone="error" onDismiss={() => setError("")} />}

        {step === "hasMemory" && (
          <>
            <p style={{ margin: 0 }}>Do You Have A Memory System That Your AI Already Uses?</p>
            <div style={row}>
              <TextButton label="Yes" variant="primary" onClick={() => setStep("pastePrompt")} />
              <TextButton label="No" onClick={() => setStep("offerWiki")} />
            </div>
          </>
        )}

        {step === "pastePrompt" && (
          <>
            <p style={muted}>Paste a prompt that makes your AI save something to memory.</p>
            <TextBox value={userPrompt} onChange={setUserPrompt} rows={6} placeholder="Remember that ..." />
            <div style={row}>
              <TextButton label="Back" onClick={() => setStep("hasMemory")} disabled={busy} />
              <TextButton
                label="Create Harvest Prompt"
                variant="primary"
                disabled={busy || !userPrompt.trim()}
                onClick={() => makePrompt(DEFAULT_HARVEST_PROMPT, `The user's own memory prompt, which shows how their system stores memories:\n${userPrompt}`)}
              />
              {busy && <Spinner />}
            </div>
          </>
        )}

        {step === "offerWiki" && (
          <>
            <p style={{ margin: 0 }}>Would You Like To Set Up A Simple Memory System?</p>
            <p style={muted}>It is a folder of markdown pages (an LLM wiki) that Harvest fills in and your AI can read.</p>
            <div style={row}>
              <TextButton label="Yes" variant="primary" onClick={() => setStep("folder")} />
              <TextButton label="No" disabled={busy} onClick={() => finish({ enableHarvest: false, wikiFolder: "" })} />
            </div>
          </>
        )}

        {step === "folder" && (
          <>
            <p style={muted}>Where should the memory folder live? The default is inside this plugin and is deleted if the plugin is uninstalled.</p>
            <TextBox value={folder} onChange={setFolder} singleLine />
            <div style={row}>
              <TextButton label="Back" onClick={() => setStep("offerWiki")} disabled={busy} />
              <TextButton label="Use Home Folder" onClick={useProfileFolder} disabled={busy} />
              <TextButton label="Create Memory System" variant="primary" disabled={busy || !folder.trim()} onClick={scaffold} />
              {busy && <Spinner />}
            </div>
          </>
        )}

        {step === "review" && (
          <>
            <p style={muted}>This is the prompt Harvest will use. Edit it if you like.</p>
            <TextBox value={generated} onChange={setGenerated} rows={7} />
            <div style={row}>
              <TextButton
                label="Back"
                disabled={busy}
                onClick={() => setStep(useWiki ? "folder" : "pastePrompt")}
              />
              {useWiki ? (
                <TextButton label="Next" variant="primary" disabled={!generated.trim()} onClick={() => setStep("rules")} />
              ) : (
                <TextButton
                  label="Finish"
                  variant="primary"
                  disabled={busy || !generated.trim()}
                  onClick={() => finish({ harvestPrompt: generated.trim(), wikiFolder: "" })}
                />
              )}
            </div>
          </>
        )}

        {step === "rules" && (
          <>
            <p style={muted}>Add these rules to your AI's global rules so it starts using the wiki.</p>
            <TextBox value={buildRulesText(folder.trim())} onChange={() => {}} readOnly rows={9} />
            <div style={row}>
              <TextButton label="Copy Rules" onClick={copyRules} />
              <TextButton
                label="Done"
                variant="primary"
                disabled={busy}
                onClick={() => finish({ harvestPrompt: generated.trim(), wikiFolder: folder.trim() })}
              />
            </div>
          </>
        )}
      </div>
    </api.ui.InlineDialog>
  );
}
