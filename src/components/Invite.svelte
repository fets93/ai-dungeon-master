<script lang="ts">
  // Invite buttons: share sheet on phones, copy link everywhere, WhatsApp directly.
  import { inviteUrl } from "../../shared/types";

  let { code, title, compact = false }: { code: string; title: string; compact?: boolean } = $props();

  const url = $derived(inviteUrl(location.origin, code));
  const message = $derived(`Join our adventure "${title}" 🎲 ${url}`);
  const canShare = typeof navigator !== "undefined" && "share" in navigator && matchMedia("(pointer: coarse)").matches;
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // Older browsers or non-HTTPS: select-and-copy fallback.
      const t = document.createElement("textarea");
      t.value = url;
      document.body.append(t);
      t.select();
      document.execCommand("copy");
      t.remove();
    }
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }

  function share() {
    navigator.share({ title, text: `Join our adventure "${title}" 🎲`, url }).catch(() => {});
  }
</script>

<div class="invite" class:compact>
  {#if !compact}<div class="link small" title={url}>{url.replace(/^https?:\/\//, "")}</div>{/if}
  <div class="row wrap">
    {#if canShare}<button class="primary" onclick={share}>Share invite</button>{/if}
    <button onclick={copy}>{copied ? "Copied ✓" : "Copy link"}</button>
    <a class="wa" href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener">WhatsApp</a>
  </div>
</div>

<style>
  .invite {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .link {
    font-family: ui-monospace, Menlo, monospace;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row > * {
    flex: 1;
  }
  .compact button,
  .compact .wa {
    min-height: 34px;
    padding: 0.25rem 0.5rem;
    font-size: 0.85rem;
  }
  .wa {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0.6rem 1rem;
    border-radius: var(--radius);
    background: #1f6f43;
    border: 1px solid #2a8a56;
    color: #fff;
    text-decoration: none;
    font-weight: 600;
  }
  .wa:hover {
    border-color: #4fd18b;
  }
</style>
