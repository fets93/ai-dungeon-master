<script lang="ts">
  import { GameConnection } from "../lib/game.svelte";
  import Feed from "../components/Feed.svelte";
  import CharacterForm from "../components/CharacterForm.svelte";
  import Sheet from "../components/Sheet.svelte";
  import HealthBar from "../components/HealthBar.svelte";
  import type { NewCharacterInput, PublicCharacter } from "../../shared/types";

  let { code }: { code: string } = $props();
  // `code` never changes for a mounted view: App re-creates the view with {#key} when it does.

  // svelte-ignore state_referenced_locally
  const game = new GameConnection(code, "phone");
  $effect(() => () => game.destroy());

  let campaignTitle = $state("");
  // svelte-ignore state_referenced_locally
  fetch(`/api/campaigns/${code}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => (campaignTitle = c?.title ?? ""));

  let name = $state(localStorage.getItem("aidm-name") ?? "");
  let creating = $state(false);
  let tab = $state<"play" | "character" | "journal">("play");
  let text = $state("");
  let aloud = $state(true);
  let pinFor = $state<PublicCharacter | null>(null);
  let pin = $state("");

  const v = $derived(game.view);
  const you = $derived(game.you);
  const me = $derived(you?.character ?? null);
  const claimable = $derived(v ? v.characters.filter((c) => !c.online) : []);
  const activeId = $derived(v?.combat?.activeId ?? null);
  const myTurn = $derived(!activeId || activeId === me?.id);
  const activeName = $derived(v?.combat?.order.find((o) => o.id === activeId)?.name ?? "");
  const myPending = $derived(v ? v.pending.length : 0);
  const canSend = $derived(!!v && v.started && !v.busy && myPending > 0 && (myTurn || !!you?.isHost));

  $effect(() => {
    if (!myTurn) aloud = false; // off-turn in combat: only table talk
  });

  function join(e: SubmitEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    localStorage.setItem("aidm-name", name.trim());
    game.send({ t: "join", name: name.trim() });
  }

  function claim(c: PublicCharacter) {
    if (c.hasPin && !pinFor) {
      pinFor = c;
      pin = "";
      return;
    }
    game.send({ t: "claim", characterId: c.id, pin: c.hasPin ? pin : undefined });
    pinFor = null;
  }

  function create(c: NewCharacterInput) {
    game.send({ t: "create_character", character: c });
    creating = false;
  }

  function say(e?: Event) {
    e?.preventDefault();
    const t = text.trim();
    if (!t) return;
    game.send({ t: "say", text: t, aloud });
    text = "";
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) say(e);
  }
</script>

<div class="phone">
  {#if !game.connected && v}<div class="offline-banner">Reconnecting…</div>{/if}

  {#if game.notFound}
    <div class="pad center">
      <h1>No game with code {code}</h1>
      <a href="#/">Enter another code</a>
    </div>
  {:else if game.needsJoin}
    <!-- Step 1: name -->
    <form class="pad center" onsubmit={join}>
      <p class="muted small">Joining <span class="code">{code}</span></p>
      <h1>{campaignTitle || "AI Dungeon Master"}</h1>
      <label for="pname">Your name</label>
      <input id="pname" bind:value={name} maxlength="24" placeholder="Steffen" autocomplete="nickname" />
      <button class="primary wide" disabled={!name.trim() || !game.connected}>Join</button>
    </form>
  {:else if !v || !you}
    <div class="pad center"><p class="muted">Connecting…</p></div>
  {:else if creating}
    <div class="pad scroll"><CharacterForm onSubmit={create} onCancel={() => (creating = false)} /></div>
  {:else if !me && !you.spectator}
    <!-- Step 2: pick a role -->
    <div class="pad scroll">
      <p class="muted small">Hi {you.name}! {v.started ? "The story is already running." : ""}</p>
      <h1>{v.title}</h1>
      <button class="primary wide" onclick={() => (creating = true)}>Create a new character</button>

      {#if claimable.length}
        <h3>Or take an existing character</h3>
        {#each claimable as c (c.id)}
          <div class="card pick">
            <div class="grow">
              <b>{c.name}</b>
              {#if c.readyMade}<span class="chip">ready-made</span>{/if}
              {#if c.hasPin}<span class="chip">PIN</span>{/if}
              <div class="small muted">{c.concept}{c.playerName ? ` · last played by ${c.playerName}` : ""}</div>
            </div>
            <button onclick={() => claim(c)}>Play</button>
          </div>
          {#if pinFor?.id === c.id}
            <form class="row pinrow" onsubmit={(e) => { e.preventDefault(); claim(c); }}>
              <input bind:value={pin} inputmode="numeric" maxlength="4" placeholder="PIN" aria-label="PIN for {c.name}" />
              <button class="primary">Unlock</button>
            </form>
          {/if}
        {/each}
      {/if}

      <button class="ghost wide watch" onclick={() => game.send({ t: "spectate" })}>Just watch</button>
    </div>
  {:else}
    <!-- Playing (or spectating) -->
    <header class="top">
      <div class="grow">
        <div class="title">{v.title}</div>
        <div class="small muted">
          {#if v.mode === "combat"}Combat · {myTurn ? "your turn" : `${activeName}'s turn`}
          {:else if v.mode === "conversation" && v.activeNpc}Talking to {v.activeNpc.name}
          {:else}Exploration{/if}
        </div>
      </div>
      {#if me}<div class="mini"><HealthBar health={me.health} max={me.maxHealth} size="md" /></div>{/if}
    </header>

    {#if tab === "play"}
      <section class="play">
        <Feed log={v.log} pending={v.pending} busy={v.busy} myPlayerId={you.playerId} onUnsay={(id) => game.send({ t: "unsay", id })} />

        {#if !v.started}
          <div class="pad notice">
            {#if you.isHost}
              <button class="primary wide" disabled={v.busy} onclick={() => game.send({ t: "begin" })}>
                {#if v.busy}<span class="thinking">Preparing the story</span>{:else}Begin the adventure{/if}
              </button>
              <p class="small muted">You're the host. Start when everyone has a character.</p>
            {:else}
              <p class="muted">Waiting for the host to begin the adventure…</p>
            {/if}
          </div>
        {:else if you.spectator}
          <div class="pad notice">
            <p class="muted small">You're watching.</p>
            <button onclick={() => game.send({ t: "leave_character" })}>Pick a character</button>
          </div>
        {:else}
          <form class="composer" onsubmit={say}>
            <div class="row toggle">
              <button type="button" class:on={aloud} disabled={!myTurn} onclick={() => (aloud = true)}>🗣 Say aloud</button>
              <button type="button" class:on={!aloud} onclick={() => (aloud = false)}>🤫 Table talk</button>
            </div>
            <div class="row">
              <textarea
                bind:value={text}
                onkeydown={onKey}
                rows="2"
                maxlength="600"
                placeholder={aloud ? `What does ${me?.name} say or do?` : "Only the table hears this, not the NPCs"}
              ></textarea>
              <button class="say" disabled={!text.trim()}>Add</button>
            </div>
            <button type="button" class="primary wide send" disabled={!canSend} onclick={() => game.send({ t: "send_to_dm" })}>
              {#if v.busy}<span class="thinking">DM is thinking</span>
              {:else if !myTurn}Waiting for {activeName}
              {:else}Send to DM{myPending ? ` (${myPending})` : ""}{/if}
            </button>
          </form>
        {/if}
      </section>
    {:else if tab === "character"}
      <section class="pad scroll">
        {#if me}
          <Sheet c={me} onSaveBackstory={(text) => game.send({ t: "update_backstory", text })} />
          <div class="row wrap actions">
            <button onclick={() => confirm("Let go of this character? You can pick it again later.") && game.send({ t: "leave_character" })}>Switch character</button>
            <button class="ghost" onclick={() => game.send({ t: "spectate" })}>Just watch</button>
          </div>
        {:else}
          <p class="muted">You're watching without a character.</p>
          <button class="primary" onclick={() => game.send({ t: "leave_character" })}>Pick a character</button>
        {/if}
      </section>
    {:else}
      <section class="pad scroll journal">
        <h2>Journal</h2>
        {#if v.scene}<h3>Where you are</h3><p class="serif">{v.scene}</p>{/if}
        {#if v.summary}<h3>The story so far</h3><p class="serif">{v.summary}</p>{/if}
        <h3>People you've met</h3>
        {#each v.npcs as n}<p><b>{n.name}</b> <span class="muted small">· {n.attitude}</span></p>{:else}<p class="muted small">Nobody yet.</p>{/each}
        <h3>What you know</h3>
        {#each v.facts as f}<p class="fact">{f}</p>{:else}<p class="muted small">Nothing yet.</p>{/each}
        <h3>Party</h3>
        {#each v.characters.filter((c) => c.playerName) as c}
          <div class="row partyrow"><span class="dot" class:on={c.online}></span><span class="grow">{c.name}</span><span class="small muted">{c.health}/{c.maxHealth}</span></div>
        {/each}
      </section>
    {/if}

    <nav class="tabs">
      <button class:on={tab === "play"} onclick={() => (tab = "play")}>Play{#if myPending && tab !== "play"} •{/if}</button>
      <button class:on={tab === "character"} onclick={() => (tab = "character")}>Character</button>
      <button class:on={tab === "journal"} onclick={() => (tab = "journal")}>Journal</button>
    </nav>
  {/if}

  {#if game.error}<div class="toast" role="alert">{game.error}</div>{/if}
</div>

<style>
  .phone {
    height: 100dvh;
    display: flex;
    flex-direction: column;
    max-width: 640px;
    margin: 0 auto;
  }
  .pad {
    padding: 1rem;
  }
  .scroll {
    flex: 1;
    overflow-y: auto;
  }
  .center {
    margin: auto 0;
  }
  .wide {
    width: 100%;
    margin-top: 1rem;
  }
  h3 {
    margin-top: 1.5rem;
  }
  .pick {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    padding: 0.75rem;
  }
  .pinrow {
    margin: -0.25rem 0 0.75rem;
  }
  .watch {
    margin-top: 1.5rem;
  }
  .top {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--line);
    background: #181410;
  }
  .title {
    font-family: var(--serif);
    font-weight: 600;
    font-size: 1.05rem;
  }
  .mini {
    width: 110px;
  }
  .play {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .play :global(.feed) {
    flex: 1;
    min-height: 0;
    padding: 0.75rem 1rem;
  }
  .notice {
    border-top: 1px solid var(--line);
    text-align: center;
  }
  .composer {
    border-top: 1px solid var(--line);
    padding: 0.6rem 0.75rem 0.75rem;
    background: #181410;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .toggle button {
    flex: 1;
    min-height: 38px;
    padding: 0.3rem;
    font-size: 0.9rem;
  }
  .toggle button.on {
    border-color: var(--gold);
    background: var(--gold-soft);
    color: var(--gold);
  }
  .toggle button.on:last-child {
    border-color: var(--talk);
    background: rgba(143, 169, 201, 0.14);
    color: var(--talk);
  }
  .composer textarea {
    min-height: 48px;
  }
  .say {
    align-self: stretch;
  }
  .send {
    margin-top: 0;
    min-height: 50px;
    font-size: 1.05rem;
  }
  .tabs {
    display: flex;
    border-top: 1px solid var(--line);
    padding-bottom: env(safe-area-inset-bottom);
    background: #181410;
  }
  .tabs button {
    flex: 1;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--muted);
    min-height: 52px;
  }
  .tabs button.on {
    color: var(--gold);
    box-shadow: inset 0 2px 0 var(--gold);
  }
  .actions {
    margin-top: 1.5rem;
  }
  .serif {
    font-family: var(--serif);
  }
  .fact {
    padding-left: 0.75rem;
    border-left: 2px solid var(--line);
  }
  .partyrow {
    padding: 0.35rem 0;
  }
</style>
