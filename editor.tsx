// Custom in-plugin CodeMirror editor - the shared api.ui.CodeTextArea has no
// extension seam and no markdown language, so this plugin bundles and owns
// its own CodeMirror 6 instance instead.
import { useEffect, useRef } from "react";
import { EditorState, Compartment, Annotation, Prec, Transaction, type Extension } from "@codemirror/state";
import { keepLength } from "./padding.mjs";
import { EditorView, keymap, highlightActiveLine, Decoration, type DecorationSet, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentMore, indentLess, insertNewlineAndIndent } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { syntaxHighlighting, HighlightStyle, LanguageDescription } from "@codemirror/language";
import { tags } from "@lezer/highlight";

// Hand-picked fenced-code languages only - @codemirror/language-data pulls in
// ~30 lang packs + legacy-modes that would bloat the single-file bundle this
// plugin's build produces (parsed on every app start since it's background:true).
// Tags transactions that pad the document with blank lines (click-below,
// infinite scroll) so the updateListener can skip firing onChange/save for
// them - they're scaffolding for scrolling/clicking, not user edits.
const paddingAnnotation = Annotation.define<boolean>();

// While > 0, scroll reports and infinite-scroll growth are ignored so a scroll
// restore or padding strip settling doesn't overwrite the saved position or
// re-grow the document. One editor is mounted at a time, so module state is fine.
let suppressDepth = 0;
function suppressForTwoFrames(): () => void {
  suppressDepth++;
  let released = false;
  let a = 0;
  let b = 0;
  const release = () => {
    if (released) return;
    released = true;
    suppressDepth--;
  };
  a = requestAnimationFrame(() => {
    b = requestAnimationFrame(release);
  });
  return () => {
    cancelAnimationFrame(a);
    cancelAnimationFrame(b);
    release();
  };
}

const CODE_LANGUAGES = [
  LanguageDescription.of({ name: "javascript", alias: ["js", "jsx", "ts", "tsx"], support: javascript() }),
  LanguageDescription.of({ name: "python", alias: ["py"], support: python() }),
  LanguageDescription.of({ name: "css", support: css() }),
  LanguageDescription.of({ name: "html", support: html() }),
  LanguageDescription.of({ name: "json", support: json() }),
];

export interface Palette {
  background: string;
  surface: string;
  surfaceHover: string;
  text: string;
  textMuted: string;
  accent: string;
  border: string;
  status: Record<"idle" | "in-progress" | "success" | "warning" | "error", string>;
}

function themeExtension(palette: Palette): Extension {
  return EditorView.theme(
    {
      "&": { color: palette.text, backgroundColor: palette.background, height: "100%", width: "100%", minWidth: 0 },
      // CodeMirror owns its own internal scroll container (.cm-scroller),
      // not the outer wrapper div - scrollbar styling has to land here to
      // actually apply, an outer-div style alone would have no effect.
      ".cm-scroller": { scrollbarWidth: "thin", scrollbarColor: `${palette.border} ${palette.surface}` },
      // Extra bottom padding gives room to scroll past the last line and
      // click there (see extendOnClickBelow), like editors' "scroll past
      // end of file" - without it there's no space below short content to
      // scroll or click into in the first place.
      ".cm-content": { caretColor: palette.accent, paddingBottom: "50vh" },
      ".cm-gutters": { backgroundColor: palette.background, color: palette.textMuted, border: "none" },
      ".cm-activeLine": { backgroundColor: palette.surface },
      ".cm-activeLineGutter": { backgroundColor: palette.surface },
      ".cm-selectionBackground": { backgroundColor: `${palette.accent}33` },
    },
    { dark: false },
  );
}

/** Lets you click in the empty space below the last line to place the
 * cursor there, padding the document out with newlines as needed to reach
 * it - CodeMirror normally just clamps such a click to the end of the last
 * line instead. Paired with `.cm-content`'s extra bottom padding (see
 * themeExtension) so there's always room below the text to scroll into and
 * click, even when the document is shorter than the editor's height. */
