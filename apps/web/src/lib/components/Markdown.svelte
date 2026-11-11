<script lang="ts">
  // Agent output is untrusted: rendered with marked and always sanitized with
  // DOMPurify (scope §13). Until the browser runs, it shows as plain text.
  import { marked } from "marked";
  import DOMPurify from "dompurify";
  import { browser } from "$app/env";

  let { text = "" }: { text?: string } = $props();
  const html = $derived(browser ? DOMPurify.sanitize(marked.parse(text, { async: false, gfm: true, breaks: true }) as string, { FORBID_TAGS: ["style", "form", "input"], FORBID_ATTR: ["style"] }) : "");
</script>

{#if browser}
  <div class="prose-sm break-words">{@html html}</div>
{:else}
  <div class="whitespace-pre-wrap break-words">{text}</div>
{/if}
