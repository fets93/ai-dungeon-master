<script lang="ts">
  import { GameConnection } from "../lib/game.svelte";
  import Feed from "../components/Feed.svelte";
  import CharacterForm from "../components/CharacterForm.svelte";
  import Sheet from "../components/Sheet.svelte";
  import HealthBar from "../components/HealthBar.svelte";
  import Avatar from "../components/Avatar.svelte";
  import Invite from "../components/Invite.svelte";
  import HostControls from "../components/HostControls.svelte";
  import DiceRoll from "../components/DiceRoll.svelte";
  import { DiceQueue } from "../lib/dice.svelte";
  import { avatarUrl, rosterAvatarUrl } from "../../shared/types";
  import type { NewCharacterInput, PublicCharacter, RosterSummary } from "../../shared/types";

  let { code }: { code: string } = $props();
  // `code` never changes for a mounted view: App re-creates the view with {#key} when it does.

  // svelte-ignore state_referenced_locally
  const game = new GameConnection(code, "phone");
  $effect(() => () => game.destroy());

  let campaignTitle = $state("");
  let campaignSummary = $state("");
  // svelte-ignore state_referenced_locally
  fetch(`/api/campaigns/${code}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((c) => {
      campaignTitle = c?.title ?? "";
      campaignSummary = c?.summary ?? "";
    });

  let name = $state(localStorage.getItem("aidm-name") ?? "");
  let creating = $state(false);
  let tab = $state<"play" | "character" | "journal">("play");
  let text = $state("");
  let channel = $state<"aloud" | "talk" | "whisper">("aloud");
  let pinFor = $state<PublicCharacter | null>(null);
  let pin = $state("");

  const v = $derived(game.view);
  const about = $derived(v?.blurb || v?.idea || "");
  const you = $derived(game.you);
  const me = $derived(you?.character ?? null);
  const claimable = $derived(v ? v.characters.filter((c) => !c.online) : []);
  // Characters already at this table (yours from before, or someone's who is offline), and guests.
  const atTable = $derived(claimable.filter((c) => !c.readyMade));
  const guests = $derived(claimable.filter((c) => c.readyMade));

  // Everyone's saved characters. Ones already in this campaign show up under "At this table".
  let roster = $state<RosterSummary[] | null>(null);
  const loadRoster = () =>
    fetch("/api/roster")
      .then((r) => (r.ok ? r.json() : []))
      .then((r: RosterSummary[]) => (roster = r));
  const saved = $derived((roster ?? []).filter((r) => r.campaignCode !== code));
  let rosterPin = $state<{ id: string; pin: string } | null>(null);
  let copyName = $state("");
  $effect(() => {
    if (v && you && !me && !you.spectator && roster === null) loadRoster();
  });
  $effect(() => {
    if (game.conflict) copyName = `${game.conflict.name} II`;
  });

  function playSaved(r: RosterSummary, e?: Event) {
    e?.preventDefault();
    if (rosterPin?.id !== r.id) {
      rosterPin = { id: r.id, pin: "" };
      return;
    }
    if (!/^\d{4}$/.test(rosterPin.pin)) return;
    game.send({ t: "claim_roster", rosterId: r.id, pin: rosterPin.pin });
  }
  function resolveConflict(mode: "move" | "copy") {
    const c = game.conflict;
    if (!c || !rosterPin) return;
    if (mode === "copy" && !copyName.trim()) return;
    game.send({ t: "claim_roster", rosterId: c.rosterId, pin: rosterPin.pin, mode, ...(mode === "copy" ? { copyName: copyName.trim() } : {}) });
    game.conflict = null;
  }
  const activeId = $derived(v?.combat?.activeId ?? null);
  const myTurn = $derived(!activeId || activeId === me?.id);
  const activeName = $derived(v?.combat?.order.find((o) => o.id === activeId)?.name ?? "");
  const myPending = $derived(v ? v.pending.length : 0);
  const canSend = $derived(!!v && v.started && !v.busy && myPending > 0 && (myTurn || !!you?.isHost));

  $effect(() => {
    if (!myTurn) channel = "talk"; // off-turn in combat: only table talk
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

  // Use ability: pick one of your abilities, then say how or at whom.
  let ability = $state<string | null>(null);
  let pickingAbility = $state(false);

  function say(e?: Event) {
    e?.preventDefault();
    const t = text.trim() || (ability ? "uses it" : "");
    if (!t) return;
    game.send({ t: "say", text: t, aloud: channel === "aloud", whisper: channel === "whisper", ...(ability ? { ability } : {}) });
    text = "";
    ability = null;
  }

  // My own rolls, and enemy attacks aimed at me, get the dice animation.
  const dice = new DiceQueue((r) => !!me && (r.characterId === me.id || r.targetId === me.id));
  $effect(() => {
    if (v) dice.feed(v.log);
  });
  // Casting rolls the die immediately: show it as soon as the cast message appears.
  const seenCasts = new Set<number>();
  let castsPrimed = false;
  $effect(() => {
    if (!v || !you) return;
    const mine = v.pending.filter((m) => m.playerId === you.playerId && m.castRoll);
    if (!castsPrimed) {
      mine.forEach((m) => seenCasts.add(m.id)); // don't replay old casts after a reload
      castsPrimed = true;
      return;
    }
    for (const m of mine)
      if (!seenCasts.has(m.id)) {
        seenCasts.add(m.id);
        dice.push({ characterId: me?.id ?? null, label: `Casting ${m.ability}`, d20: m.castRoll!, mod: 0, total: m.castRoll!, dc: 0, success: true, cast: true });
      }
  });

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
      {#if campaignSummary}<p class="about">{campaignSummary}</p>{/if}
      <label for="pname">Your name <span class="muted">(you, the player)</span></label>
      <input id="pname" bind:value={name} maxlength="24" placeholder="e.g. Anna" autocomplete="given-name" />
      <p class="small muted hint">So the others know who's playing. Your character gets its own name in the next step.</p>
      <button class="primary wide" disabled={!name.trim() || !game.connected}>Join as player</button>
    </form>
  {:else if !v || !you}
    <div class="pad center"><p class="muted">Connecting…</p></div>
  {:else if creating}
    <div class="pad scroll"><CharacterForm onSubmit={create} onCancel={() => (creating = false)} {about} /></div>
  {:else if !me && !you.spectator}
    <!-- Step 2: pick a role -->
    <div class="pad scroll">
      <p class="muted small">Hi {you.name}! {v.started ? "The story is already running." : ""}</p>
      <h1>{v.title}</h1>
      {#if about}<p class="about">{about}</p>{:else if v.busy}<p class="muted small"><span class="thinking">The DM is writing the story</span></p>{/if}
      <button class="primary wide" onclick={() => (creating = true)}>Create a new character</button>

      {#snippet pickCard(c: PublicCharacter)}
        <div class="card pick">
          <Avatar src={avatarUrl(code, c)} name={c.name} size={44} />
          <div class="grow">
            <b>{c.name}</b>
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
      {/snippet}

      {#if atTable.length}
        <h3>At this table</h3>
        {#each atTable as c (c.id)}{@render pickCard(c)}{/each}
      {/if}

      {#if saved.length}
        <h3>Saved characters</h3>
        <p class="small muted">Saved characters keep their stats and items from campaign to campaign.</p>
        {#each saved as r (r.id)}
          <div class="card pick">
            <Avatar src={rosterAvatarUrl(r)} name={r.name} size={44} />
            <div class="grow">
              <b>{r.name}</b>
              <div class="small muted">{r.concept}</div>
              <div class="small" class:muted={!r.campaignCode}>{r.campaignCode ? `In "${r.campaignTitle}"` : "Free"}</div>
            </div>
            <button onclick={() => playSaved(r)}>Play</button>
          </div>
          {#if rosterPin?.id === r.id}
            {#if game.conflict?.rosterId === r.id}
              <div class="card conflict">
                <p><b>{r.name}</b> is currently in "{game.conflict.campaignTitle}".</p>
                <button class="primary wide" onclick={() => resolveConflict("move")}>Move {r.name} here</button>
                <p class="small muted">{r.name} leaves "{game.conflict.campaignTitle}" and arrives here rested, with everything they carry.</p>
                <form class="row" onsubmit={(e) => { e.preventDefault(); resolveConflict("copy"); }}>
                  <input bind:value={copyName} maxlength="40" aria-label="Name for the copy" />
                  <button disabled={!copyName.trim()}>Make a copy</button>
                </form>
                <p class="small muted">The copy starts with the same stats and items and goes its own way. The original stays where it is.</p>
                <button class="ghost wide" onclick={() => { game.conflict = null; rosterPin = null; }}>Cancel</button>
              </div>
            {:else}
              <form class="row pinrow" onsubmit={(e) => playSaved(r, e)}>
                <input bind:value={rosterPin.pin} inputmode="numeric" maxlength="4" placeholder="PIN" aria-label="PIN for {r.name}" />
                <button class="primary" disabled={!/^\d{4}$/.test(rosterPin.pin)}>Unlock</button>
              </form>
            {/if}
          {/if}
        {/each}
      {/if}

      {#if guests.length}
        <h3>Guests</h3>
        <p class="small muted">Ready-made characters for a quick start. They stay in this campaign.</p>
        {#each guests as c (c.id)}{@render pickCard(c)}{/each}
      {/if}

      <button class="ghost wide watch" onclick={() => game.send({ t: "spectate" })}>Just watch</button>
    </div>
  {:else}
    <!-- Playing (or spectating) -->
    <header class="top">
      {#if me}<Avatar src={avatarUrl(code, me)} name={me.name} size={36} />{/if}
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
        <Feed log={v.log} pending={v.pending} busy={v.busy} npcs={v.npcs} avatarFor={(s) => { const c = v.characters.find((x) => x.name === s); return c ? avatarUrl(code, c) : null; }} myPlayerId={you.playerId} onUnsay={(id) => game.send({ t: "unsay", id })} />

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
            {#if v.paused}<p class="paused small">⏸ The game is paused. You can still write; sending resumes when the host continues.</p>{/if}
            {#if pickingAbility && me}
              <div class="abilities">
                {#each me.abilities.filter((a) => a.kind !== "passive") as a}
                  <button
                    type="button"
                    disabled={a.usesPerRest > 0 && a.usesLeft <= 0}
                    onclick={() => { ability = a.name; pickingAbility = false; }}>
                    <b>{a.name}</b>
                    <span class="small muted">{a.kind === "boost" ? `boost: ${a.boostStat ?? "any roll"} · ` : ""}{a.usesPerRest > 0 ? `${a.usesLeft}/${a.usesPerRest} left` : "unlimited"}</span>
                  </button>
                {:else}
                  <p class="small muted">No abilities to cast (passive ones are always on).</p>
                {/each}
              </div>
            {/if}
            <div class="row toggle">
              <button type="button" class="aloud" class:on={channel === "aloud"} disabled={!myTurn} onclick={() => (channel = "aloud")}>🗣 Aloud</button>
              <button type="button" class="talk" class:on={channel === "talk"} onclick={() => (channel = "talk")}>💬 Table talk</button>
              <button type="button" class="whisper" class:on={channel === "whisper"} disabled={!myTurn} onclick={() => (channel = "whisper")}>🕵 Whisper</button>
            </div>
            <div class="row abilityrow">
              {#if ability}
                <span class="chip gold">✨ {ability}</span>
                <button type="button" class="ghost tiny" aria-label="Cancel ability" onclick={() => (ability = null)}>×</button>
              {:else}
                <button type="button" class="ghost tiny usebtn" disabled={!myTurn || !me?.abilities.some((a) => a.kind !== "passive")} onclick={() => (pickingAbility = !pickingAbility)}>✨ Use ability</button>
              {/if}
            </div>
            <div class="row">
              <textarea
                bind:value={text}
                onkeydown={onKey}
                rows="2"
                maxlength="600"
                placeholder={ability ? `How or at whom do you use ${ability}?` : channel === "aloud" ? `What does ${me?.name} say or do?` : channel === "talk" ? "Only the table hears this, not the NPCs" : "A secret action: only the DM sees this"}
              ></textarea>
              <button class="say" disabled={!text.trim() && !ability}>{ability ? "Cast ✨" : "Add"}</button>
            </div>
            <button type="button" class="primary wide send" disabled={!canSend || v.paused} onclick={() => game.send({ t: "send_to_dm" })}>
              {#if v.busy}<span class="thinking">DM is thinking</span>
              {:else if v.paused}Paused
              {:else if !myTurn}Waiting for {activeName}
              {:else}Send to DM{myPending ? ` (${myPending})` : ""}{/if}
            </button>
          </form>
        {/if}
      </section>
    {:else if tab === "character"}
      <section class="pad scroll">
        {#if me}
          <Sheet c={me} {code} onSaveBackstory={(text) => game.send({ t: "update_backstory", text })} onChangeAvatar={(dataUrl) => game.send({ t: "set_avatar", dataUrl })} onSetKind={(name, kind, boostStat) => game.send({ t: "set_ability_kind", name, kind, boostStat })} />
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
        {#if you.isHost}<HostControls {game} {v} compact />{/if}
        <h3>Invite friends</h3>
        <Invite {code} title={v.title} />
        {#if about}<h3>About this campaign</h3><p class="serif">{about}</p>{/if}
        {#if v.scene}<h3>Where you are</h3><p class="serif">{v.scene}</p>{/if}
        {#if v.summary}<h3>The story so far</h3><p class="serif">{v.summary}</p>{/if}
        <h3>People you've met</h3>
        {#each v.npcs as n}<p><b>{n.name}</b> <span class="muted small">· {n.attitude}</span></p>{:else}<p class="muted small">Nobody yet.</p>{/each}
        <h3>What you know</h3>
        {#each v.facts as f}<p class="fact">{f}</p>{:else}<p class="muted small">Nothing yet.</p>{/each}
        <h3>Party</h3>
        {#each v.characters.filter((c) => c.playerName) as c}
          <div class="row partyrow"><Avatar src={avatarUrl(code, c)} name={c.name} size={28} /><span class="dot" class:on={c.online}></span><span class="grow">{c.name}</span><span class="small muted">{c.health}/{c.maxHealth}</span></div>
        {/each}
      </section>
    {/if}

    <nav class="tabs">
      <button class:on={tab === "play"} onclick={() => (tab = "play")}>Play{#if myPending && tab !== "play"} •{/if}</button>
      <button class:on={tab === "character"} onclick={() => (tab = "character")}>Character</button>
      <button class:on={tab === "journal"} onclick={() => (tab = "journal")}>Journal</button>
    </nav>
  {/if}

  {#if dice.current}
    {#key dice.current}<DiceRoll roll={dice.current} onDone={dice.next} />{/key}
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
  .hint {
    margin: 0.4rem 0 0;
  }
  .conflict {
    display: grid;
    gap: 0.5rem;
    margin: 0.25rem 0 0.75rem;
  }
  .conflict p {
    margin: 0;
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
  .toggle button.talk.on {
    border-color: var(--talk);
    background: rgba(143, 169, 201, 0.14);
    color: var(--talk);
  }
  .toggle button.whisper.on {
    border-color: #b48fd6;
    background: rgba(180, 143, 214, 0.15);
    color: #cfb3ec;
  }
  .abilities {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    max-height: 40vh;
    overflow-y: auto;
  }
  .abilities button {
    display: flex;
    justify-content: space-between;
    align-items: center;
    text-align: left;
    gap: 0.5rem;
  }
  .abilityrow {
    min-height: 32px;
  }
  .tiny {
    min-height: 32px;
    padding: 0.2rem 0.6rem;
    font-size: 0.9rem;
  }
  .usebtn {
    color: var(--gold);
  }
  .paused {
    margin: 0;
    color: var(--gold);
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
  .about {
    font-family: var(--serif);
    color: #d9cfbf;
    line-height: 1.5;
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
