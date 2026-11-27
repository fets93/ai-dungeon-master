<script lang="ts">
  import {
    BACKSTORY_MAX,
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

  import Avatar from "./Avatar.svelte";
  import { resizeToAvatar } from "../lib/avatar";

  let { onSubmit, onCancel, about = "" }: { onSubmit: (c: NewCharacterInput) => void; onCancel: () => void; about?: string } = $props();

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
  let avatar = $state<string | null>(null);
  let avatarError = $state<string | null>(null);

  async function pickPhoto(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      avatarError = null;
      avatar = await resizeToAvatar(file);
    } catch (err) {
      avatarError = (err as Error).message;
    }
  }
  let concept = $state("");
  let backstory = $state("");
  let pin = $state("");
  let stats = $state(Object.fromEntries(STATS.map((k) => [k, STAT_BASE])) as Record<Stat, number>);
  let abilities = $state<{ name: string; description: string; usesPerRest: number; kind: "effect" | "boost" | "passive"; boostStat?: Stat }[]>([
    { name: "", description: "", usesPerRest: 1, kind: "effect" },
  ]);
  let items = $state(["", "", ""]);

  const used = $derived(statPointsUsed(stats));
  const left = $derived(STAT_POINTS - used);
  const health = $derived(maxHealthFor(stats.stamina));
  const valid = $derived(name.trim().length > 0 && left >= 0 && /^\d{4}$/.test(pin));

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
      avatar,
    });
  }
</script>

<form onsubmit={submit}>
  <h2>New character</h2>
  {#if about}<p class="about small">{about}</p>{/if}

  <label for="cname">Character name</label>
  <input id="cname" bind:value={name} maxlength="24" placeholder="Veyra" autocomplete="off" />

  <div class="photo row">
    <Avatar src={avatar} name={name || "?"} size={72} />
    <div class="grow">
      <label class="pick">
        <input type="file" accept="image/*" onchange={pickPhoto} hidden />
        <span>{avatar ? "Change picture" : "Add a picture"}</span>
      </label>
      {#if avatar}<button type="button" class="ghost small" onclick={() => (avatar = null)}>Remove</button>{/if}
      <p class="small muted">Optional. Your photo, a drawing, anything; it's cropped to a circle.</p>
      {#if avatarError}<p class="small bad">{avatarError}</p>{/if}
    </div>
  </div>

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
      <div class="row kinds">
        {#each [["effect", "Effect"], ["boost", "Boost"], ["passive", "Passive"]] as const as [k, label]}
          <button type="button" class:on={a.kind === k} onclick={() => { a.kind = k; if (k === "passive") a.usesPerRest = 0; else if (a.usesPerRest === 0) a.usesPerRest = 1; }}>{label}</button>
        {/each}
      </div>
      <p class="small muted kindhelp">
        {#if a.kind === "effect"}Does something (a gust of wind, a fireball). Rolls the dice when cast.
        {:else if a.kind === "boost"}Makes your next roll of one stat more likely to succeed (advantage: roll two dice, keep the higher).
        {:else}Always on, never cast (a sixth sense, knowing the streets).{/if}
      </p>
      {#if a.kind === "boost"}
        <div class="row">
          <span class="small muted grow">Boosts rolls of</span>
          <select bind:value={a.boostStat} aria-label="Boosted stat" style="width:auto">
            <option value={undefined}>any stat</option>
            {#each STATS as k}<option value={k}>{k}</option>{/each}
          </select>
        </div>
      {/if}
      <div class="row" hidden={a.kind === "passive"}>
        <span class="small muted grow">Uses per rest</span>
        <select bind:value={a.usesPerRest} aria-label="Uses per rest" style="width:auto">
          <option value={0}>unlimited</option>
          <option value={1}>1</option>
          <option value={2}>2</option>
          <option value={3}>3</option>
        </select>
        <button type="button" class="ghost danger" onclick={() => abilities.splice(i, 1)}>Remove</button>
      </div>
    </div>
  {/each}
  {#if abilities.length < MAX_ABILITIES}
    <button type="button" class="ghost" onclick={() => abilities.push({ name: "", description: "", usesPerRest: 1, kind: "effect" })}>+ Add ability</button>
  {/if}

  <span class="lbl">Starting items</span>
  <p class="small muted hint">One per line, e.g. "2x Healing potion".</p>
  {#each items as _, i}
    <input class="item" bind:value={items[i]} maxlength="44" placeholder={["Cutlass", "2x Healing potion", "Spyglass"][i] ?? ""} />
  {/each}
  {#if items.length < MAX_ITEMS}
    <button type="button" class="ghost" onclick={() => items.push("")}>+ Add item</button>
  {/if}

  <label for="backstory">Backstory (optional, the DM weaves it into the story)</label>
  <textarea id="backstory" bind:value={backstory} rows="6" maxlength={BACKSTORY_MAX}></textarea>
  <p class="small muted count">{backstory.length}/{BACKSTORY_MAX}</p>

  <label for="pin">PIN (4 digits)</label>
  <input id="pin" bind:value={pin} inputmode="numeric" maxlength="4" placeholder="1234" required />
  <p class="small muted hint">Your character lives on after this campaign. You need the PIN to play it again, in this or any other campaign.</p>
  {#if pin && !/^\d{4}$/.test(pin)}<p class="small warn">Exactly 4 digits.</p>{/if}

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
  .warn {
    color: var(--danger, #e66);
    margin: 0.25rem 0 0;
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
  .kinds button {
    flex: 1;
    min-height: 36px;
    padding: 0.2rem;
    font-size: 0.9rem;
  }
  .kinds button.on {
    border-color: var(--gold);
    background: var(--gold-soft);
    color: var(--gold);
  }
  .kindhelp {
    margin: 0;
  }
  .item {
    margin-bottom: 0.35rem;
  }
  .about {
    font-family: var(--serif);
    color: #d9cfbf;
    border-left: 2px solid var(--gold);
    padding-left: 0.75rem;
    margin: 0 0 0.5rem;
  }
  .photo {
    margin-top: 0.75rem;
    align-items: flex-start;
    gap: 0.9rem;
  }
  .photo p {
    margin: 0.3rem 0 0;
  }
  .pick {
    display: inline-block;
    margin: 0;
  }
  .pick span {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 0 0.9rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: 0.95rem;
    cursor: pointer;
  }
  .bad {
    color: var(--bad);
  }
  .count {
    text-align: right;
    margin: 0.2rem 0 0;
  }
  .actions {
    margin-top: 1.25rem;
  }
</style>