const extendOnClickBelow = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const docEnd = view.state.doc.length;
    const endCoords = view.coordsAtPos(docEnd);
    if (!endCoords || event.clientY <= endCoords.bottom) return false;
    const linesToAdd = Math.max(1, Math.round((event.clientY - endCoords.bottom) / view.defaultLineHeight));
    view.dispatch({
      changes: { from: docEnd, insert: "\n".repeat(linesToAdd) },
      selection: { anchor: docEnd + linesToAdd },
      scrollIntoView: true,
      annotations: paddingAnnotation.of(true),
    });
    view.focus();
    return true;
  },
});

/** Grows the document with blank lines as the user scrolls toward the
 * bottom, so scrolling never simply hits a hard stop - each near-bottom
 * scroll appends another batch of lines, keeping there always somewhere
 * further to scroll to. The trailing blank lines this produces are trimmed
 * back out at save time (see index.tsx), not kept in the saved file. */
const GROW_BATCH_LINES = 40;
const MAX_PADDING_LINES = 200; // backstop: never grow past this many trailing blank lines
const INPUT_EVENTS = ["wheel", "keydown", "pointerdown", "touchmove"];

function trailingBlankLines(view: EditorView): number {
  const doc = view.state.doc;
  let n = 0;
  for (let i = doc.lines; i >= 1 && n <= MAX_PADDING_LINES; i--, n++) {
    if (doc.line(i).text.trim() !== "") break;
  }
  return n;
}
const infiniteScroll = ViewPlugin.fromClass(
  class {
    private onScroll = () => this.maybeGrow();
    // Only grow in response to real user input: CodeMirror's stick-to-bottom
    // re-pins after each growth and fires another scroll event, which would
    // otherwise loop forever (even while the window is unfocused).
    private lastUserInput = 0;
    private onInput = () => {
      this.lastUserInput = Date.now();
    };
    constructor(private view: EditorView) {
      view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      for (const e of INPUT_EVENTS) view.scrollDOM.addEventListener(e, this.onInput, { passive: true, capture: true });
    }
    maybeGrow() {
      if (suppressDepth > 0) return;
      if (document.visibilityState !== "visible" || Date.now() - this.lastUserInput > 300) return;
      if (trailingBlankLines(this.view) > MAX_PADDING_LINES) return;
      const el = this.view.scrollDOM;
      const remaining = el.scrollHeight - (el.scrollTop + el.clientHeight);
      if (remaining > this.view.defaultLineHeight * (GROW_BATCH_LINES / 2)) return;
      const docEnd = this.view.state.doc.length;
      this.view.dispatch({
        changes: { from: docEnd, insert: "\n".repeat(GROW_BATCH_LINES) },
        annotations: paddingAnnotation.of(true),
      });
    }
    destroy() {
      this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      for (const e of INPUT_EVENTS) this.view.scrollDOM.removeEventListener(e, this.onInput, { capture: true });
    }
  },
);

/** Reports the document position at the top of the viewport on scroll, so the
 * caller can restore it later (a position survives re-wrapping, pixels don't). */
function scrollReporter(onPos: () => ((pos: number) => void) | undefined) {
  return ViewPlugin.fromClass(
    class {
      private onScroll = () => {
        if (suppressDepth > 0) return;
        const pos = this.view.lineBlockAtHeight(this.view.scrollDOM.scrollTop).from;
        onPos()?.(pos);
      };
      constructor(private view: EditorView) {
        view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
      }
      destroy() {
        this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
      }
    },
  );
}

/** Ctrl+A selects only up to the last non-blank character, leaving out the
 * trailing padding lines so they aren't copied. */
function selectTrimmed(view: EditorView): boolean {
  view.dispatch({ selection: { anchor: 0, head: trimTrailingBlank(view.state.doc.toString()).length }, userEvent: "select" });
  stripPadding(view);
  return true;
}

