<script lang="ts">
  // Animated d20: tumbles through random faces, then lands on the server's real roll.
  // The tumbling numbers are only for show; the result always comes from the server.
  import type { RollData } from "../../shared/types";

  let { roll, big = false, onDone }: { roll: RollData; big?: boolean; onDone: () => void } = $props();

  let face = $state(1 + Math.floor(Math.random() * 20));
  let landed = $state(false);

  $effect(() => {
    // Dice already seen when the ability was cast land right away; new dice tumble first.
    const tumble = roll.preRolled ? 0 : 1300;
    const spin = setInterval(() => (face = 1 + Math.floor(Math.random() * 20)), 70);
    const land = setTimeout(() => {
      clearInterval(spin);
      face = roll.d20;
      landed = true;
    }, tumble);
    const close = setTimeout(onDone, tumble + (roll.cast ? 2600 : 3200));
    return () => {
      clearInterval(spin);
      clearTimeout(land);
      clearTimeout(close);
    };
  });

  const crit = $derived(roll.d20 === 20 ? "Natural 20!" : roll.d20 === 1 ? "Natural 1!" : "");
  // Enemy attacks: a "success" for the enemy means a hit on the player.
  const enemy = $derived(roll.characterId === null);
  const verdict = $derived(
    enemy
      ? roll.success ? "Hit!" : "Miss"
      : roll.degree === "great" ? "Great success!" : roll.degree === "bad" ? "Bad failure" : roll.success ? "Success" : "Failure",
  );
  const good = $derived(enemy ? !roll.success : roll.success);
</script>

<button class="dice" class:big class:landed class:good={landed && !roll.cast && good} class:bad={landed && !roll.cast && !good} onclick={onDone} aria-live="polite">
  <div class="label">{roll.label}</div>
  <div class="die" aria-hidden={!landed}>
    <svg viewBox="0 0 100 100" aria-hidden="true">
      <polygon points="50,4 93,28 93,72 50,96 7,72 7,28" />
      <polygon class="inner" points="50,20 78,66 22,66" />
    </svg>
    <span class="num">{face}</span>
  </div>
  {#if landed && roll.cast}
    <div class="math">Locked in. The DM sets the difficulty when you send.</div>
  {:else if landed}
    {#if roll.dice}
      <div class="edge small">{roll.edge === "advantage" ? "Advantage: higher die counts" : "Disadvantage: lower die counts"}
        {#each roll.dice as d, i}<span class="pip" class:kept={d === roll.d20 && roll.dice.indexOf(d) === i}>{d}</span>{/each}
      </div>
    {/if}
    <div class="math">{roll.d20} {roll.mod >= 0 ? "+" : "−"} {Math.abs(roll.mod)} = <b>{roll.total}</b> vs {roll.dc}</div>
    <div class="verdict">{crit ? `${crit} ` : ""}{verdict}</div>
  {:else}
    <div class="math muted">rolling…</div>
  {/if}
</button>

<style>
  .dice {
    position: fixed;
    left: 50%;
    top: 38%;
    transform: translate(-50%, -50%);
    z-index: 70;
    width: min(78vw, 300px);
    padding: 1rem 1rem 1.1rem;
    background: rgba(24, 20, 16, 0.96);
    border: 1px solid var(--line);
    border-radius: 18px;
    box-shadow: 0 12px 48px #000c;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.35rem;
    color: var(--ink);
    animation: pop 0.25s ease-out;
  }
  .dice.big {
    top: auto;
    left: auto;
    right: 2rem;
    bottom: 2rem;
    transform: none;
    width: 320px;
  }
  .dice.good {
    border-color: var(--good);
  }
  .dice.bad {
    border-color: var(--bad);
  }
  .label {
    font-size: 0.85rem;
    color: var(--muted);
    text-transform: capitalize;
  }
  .die {
    position: relative;
    width: 120px;
    height: 120px;
    animation: tumble 0.45s linear infinite;
  }
  .landed .die {
    animation: land 0.35s ease-out;
  }
  svg {
    width: 100%;
    height: 100%;
  }
  polygon {
    fill: var(--surface-2);
    stroke: var(--gold);
    stroke-width: 3;
  }
  .inner {
    fill: none;
    stroke-width: 1.5;
    opacity: 0.6;
  }
  .good polygon {
    stroke: var(--good);
  }
  .bad polygon {
    stroke: var(--bad);
  }
  .num {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-family: var(--serif);
    font-size: 2.6rem;
    font-weight: 700;
    padding-top: 0.6rem;
  }
  .math {
    font-size: 0.95rem;
  }
  .edge {
    color: var(--gold);
    display: flex;
    gap: 0.35rem;
    align-items: center;
    flex-wrap: wrap;
    justify-content: center;
  }
  .pip {
    display: inline-grid;
    place-items: center;
    width: 1.8rem;
    height: 1.8rem;
    border: 1px solid var(--line);
    border-radius: 6px;
    color: var(--muted);
    text-decoration: line-through;
  }
  .pip.kept {
    border-color: var(--gold);
    color: var(--ink);
    text-decoration: none;
    font-weight: 700;
  }
  .verdict {
    font-family: var(--serif);
    font-size: 1.6rem;
    font-weight: 700;
  }
  .good .verdict {
    color: var(--good);
  }
  .bad .verdict {
    color: var(--bad);
  }
  @keyframes tumble {
    from {
      transform: rotate(0deg) scale(0.95);
    }
    50% {
      transform: rotate(180deg) scale(1.05);
    }
    to {
      transform: rotate(360deg) scale(0.95);
    }
  }
  @keyframes land {
    from {
      transform: scale(1.3);
    }
    to {
      transform: scale(1);
    }
  }
  @keyframes pop {
    from {
      opacity: 0;
    }
  }
  .dice:not(.big) {
    animation-name: pop;
  }
  @media (prefers-reduced-motion: reduce) {
    .die {
      animation: none !important;
    }
  }
</style>
