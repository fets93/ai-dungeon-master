<script lang="ts">
  import { BACKSTORY_MAX, STATS, modifier, type AbilityKind, type Character, type Stat } from "../../shared/types";
  import HealthBar from "./HealthBar.svelte";
  import Avatar from "./Avatar.svelte";
  import { avatarUrl } from "../../shared/types";
  import { resizeToAvatar } from "../lib/avatar";

  let {
    c,
    code,
    onSaveBackstory,
    onChangeAvatar,
    onSetKind,
  }: {
    c: Character;
    code: string;
    onSaveBackstory?: (text: string) => void;
    onChangeAvatar?: (dataUrl: string | null) => void;
    onSetKind?: (name: string, kind: AbilityKind, boostStat?: Stat) => void;
  } = $props();
  let editingKind = $state<string | null>(null);

  let photoError = $state<string | null>(null);
  async function pickPhoto(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    try {
      photoError = null;
      onChangeAvatar?.(await resizeToAvatar(file));
    } catch (err) {
      photoError = (err as Error).message;
    }
  }

  let editing = $state(false);
  let draft = $state("");
  function startEdit() {
    draft = c.backstory;
    editing = true;
  }
  function save() {
    onSaveBackstory?.(draft.trim());
    editing = false;
  }
</script>

<div class="sheet">
  <div class="row head">
    <Avatar src={avatarUrl(code, c)} name={c.name} size={84} />
    <div class="grow">
      <h2>{c.name}</h2>
      <p class="muted concept">{c.concept}</p>
      {#if onChangeAvatar}
        <label class="pick small">
          <input type="file" accept="image/*" onchange={pickPhoto} hidden />
          <span>{c.avatarVersion ? "Change picture" : "Add a picture"}</span>
        </label>
        {#if photoError}<p class="small bad">{photoError}</p>{/if}
      {/if}
    </div>
  </div>
  <HealthBar health={c.health} max={c.maxHealth} size="lg" />
  {#if c.conditions.length}
    <div class="row wrap conds">
      {#each c.conditions as cond}<span class="chip bad">{cond}</span>{/each}
    </div>
  {/if}

  <h3>Stats</h3>
  <div class="grid">
    {#each STATS as k}
      <div class="stat">
        <div class="small muted cap">{k}</div>
        <div class="num">{c.stats[k]}</div>
        <div class="small muted">{modifier(c.stats[k]) >= 0 ? "+" : ""}{modifier(c.stats[k])}</div>
      </div>
    {/each}
  </div>

  {#if c.effects?.length}
    <div class="row wrap effects">
      {#each c.effects as fx}<span class="chip gold">✨ {fx.name}: advantage on next {fx.stat ?? "roll"}</span>{/each}
    </div>
  {/if}

  <h3>Abilities</h3>
  {#each c.abilities as a}
    <div class="card ab">
      <div class="row">
        <b class="grow">{a.name}</b>
        <button class="ghost kind" title="Change type" onclick={() => (editingKind = editingKind === a.name ? null : a.name)}>
          {a.kind ?? "effect"}{a.kind === "boost" ? `: ${a.boostStat ?? "any"}` : ""}
        </button>
        {#if a.usesPerRest > 0}
          <span class="uses" aria-label="{a.usesLeft} of {a.usesPerRest} uses left">
            {#each Array(a.usesPerRest) as _, i}<span class="pip" class:used={i >= a.usesLeft}></span>{/each}
          </span>
        {:else}
          <span class="chip">unlimited</span>
        {/if}
      </div>
      <div class="small muted">{a.description}</div>
      {#if editingKind === a.name && onSetKind}
        <div class="row wrap kindedit">
          {#each ["effect", "boost", "passive"] as const as k}
            <button class:on={(a.kind ?? "effect") === k} onclick={() => onSetKind(a.name, k, k === "boost" ? (a.boostStat ?? "charm") : undefined)}>{k}</button>
          {/each}
          {#if a.kind === "boost"}
            <select value={a.boostStat ?? ""} aria-label="Boosted stat" onchange={(e) => onSetKind(a.name, "boost", (e.currentTarget.value || undefined) as Stat | undefined)}>
              <option value="">any stat</option>
              {#each STATS as k}<option value={k}>{k}</option>{/each}
            </select>
          {/if}
        </div>
      {/if}
    </div>
  {:else}
    <p class="muted small">No abilities.</p>
  {/each}

  <h3>Inventory</h3>
  {#if c.inventory.length}
    <ul class="inv">
      {#each c.inventory as i}
        <li><span class="grow">{i.name}</span>{#if i.qty > 1}<span class="chip">×{i.qty}</span>{/if}</li>
      {/each}
    </ul>
  {:else}
    <p class="muted small">Empty pockets.</p>
  {/if}

  <div class="row bshead">
    <h3 class="grow">Backstory</h3>
    {#if onSaveBackstory && !editing}<button class="ghost small" onclick={startEdit}>{c.backstory ? "Edit" : "Add"}</button>{/if}
  </div>
  {#if editing}
    <textarea bind:value={draft} rows="10" maxlength={BACKSTORY_MAX} aria-label="Backstory"></textarea>
    <div class="row">
      <span class="small muted grow">{draft.length}/{BACKSTORY_MAX}</span>
      <button class="ghost" onclick={() => (editing = false)}>Cancel</button>
      <button class="primary" onclick={save}>Save</button>
    </div>
  {:else if c.backstory}
    <p class="small story">{c.backstory}</p>
  {:else}
    <p class="muted small">No backstory yet.</p>
  {/if}
</div>

<style>
  .sheet h3 {
    margin-top: 1.25rem;
    font-size: 1.05rem;
  }
  .concept {
    margin: -0.3rem 0 0.4rem;
  }
  .head {
    align-items: center;
    gap: 1rem;
    margin-bottom: 0.75rem;
  }
  .head h2 {
    margin: 0 0 0.3rem;
  }
  .pick {
    margin: 0;
    display: inline-block;
  }
  .pick span {
    color: var(--gold);
    cursor: pointer;
    text-decoration: underline;
  }
  .bad {
    color: var(--bad);
  }
  .conds {
    margin-top: 0.5rem;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0.4rem;
  }
  .stat {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    text-align: center;
    padding: 0.4rem 0.2rem;
  }
  .cap {
    text-transform: capitalize;
    font-size: 0.7rem;
  }
  .num {
    font-size: 1.3rem;
    font-weight: 700;
  }
  .ab {
    padding: 0.6rem 0.75rem;
    margin-bottom: 0.4rem;
  }
  .kind {
    min-height: 0;
    padding: 0.1rem 0.5rem;
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--muted);
  }
  .kindedit {
    margin-top: 0.5rem;
    gap: 0.35rem;
  }
  .kindedit button {
    min-height: 34px;
    padding: 0.2rem 0.6rem;
    text-transform: capitalize;
  }
  .kindedit button.on {
    border-color: var(--gold);
    color: var(--gold);
  }
  .kindedit select {
    width: auto;
    min-height: 34px;
  }
  .effects {
    margin-top: 0.75rem;
  }
  .uses {
    display: flex;
    gap: 4px;
  }
  .pip {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--gold);
  }
  .pip.used {
    background: transparent;
    border: 1px solid var(--line);
  }
  .inv {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  .bshead {
    margin-top: 1.25rem;
  }
  .bshead h3 {
    margin: 0;
  }
  .story {
    white-space: pre-wrap;
  }
  .inv li {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--line);
  }
</style>