/** Removes trailing padding lines from the live buffer (never before the
 * caret), but only when that can't shift the viewport - otherwise the browser
 * clamps scrollTop and the view jumps. Returns whether it stripped. */
export function stripPadding(view: EditorView | null): boolean {
  if (!view) return false;
  try {
    const doc = view.state.doc;
    const keep = keepLength(doc.toString(), view.state.selection.main.head);
    if (keep >= doc.length) return false;
    const el = view.scrollDOM;
    const keptBottom = view.lineBlockAt(keep).bottom + view.documentTop - el.getBoundingClientRect().top + el.scrollTop;
    if (el.scrollTop + el.clientHeight > keptBottom + window.innerHeight * 0.5) return false;
    suppressForTwoFrames();
    view.dispatch({
      changes: { from: keep, to: doc.length },
      annotations: [paddingAnnotation.of(true), Transaction.addToHistory.of(false)],
    });
    return true;
  } catch {
    return false;
  }
}

export function trimTrailingBlank(text: string): string {
  return text.trimEnd();
}

function highlightExtension(palette: Palette): Extension {
  return syntaxHighlighting(
    HighlightStyle.define([
      { tag: tags.heading, color: palette.accent, fontWeight: "bold" },
      { tag: tags.strong, fontWeight: "bold" },
      { tag: tags.emphasis, fontStyle: "italic" },
      { tag: tags.strikethrough, textDecoration: "line-through" },
      { tag: tags.link, color: palette.accent },
      { tag: tags.monospace, color: palette.status.success },
      { tag: tags.quote, color: palette.textMuted, fontStyle: "italic" },
      { tag: tags.keyword, color: palette.status.warning },
      { tag: tags.string, color: palette.status.success },
      { tag: tags.comment, color: palette.textMuted },
    ]),
  );
}

/** Hides markdown formatting marks (**, *, ==, `, etc.) on every line except
 * the one the cursor is currently on - a simplified live-preview approximation. */
