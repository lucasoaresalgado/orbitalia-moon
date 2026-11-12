<script lang="ts">
  // A code editor (CodeMirror 6) for project files and scripts: language by file
  // name, the app's theme, Ctrl/Cmd+S to save. Mounted in the browser only.
  import { onMount } from "svelte";
  import { basicSetup } from "codemirror";
  import { EditorState, Compartment, type Extension } from "@codemirror/state";
  import { EditorView, keymap } from "@codemirror/view";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { python } from "@codemirror/lang-python";
  import { javascript } from "@codemirror/lang-javascript";
  import { sql } from "@codemirror/lang-sql";
  import { markdown } from "@codemirror/lang-markdown";
  import { json } from "@codemirror/lang-json";
  import { currentTheme, LIGHT_THEMES } from "#lib/theme.ts";

  let { value = $bindable(""), path = "", readonly = false, onsave, height = "70vh" }: { value?: string; path?: string; readonly?: boolean; onsave?: () => void; height?: string } = $props();

  let host: HTMLDivElement;
  let view: EditorView | null = null;
  const lang = new Compartment();
  const ro = new Compartment();

  function languageOf(p: string): Extension {
    const ext = p.split(".").pop()?.toLowerCase();
    if (ext === "py") return python();
    if (ext === "ts" || ext === "mts") return javascript({ typescript: true });
    if (ext === "js" || ext === "mjs") return javascript();
    if (ext === "sql") return sql();
    if (ext === "md") return markdown();
    if (ext === "json") return json();
    return [];
  }

  const theme = new Compartment();
  // the editor's own background follows the app theme (first in the list: it wins over oneDark's)
  const surface = EditorView.theme({ "&": { backgroundColor: "var(--surface-1)", color: "var(--text-primary)" }, ".cm-gutters": { backgroundColor: "var(--surface-1)", borderColor: "var(--border)" } });
  const themeExt = () => (LIGHT_THEMES.includes(currentTheme()) ? [surface] : [surface, oneDark]);

  onMount(() => {
    // the editor follows the theme picker live
    const onTheme = () => view?.dispatch({ effects: theme.reconfigure(themeExt()) });
    window.addEventListener("miniasys:theme", onTheme);
    view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          lang.of(languageOf(path)),
          ro.of(EditorState.readOnly.of(readonly)),
          theme.of(themeExt()),
          keymap.of([{ key: "Mod-s", preventDefault: true, run: () => (onsave?.(), true) }]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) value = u.state.doc.toString();
          }),
          EditorView.theme({ "&": { height, fontSize: "12.5px" }, ".cm-scroller": { fontFamily: "var(--font-mono, ui-monospace, monospace)" } }),
        ],
      }),
    });
    return () => {
      window.removeEventListener("miniasys:theme", onTheme);
      view?.destroy();
    };
  });

  // a new file (or a reload) replaces the text; typing doesn't come back through here
  $effect(() => {
    const v = value;
    if (view && v !== view.state.doc.toString()) view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: v } });
  });
  $effect(() => {
    const p = path;
    view?.dispatch({ effects: lang.reconfigure(languageOf(p)) });
  });
  $effect(() => {
    const r = readonly;
    view?.dispatch({ effects: ro.reconfigure(EditorState.readOnly.of(r)) });
  });
</script>

<div bind:this={host} class="overflow-hidden rounded border border-line"></div>
