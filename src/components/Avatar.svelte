<script lang="ts">
  // A character portrait, or the character's initial on a colored disc when there is none.
  let { src = null, name, size = 40 }: { src?: string | null; name: string; size?: number } = $props();

  const hue = $derived([...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7));
  let broken = $state(false);
</script>

{#if src && !broken}
  <img class="av" {src} alt={name} width={size} height={size} style="width:{size}px;height:{size}px" loading="lazy" onerror={() => (broken = true)} />
{:else}
  <span class="av initial" style="width:{size}px;height:{size}px;font-size:{size * 0.45}px;background:hsl({hue} 35% 30%)" aria-hidden="true">
    {name.trim().charAt(0).toUpperCase() || "?"}
  </span>
{/if}

<style>
  .av {
    border-radius: 50%;
    object-fit: cover;
    flex-shrink: 0;
    border: 1px solid var(--line);
    display: inline-block;
  }
  .initial {
    display: inline-grid;
    place-items: center;
    color: var(--ink);
    font-family: var(--serif);
    font-weight: 600;
  }
</style>
