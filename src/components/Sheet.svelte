<script lang="ts">
  import { BACKSTORY_MAX, STATS, modifier, type Character } from "../../shared/types";
  import HealthBar from "./HealthBar.svelte";

  let { c, onSaveBackstory }: { c: Character; onSaveBackstory?: (text: string) => void } = $props();

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
  <h2>{c.name}</h2>
  <p class="muted concept">{c.concept}</p>
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

  <h3>Abilities</h3>
  {#each c.abilities as a}
    <div class="card ab">
      <div class="row">
        <b class="grow">{a.name}</b>
        {#if a.usesPerRest > 0}
          <span class="uses" aria-label="{a.usesLeft} of {a.usesPerRest} uses left">
            {#each Array(a.usesPerRest) as _, i}<span class="pip" class:used={i >= a.usesLeft}></span>{/each}
          </span>
        {:else}
          <span class="chip">unlimited</span>
        {/if}
      </div>
      <div class="small muted">{a.description}</div>
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
    margin: -0.3rem 0 0.75rem;
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
