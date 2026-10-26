# Notepad

A single, unnamed, autosaving markdown note with rich formatting, Obsidian-
style syntax, and a **Harvest** button that hands the note to your AI with a
prompt you control.

## Editing modes

Tabs at the top switch between:

- **Source** — raw markdown with syntax highlighting.
- **Live Preview** — same editor, but formatting marks (`**`, `*`, `` ` ``, `==`, `~~`) are hidden on every line except the one your cursor is on.
- **Reading** — fully rendered, non-editable (checkboxes are still clickable here).

**Copy**, **Clear** and **Harvest** (each with a hover tooltip) sit on the same row
as the tabs, right-aligned. **Copy** puts the note on the clipboard without the
trailing blank lines; Ctrl+A also skips them. Scroll position is remembered
across tab switches and restarts, and the sidebar icon color follows the save dot.
**Clear** empties the note. **Harvest** is described below.

## Markdown support

Bold/italic/bold+italic, strikethrough, highlight (`==text==`), inline code,
blockquotes, headings, ordered/unordered lists (Tab/Shift+Tab to nest,
Enter to auto-continue), checklists (`- [ ]`/`- [x]`), tables, fenced code
blocks with language highlighting (JS/TS, Python, CSS, HTML, JSON),
footnotes (`[^1]` / `[^1]: text`), horizontal rules, callouts (`> [!note]`,
`[!tip]`, `[!warning]`, etc.), comments (`%%hidden%%`), and a leading YAML
frontmatter block shown as a collapsible properties panel. Wikilinks
(`[[...]]`) and embeds (`![[...]]`) render with Obsidian-like styling but
aren't navigable — there's no multi-note vault in this plugin.

## Storage

The note is a single plain `.md` file under this plugin's own sandboxed
storage folder (not the plugin's source directory in git). Autosaves 1
second after you stop typing, even if focus has moved elsewhere — the save
timer isn't tied to DOM focus, and a pending save is flushed immediately if
you navigate away from the plugin before it fires. Older multi-note/KV-based
installs are migrated automatically on first load.

## Settings

This plugin has no in-app settings UI — every option lives in its own
`settings.json`, editable via **Settings > Plugins > Configure**:

```json
{
  "defaultMode": "live-preview",
  "autosaveDebounceMs": 1000,
  "aiEffort": "medium",
  "harvestPrompt": "Extract the durable lessons learned, facts, and decisions from the note above. Save each one as a separate memory using whatever memory tools or files you have available. If nothing is worth keeping, save nothing."
}
```

`harvestPrompt` is optional; the value above is the default. `aiEffort`
(`low`, `medium` or `high`, default `medium`) sets how much power Harvest's AI
run uses.

## Harvest

**Harvest** masks anything that looks like a secret, saves the masked note to
`harvest/` and clears the note right away. It then sends the masked note to
the AI selected in **Settings > AI** (any provider works), preceded by your
`harvestPrompt`. What happens next is whatever your prompt tells the AI to do
with the tools your provider allows, for example saving lessons learned and
facts to your own memory system. The AI is asked to end its reply with
`MEMORIES_CREATED: <n>`.

The status bar shows that harvesting has started, then how many memories were
created. Every run appends the AI's full reply (or the error) to `harvest/harvest.log`,
which explains why it saved what it did. On success the temp file stays in `harvest/`; on failure it is moved to
`harvest/failed/`. The note is not restored, so the masked copy there is the
only one.

**Secret masking** is a non-AI pass (`redact.mjs`) that runs before the AI
sees anything. It replaces known token formats (AWS, GitHub, Slack, Stripe,
Google, `sk-` keys, JWTs, private keys), credentials in URLs, bearer tokens,
values of `password`/`secret`/`token`/`api_key` style assignments, and long
random-looking strings with `[REDACTED]`. It is pattern-based and lossy, so
it can miss unusual secrets or mask harmless text.

Upgrading: add `harvestPrompt` to your `settings.json` if you want to change
it, and delete the old `harvesterEnabled`/`harvesterIntervalMs` keys. Files
left in `harvest/`, `processed/` and `wiki/` by the old Shift button and
background wiki harvester are no longer processed and can be deleted.
`build-release.bat` only adds new keys to an existing deployed `settings.json`; it never changes existing values.
