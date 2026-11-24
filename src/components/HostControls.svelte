<script lang="ts">
  // Host controls: undo/retry the last DM turn, pause, recap, facts and the host PIN.
  // Used on the main screen sidebar and in the host's phone journal.
  import type { GameConnection } from "../lib/game.svelte";
  import type { PublicView } from "../../shared/types";

  let { game, v, compact = false }: { game: GameConnection; v: PublicView; compact?: boolean } = $props();

  let pin = $state("");
  let newFact = $state("");
  let editingFacts = $state(false);
  let pinEdit = $state(false);
  let styleEdit = $state(false);
  // svelte-ignore state_referenced_locally
  let styleNote = $state(v.styleNote);
  let newPin = $state("");

  function undo() {
    if (confirm("Undo the DM's last turn? Its narration, rolls and changes are reverted, and the players' messages go back to 'not sent yet'.")) game.send({ t: "undo_turn" });
  }
  function retry() {
    if (confirm("Retry the DM's last turn? Same messages, fresh dice and a new response.")) game.send({ t: "retry_turn" });
  }
  function removeFact(i: number) {
    game.send({ t: "set_facts", facts: v.facts.filter((_, j) => j !== i) });
  }
  function addFact(e: SubmitEvent) {
    e.preventDefault();
    if (!newFact.trim()) return;
    game.send({ t: "set_facts", facts: [...v.facts, newFact.trim()] });
    newFact = "";
  }
  function savePin(e: SubmitEvent) {
    e.preventDefault();
    game.send({ t: "set_host_pin", pin: newPin.trim() || null });
    newPin = "";
    pinEdit = false;
  }
</script>

{#if !v.canControl}
  {#if v.hasHostPin}
    <form class="card host" onsubmit={(e) => { e.preventDefault(); game.send({ t: "unlock", pin }); pin = ""; }}>
      <h3>🔒 Host controls</h3>
      <div class="row">
        <input bind:value={pin} inputmode="numeric" maxlength="6" placeholder="Host PIN" aria-label="Host PIN" />
        <button class="primary">Unlock</button>
      </div>
    </form>
  {/if}
{:else}
  <div class="card host">
    <h3>Host</h3>
    <div class="grid">
      <button disabled={!v.canUndo || v.busy} onclick={undo} title="Revert the DM's last turn">↶ Undo turn</button>
      <button disabled={!v.canUndo || v.busy} onclick={retry} title="Same messages, new response">↻ Retry turn</button>
      <button disabled={!v.started} onclick={() => game.send({ t: "set_paused", paused: !v.paused })}>{v.paused ? "▶ Resume" : "⏸ Pause"}</button>
      <button disabled={!v.started || v.busy} onclick={() => game.send({ t: "recap" })}>📜 Recap</button>
    </div>

    {#if !compact || editingFacts}
      <div class="row facthead">
        <span class="lbl grow">Established facts ({v.facts.length})</span>
        <button class="ghost tiny" onclick={() => (editingFacts = !editingFacts)}>{editingFacts ? "Done" : "Edit"}</button>
      </div>
      {#if editingFacts}
        <ul class="facts">
          {#each v.facts as f, i}
            <li><span class="grow small">{f}</span><button class="ghost tiny" aria-label="Remove fact" onclick={() => removeFact(i)}>×</button></li>
          {:else}
            <li class="small muted">No facts yet.</li>
          {/each}
        </ul>
        <form class="row" onsubmit={addFact}>
          <input bind:value={newFact} maxlength="300" placeholder="Add a fact the DM must respect" />
          <button>Add</button>
        </form>
      {/if}
    {:else}
      <button class="ghost tiny factbtn" onclick={() => (editingFacts = true)}>Edit facts ({v.facts.length})</button>
    {/if}

    <div class="row facthead">
      <span class="lbl grow">Narration: {v.style}{v.styleNote ? " + notes" : ""}</span>
      <button class="ghost tiny" onclick={() => { styleEdit = !styleEdit; styleNote = v.styleNote; }}>{styleEdit ? "Done" : "Change"}</button>
    </div>
    {#if styleEdit}
      <div class="row seg">
        {#each ["short", "balanced", "rich"] as const as st}
          <button class:on={v.style === st} onclick={() => game.send({ t: "set_style", style: st, styleNote })}>{st}</button>
        {/each}
      </div>
      <form class="row" onsubmit={(e) => { e.preventDefault(); game.send({ t: "set_style", style: v.style, styleNote }); }}>
        <input bind:value={styleNote} maxlength="300" placeholder="Style wishes, e.g. noir, lots of dialogue" />
        <button>Save</button>
      </form>
    {/if}

    <div class="row facthead">
      <span class="lbl grow">Host PIN: {v.hasHostPin ? "on" : "off"}</span>
      <button class="ghost tiny" onclick={() => (pinEdit = !pinEdit)}>{pinEdit ? "Cancel" : v.hasHostPin ? "Change" : "Set"}</button>
    </div>
    {#if pinEdit}
      <form class="row" onsubmit={savePin}>
        <input bind:value={newPin} inputmode="numeric" maxlength="6" placeholder={v.hasHostPin ? "New PIN, empty = off" : "4-6 digits"} />
        <button class="primary">Save</button>
      </form>
      <p class="small muted">With a PIN, a main screen opened from a shared link can't start the game or remove characters until the PIN is entered. The host's phone always works.</p>
    {/if}
  </div>
{/if}

<style>
  .host h3 {
    margin: 0 0 0.5rem;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.4rem;
  }
  .grid button {
    min-height: 38px;
    padding: 0.3rem 0.5rem;
    font-size: 0.9rem;
  }
  .facthead {
    margin-top: 0.75rem;
  }
  .lbl {
    margin: 0;
  }
  .tiny {
    min-height: 0;
    padding: 0.15rem 0.45rem;
    font-size: 0.85rem;
  }
  .factbtn {
    margin-top: 0.6rem;
  }
  .seg {
    margin-top: 0.4rem;
  }
  .seg button {
    flex: 1;
    min-height: 34px;
    padding: 0.2rem;
    text-transform: capitalize;
    font-size: 0.9rem;
  }
  .seg button.on {
    border-color: var(--gold);
    background: var(--gold-soft);
    color: var(--gold);
  }
  .facts {
    list-style: none;
    padding: 0;
    margin: 0.4rem 0;
    max-height: 14rem;
    overflow-y: auto;
  }
  .facts li {
    display: flex;
    gap: 0.4rem;
    align-items: flex-start;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line);
  }
  form.row {
    margin-top: 0.4rem;
  }
</style>
