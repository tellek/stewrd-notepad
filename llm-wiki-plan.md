# LLM Wiki: Memory Schema

This folder is a persistent, LLM-maintained knowledge base (the "LLM Wiki" pattern described by Andrej Karpathy). Instead of re-deriving answers from raw notes on every question, the LLM compiles what it learns into interlinked markdown pages once, then keeps them current. These instructions work with any AI tool: read this file first, then follow it.

## Layers

1. **`raw/`** holds source material (notes, articles, transcripts). It is immutable: read it, never edit it.
2. **`wiki/`** holds the knowledge: one markdown page per topic (an entity, concept, decision, project, person, or lesson). The LLM owns this layer completely.
3. **This file** is the schema: the conventions below. Update it only when the user asks.

Two special files live at the top level:

- **`index.md`** is the catalog of every wiki page, one line each: `- [Title](wiki/file.md) - one-line summary`. Read it first to find relevant pages. It must stay small enough to read in full.
- **`log.md`** is append-only history. One dated entry per change, newest at the bottom: `## [YYYY-MM-DD] ingest | short description`.

## Page conventions

- File names are lowercase words joined by hyphens: `wiki/topic-name.md`.
- Start with a `# Title` and a one-paragraph summary. Then short sections.
- Link related pages with relative links: `[Other Topic](other-topic.md)`.
- State facts plainly with the date learned when it matters. Do not guess.
- When new information contradicts a page, keep both and add a "Contradictions" note rather than silently overwriting.
- One topic per page. Split a page that grows past a few screens.

## Operations

### Ingest (adding knowledge)
1. Read the new source (a note, a conversation, a document).
2. Decide which existing pages it touches, and whether new pages are needed.
3. Update or create those pages with the full new content.
4. Add a line to `index.md` for every new page; keep every existing line.
5. Append an entry to `log.md`.

### Query (using knowledge)
1. Read `index.md` and pick the relevant pages.
2. Read those pages and answer from them, citing the page names.
3. If the answer is a useful new synthesis, offer to save it as a page.

### Lint (periodic health check)
Look for contradictions between pages, stale claims, orphan pages missing from `index.md`, dangling links, and topics mentioned often that lack their own page. Fix what is clear, report what is not.

## Rules

- Never edit `raw/`.
- Never delete a page or an index line without the user's approval.
- Keep `index.md` and `log.md` in sync with `wiki/` after every change.
- Prefer updating a page over creating a near-duplicate.
