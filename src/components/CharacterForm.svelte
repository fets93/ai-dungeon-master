<script lang="ts">
  import {
    MAX_ABILITIES,
    MAX_ITEMS,
    STATS,
    STAT_BASE,
    STAT_MAX,
    STAT_MIN,
    STAT_POINTS,
    maxHealthFor,
    modifier,
    statPointsUsed,
    type NewCharacterInput,
    type Stat,
  } from "../../shared/types";

  let { onSubmit, onCancel }: { onSubmit: (c: NewCharacterInput) => void; onCancel: () => void } = $props();

  const STAT_HELP: Record<Stat, string> = {
    strength: "lifting, hitting, breaking",
    agility: "sneaking, dodging, aiming",
    intelligence: "knowledge, puzzles, magic theory",
    wisdom: "noticing, instincts, willpower",
    charm: "persuading, lying, performing",
    stamina: "endurance; sets your health",
    resist: "shrugging off poison, magic, fear",
  };

  let name = $state("");
  let concept = $state("");
  let backstory = $state("");
  let pin = $state("");
  let stats = $state(Object.fromEntries(STATS.map((k) => [k, STAT_BASE])) as Record<Stat, number>);
  let abilities = $state([{ name: "", description: "", usesPerRest: 1 }]);
  let items = $state(["", "", ""]);

  const used = $derived(statPointsUsed(stats));
  const left = $derived(STAT_POINTS - used);
  const health = $derived(maxHealthFor(stats.stamina));
  const valid = $derived(name.trim().length > 0 && left >= 0 && (pin === "" || /^\d{4}$/.test(pin)));

  const bump = (k: Stat, d: number) => {
    const v = stats[k] + d;
    if (v < STAT_MIN || v > STAT_MAX) return;
    if (d > 0 && left <= 0) return;
    stats[k] = v;
  };

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      concept: concept.trim(),
      backstory: backstory.trim(),
      stats: { ...stats },
      abilities: abilities.filter((a) => a.name.trim() && a.description.trim()),
      items: items.map((i) => i.trim()).filter(Boolean),
      pin: pin.trim(),
    });
  }
</script>

<form onsubmit={submit}>
  <h2>New character</h2>

  <label for="cname">Name</label>
  <input id="cname" bind:value={name} maxlength="24" placeholder="Veyra" autocomplete="off" />

  <label for="concept">Concept (your own class)</label>
  <input id="concept" bind:value={concept} maxlength="80" placeholder="Storm-touched sailor, survivor of a lost ship" />

  <div class="row between">
    <span class="lbl">Stats</span>
    <span class="chip" class:gold={left === 0} class:bad={left < 0}>{left} points left</span>
  </div>
  <p class="small muted hint">Everyone starts at {STAT_BASE}. Spend {STAT_POINTS} points (max {STAT_MAX}); lower a stat to {STAT_MIN} to get points back.</p>
  <div class="stats">
    {#each STATS as k}
      <div class="stat">
        <div class="grow">
          <div class="sname">{k}</div>
          <div class="small muted">{STAT_HELP[k]}</div>
        </div>
        <button type="button" class="step" aria-label="Lower {k}" onclick={() => bump(k, -1)} disabled={stats[k] <= STAT_MIN}>−</button>
        <div class="val">
          {stats[k]}<span class="small muted">{modifier(stats[k]) >= 0 ? "+" : ""}{modifier(stats[k])}</span>
        </div>
        <button type="button" class="step" aria-label="Raise {k}" onclick={() => bump(k, 1)} disabled={stats[k] >= STAT_MAX || left <= 0}>+</button>
      </div>
    {/each}
  </div>
  <p class="small muted">Health: <b>{health}</b> (from stamina)</p>

  <div class="row between">
    <span class="lbl">Abilities</span>
    <span class="small muted">{abilities.length}/{MAX_ABILITIES}</span>
  </div>
  <p class="small muted hint">Invent them. Describe exactly what each one does; the referee won't let it do more.</p>
  {#each abilities as a, i}
    <div class="ability card">
      <input bind:value={a.name} maxlength="40" placeholder="Call the Squall" aria-label="Ability name" />
      <textarea bind:value={a.description} rows="2" maxlength="240" placeholder="A violent gust knocks one person or object off their feet. Needs open air." aria-label="What it does"></textarea>
      <div class="row">
        <span class="small muted grow">Uses per rest</span>
        <select bind:value={a.usesPerRest} aria-label="Uses per rest" style="width:auto">
          <option value={0}>unlimited (minor)</option>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
        <button type="button" class="ghost danger" onclick={() => abilities.splice(i, 1)}>Remove</button>
      </div>
    </div>
  {/each}
  {#if abilities.length < MAX_ABILITIES}
    <button type="button" class="ghost" onclick={() => abilities.push({ name: "", description: "", usesPerRest: 1 })}>+ Add ability</button>
  {/if}

  <span class="lbl">Starting items</span>
  <p class="small muted hint">One per line, e.g. "2x Healing potion".</p>
  {#each items as _, i}
    <input class="item" bind:value={items[i]} maxlength="44" placeholder={["Cutlass", "2x Healing potion", "Spyglass"][i] ?? ""} />
  {/each}
  {#if items.length < MAX_ITEMS}
    <button type="button" class="ghost" onclick={() => items.push("")}>+ Add item</button>
  {/if}

  <label for="backstory">Backstory (optional, the DM uses it)</label>
  <textarea id="backstory" bind:value={backstory} rows="3" maxlength="500"></textarea>

  <label for="pin">PIN (optional, 4 digits, so nobody else can take this character)</label>
  <input id="pin" bind:value={pin} inputmode="numeric" maxlength="4" placeholder="1234" />

  <div class="row actions">
    <button type="button" class="ghost" onclick={onCancel}>Back</button>
    <button type="submit" class="primary grow" disabled={!valid}>Create character</button>
  </div>
</form>

<style>
  form {
    padding-bottom: 2rem;
  }
  .between {
    justify-content: space-between;
  }
  .hint {
    margin: 0 0 0.5rem;
  }
  .stats {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .stat {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.4rem 0.6rem;
  }
  .sname {
    text-transform: capitalize;
    font-weight: 600;
  }
  .step {
    width: 44px;
    padding: 0;
    font-size: 1.3rem;
  }
  .val {
    width: 3.2rem;
    text-align: center;
    font-weight: 700;
    font-size: 1.15rem;
  }
  .val span {
    display: block;
    font-weight: 400;
  }
  .ability {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: 0.5rem;
    padding: 0.6rem;
  }
  .item {
    margin-bottom: 0.35rem;
  }
  .actions {
    margin-top: 1.25rem;
  }
</style>