const livePreviewMarks = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildMarkDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildMarkDecorations(update.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const MARK_PATTERNS: RegExp[] = [
  /\*\*\*([^*\n]+)\*\*\*/g, // bold+italic
  /\*\*([^*\n]+)\*\*/g, // bold
  /(?<!\*)\*([^*\n]+)\*(?!\*)/g, // italic
  /~~([^~\n]+)~~/g, // strikethrough
  /==([^=\n]+)==/g, // highlight
  /`([^`\n]+)`/g, // inline code
];

function buildMarkDecorations(view: EditorView): DecorationSet {
  const cursorLine = view.state.doc.lineAt(view.state.selection.main.head).number;
  const widgets: { from: number; to: number }[] = [];
  for (const { from, to } of view.visibleRanges) {
    let lineStart = from;
    while (lineStart <= to) {
      const line = view.state.doc.lineAt(lineStart);
      if (line.number !== cursorLine) {
        for (const pattern of MARK_PATTERNS) {
          pattern.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(line.text))) {
            const markerLen = (match[0].length - match[1].length) / 2;
            const start = line.from + match.index;
            widgets.push({ from: start, to: start + markerLen });
            widgets.push({ from: start + match[0].length - markerLen, to: start + match[0].length });
          }
        }
      }
      lineStart = line.to + 1;
    }
  }
  widgets.sort((a, b) => a.from - b.from);
  const deco = Decoration.set(
    widgets.map((w) => Decoration.replace({}).range(w.from, w.to)),
    true,
  );
  return deco;
}

export interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  mode: "source" | "live-preview";
  palette: Palette;
  onCheckboxToggle?: (lineNumber: number) => void;
  initialScrollPos?: number;
  onScrollPos?: (pos: number) => void;
  initialCursor?: number;
  onCursor?: (pos: number) => void;
  /** Bumped after each successful save; triggers a padding strip. */
  savedTick?: number;
  wordWrap?: boolean;
}

export function Editor({ value, onChange, mode, palette, initialScrollPos, onScrollPos, initialCursor, onCursor, savedTick, wordWrap = true }: EditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const themeCompartment = useRef(new Compartment());
  const highlightCompartment = useRef(new Compartment());
  const modeCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onScrollPosRef = useRef(onScrollPos);
  onScrollPosRef.current = onScrollPos;
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;

  useEffect(() => {
    if (!containerRef.current) return;

    const listNestingKeymap = keymap.of([
      { key: "Tab", run: (view) => (indentMore(view), true) },
      { key: "Shift-Tab", run: (view) => (indentLess(view), true) },
      { key: "Enter", run: insertNewlineAndIndent },
      { key: "Mod-b", run: (view) => (wrapSelection(view, "**"), true) },
      { key: "Mod-i", run: (view) => (wrapSelection(view, "*"), true) },
    ]);

    const state = EditorState.create({
      doc: value,
      extensions: [
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        listNestingKeymap,
        Prec.high(keymap.of([{ key: "Mod-a", run: selectTrimmed }])),
        scrollReporter(() => onScrollPosRef.current),
        markdown({ base: markdownLanguage, codeLanguages: CODE_LANGUAGES }),
        highlightActiveLine(),
        wrapCompartment.current.of(wordWrap ? EditorView.lineWrapping : []),
        extendOnClickBelow,
        infiniteScroll,
        themeCompartment.current.of(themeExtension(palette)),
        highlightCompartment.current.of(highlightExtension(palette)),
        modeCompartment.current.of(mode === "live-preview" ? [livePreviewMarks] : []),
        EditorView.updateListener.of((update) => {
          if (update.selectionSet || update.docChanged) onCursorRef.current?.(update.state.selection.main.head);
          if (update.docChanged && !update.transactions.some((tr) => tr.annotation(paddingAnnotation))) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;
    if (initialCursor) {
      view.dispatch({ selection: { anchor: Math.min(initialCursor, view.state.doc.length) } });
    }
    view.focus();
    let releaseSuppress: (() => void) | undefined;
    let restoreFrame = 0;
    if (initialScrollPos) {
      releaseSuppress = suppressForTwoFrames();
      const textLength = view.state.doc.length;
      view.dispatch({
        changes: { from: textLength, insert: "\n".repeat(GROW_BATCH_LINES) },
        annotations: [paddingAnnotation.of(true), Transaction.addToHistory.of(false)],
      });
      const restore = () => {
        if (viewRef.current !== view) return;
        const pos = Math.min(initialScrollPos, textLength);
        view.dispatch({ effects: EditorView.scrollIntoView(pos, { y: "start" }) });
      };
      restore();
      restoreFrame = requestAnimationFrame(restore);
    }
    return () => {
      cancelAnimationFrame(restoreFrame);
      releaseSuppress?.();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    // Padding lines may trail the doc (and `value`, once typed past) - only
    // replace when the text itself differs.
    if (current !== value && !(current.startsWith(value) && !current.slice(value.length).trim())) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    if (savedTick) stripPadding(viewRef.current);
  }, [savedTick]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: [
        themeCompartment.current.reconfigure(themeExtension(palette)),
        highlightCompartment.current.reconfigure(highlightExtension(palette)),
      ],
    });
  }, [palette]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: modeCompartment.current.reconfigure(mode === "live-preview" ? [livePreviewMarks] : []),
    });
  }, [mode]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: wrapCompartment.current.reconfigure(wordWrap ? EditorView.lineWrapping : []) });
  }, [wordWrap]);

  // Absolutely positioned inside a sized wrapper so a wide, unwrapped document
  // can never widen the plugin layout; only the editor scrolls horizontally.
  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, position: "relative" }}>
      <div
        ref={containerRef}
        style={{
          position: "absolute",
          inset: 0,
          border: `1px solid ${palette.border}`,
          borderRadius: 4,
          overflow: "hidden",
        }}
      />
    </div>
  );
}

function wrapSelection(view: EditorView, marker: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${marker}${selected}${marker}` },
    selection: { anchor: from + marker.length, head: from + marker.length + selected.length },
  });
}
