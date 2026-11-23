<script lang="ts">
  let { health, max, size = "md" }: { health: number; max: number; size?: "sm" | "md" | "lg" } = $props();
  const pct = $derived(Math.max(0, Math.min(100, (health / Math.max(1, max)) * 100)));
  const tone = $derived(pct > 60 ? "var(--good)" : pct > 25 ? "var(--gold)" : "var(--bad)");
</script>

<div class="bar {size}" role="meter" aria-valuenow={health} aria-valuemin="0" aria-valuemax={max} aria-label="Health">
  <div class="fill" style="width:{pct}%; background:{tone}"></div>
  <span>{health}/{max}</span>
</div>

<style>
  .bar {
    position: relative;
    background: #2c2520;
    border-radius: 999px;
    overflow: hidden;
    height: 18px;
  }
  .bar.sm {
    height: 12px;
  }
  .bar.lg {
    height: 26px;
  }
  .fill {
    height: 100%;
    transition: width 0.4s ease;
  }
  span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 0.72rem;
    font-weight: 700;
    color: #fff;
    text-shadow: 0 1px 2px #000;
  }
  .sm span {
    font-size: 0;
  }
  .lg span {
    font-size: 0.9rem;
  }
</style>
