<script lang="ts">
  import QRCode from "qrcode";
  import { untrack } from "svelte";
  import { GameConnection } from "../lib/game.svelte";
  import Feed from "../components/Feed.svelte";
  import HealthBar from "../components/HealthBar.svelte";
  import Avatar from "../components/Avatar.svelte";
  import Invite from "../components/Invite.svelte";
  import HostControls from "../components/HostControls.svelte";
  import DiceRoll from "../components/DiceRoll.svelte";
  import { DiceQueue } from "../lib/dice.svelte";
  import { avatarUrl } from "../../shared/types";
  import { Narrator } from "../lib/voice.svelte";
  import type { VoiceMode, VoicesResponse } from "../../shared/types";

  let { code }: { code: string } = $props();
  // `code` never changes for a mounted view: App re-creates the view with {#key} when it does.

  // svelte-ignore state_referenced_locally
  const game = new GameConnection(code, "screen");
  $effect(() => () => game.destroy());

  // svelte-ignore state_referenced_locally
  const joinUrl = `${location.origin}/#/play/${code}`;
  let qr = $state("");
  QRCode.toDataURL(joinUrl, { margin: 1, width: 360, color: { dark: "#15120f", light: "#f0e7d8" } }).then((u) => (qr = u));

  const v = $derived(game.view);

  // ---- Voice ----
  let voices = $state<VoicesResponse | null>(null);
  const loadVoices = () => fetch("/api/voices").then((r) => r.json()).then((d: VoicesResponse) => {
    voices = d;
    narrator.replayFallback = d.configured && !d.error ? "elevenlabs" : "browser";
  }).catch(() => {});
  // svelte-ignore state_referenced_locally
  const narrator = new Narrator(code, () => game.view?.voiceMode ?? "off", () => game.view?.language ?? "English");
  loadVoices();
  $effect(() => () => narrator.stop());

  // Read new DM messages as they arrive (never the history that was there when the screen opened).
  let lastSeen: number | null = null;
  $effect(() => {
    const view = game.view;
    if (!view) return;
    const dm = view.log.filter((m) => m.speaker === "DM");
    const maxId = dm.at(-1)?.id ?? 0;
    if (lastSeen === null) {
      lastSeen = maxId;
      return;
    }
    const fresh = dm.filter((m) => m.id > lastSeen!);
    untrack(() => fresh.forEach((m) => narrator.enqueue(m, view.npcs)));
    lastSeen = Math.max(lastSeen, maxId);
  });

  const dice = new DiceQueue(() => true); // every public roll, in the corner of the main screen
  $effect(() => {
    if (game.view) dice.feed(game.view.log);
  });

  // Suggest a recap when a running campaign is opened after a break.
  let recapDismissed = $state(false);
  const openedAt = Date.now();
  const suggestRecap = $derived(
    !!v && v.started && v.canControl && !recapDismissed && openedAt - v.lastPlayed > 3 * 3600_000 && !v.log.slice(-3).some((m) => m.kind === "recap"),
  );

  function removeChar(c: { id: string; name: string; readyMade: boolean }, deleteIt: boolean) {
    const q = deleteIt
      ? `Delete ${c.name} for good? Their sheet and picture are removed.`
      : `Take ${c.name} off the table? The character is kept and can be picked again.`;
    if (confirm(q)) game.send({ t: "remove_character", characterId: c.id, deleteIt });
  }

  function setMode(mode: VoiceMode) {
    narrator.stop();
    game.send({ t: "set_voice", mode });
    if (mode === "elevenlabs") loadVoices(); // refresh credits
  }
  const party = $derived(v ? v.characters.filter((c) => c.playerName) : []);
  const avatarFor = (speaker: string) => {
    const c = v?.characters.find((x) => x.name === speaker);
    return c ? avatarUrl(code, c) : null;
  };
  const modeLabel = $derived(
    !v ? "" : v.mode === "combat" ? `Combat · round ${v.combat?.round ?? 1}` : v.mode === "conversation" ? "Conversation" : "Exploration",
  );
</script>

{#snippet voicePanel(v: NonNullable<typeof game.view>)}
      <div class="card voice">
  <div class="row">
    <h3 class="grow">Voice</h3>
    {#if narrator.speakingId !== null}<button class="ghost stop" onclick={() => narrator.stop()}>⏹ Stop</button>{/if}
  </div>
  <div class="row seg">
    <button class:on={v.voiceMode === "off"} disabled={!v.canControl} onclick={() => setMode("off")}>Off</button>
    <button class:on={v.voiceMode === "browser"} disabled={!v.canControl} onclick={() => setMode("browser")}>Browser</button>
    <button
      class:on={v.voiceMode === "elevenlabs"}
      disabled={!voices?.configured || !v.canControl}
      title={voices?.configured ? "" : "Add ELEVENLABS_API_KEY on Cloudflare to enable"}
      onclick={() => setMode("elevenlabs")}>ElevenLabs</button>
  </div>
  {#if v.voiceMode === "elevenlabs" && voices?.voices.length}
    <label for="narrator">Narrator</label>
    <select id="narrator" disabled={!v.canControl} value={v.narratorVoiceId ?? ""} onchange={(e) => game.send({ t: "set_voice", narratorVoiceId: e.currentTarget.value || null })}>
      <option value="">Automatic</option>
      {#each voices.voices as vo}<option value={vo.id}>{vo.name}{vo.gender ? ` · ${vo.gender}` : ""}{vo.accent ? `, ${vo.accent}` : ""}</option>{/each}
    </select>
    <p class="small muted">NPCs get their own matching voices automatically.</p>
  {/if}
  {#if v.voiceMode === "elevenlabs" && voices?.credits}
    <p class="small muted">ElevenLabs credits left: {(voices.credits.limit - voices.credits.used).toLocaleString()} of {voices.credits.limit.toLocaleString()}</p>
  {/if}
  {#if voices?.error}<p class="small bad">ElevenLabs: {voices.error}</p>{/if}
  {#if narrator.error}<p class="small bad">{narrator.error}</p>{/if}
</div>
{/snippet}

{#if game.notFound}
  <main class="center"><h1>No campaign with code {code}</h1><a href="#/">Back to the library</a></main>
{:else if !v}
  <main class="center"><p class="muted">Connecting…</p></main>
{:else if !v.started}
  <!-- Lobby -->
  <main class="lobby">
    <a class="back small" href="#/">← Library</a>
    <h1>{v.title}</h1>
    <div class="about">
      {#if v.blurb}
        <p class="blurb">{v.blurb}</p>
      {:else if v.busy}
        <p class="blurb muted"><span class="thinking">The DM is writing the story</span></p>
      {:else if v.idea}
        <p class="blurb">{v.idea}</p>
      {/if}
      <div class="row wrap">
        <span class="chip">{v.tone}</span>
        <span class="chip">{v.strictness}</span>
        <span class="chip">{v.language}</span>
      </div>
    </div>
    <div class="lobby-grid">
      <div class="card qrcard">
        {#if qr}<img src={qr} alt="QR code to join" />{/if}
        <p>Scan to join, or open <b>{location.host}</b> and enter</p>
        <div class="code big">{v.code}</div>
        <div class="invitebox"><Invite {code} title={v.title} /></div>
        <a class="selfjoin" href="#/play/{code}">Play on this device instead →</a>
        <p class="small muted">Send friends the invite link, not this page: whoever has this page can start the game and remove characters.</p>
      </div>
      <div class="card">
        <h2>At the table</h2>
        {#if party.length === 0}
          <p class="muted">Waiting for players to pick or create characters…</p>
        {/if}
        {#each party as c (c.id)}
          <div class="member">
            <Avatar src={avatarUrl(code, c)} name={c.name} size={64} />
            <span class="dot" class:on={c.online}></span>
            <div class="grow">
              <b>{c.name}</b> <span class="muted small">· {c.playerName}{c.online ? "" : " (offline)"}</span>
              <div class="small muted">{c.concept}</div>
            </div>
            <div class="rm" hidden={!v.canControl}>
              <button class="ghost small" onclick={() => removeChar(c, false)}>Remove</button>
              {#if !c.readyMade}<button class="ghost small danger" onclick={() => removeChar(c, true)}>Delete</button>{/if}
            </div>
          </div>
        {/each}
        {#if v.spectators.length}<p class="small muted">Watching: {v.spectators.join(", ")}</p>{/if}
        <button class="primary begin" disabled={v.busy || party.length === 0 || !v.canControl} onclick={() => game.send({ t: "begin" })}>
          {#if v.busy}<span class="thinking">The DM is preparing the story</span>{:else}Begin the adventure{/if}
        </button>
        <p class="small muted">Offline players are included and can rejoin any time. The host's phone can start it too, and late players can still join after the start.</p>
      </div>
      <div class="lobbyside">
        {@render voicePanel(v)}
        <HostControls {game} {v} compact />
      </div>
    </div>
  </main>
{:else}
  <!-- Game -->
  <main class="game">
    {#if !game.connected}<div class="offline-banner">Reconnecting…</div>{/if}
    <section class="story">
      <header class="row">
        <a class="back small" href="#/">←</a>
        <h1 class="grow">{v.title}</h1>
        {#if v.paused}<span class="chip bad">Paused</span>{/if}
        <span class="chip gold">{modeLabel}</span>
      </header>
      {#if suggestRecap}
        <div class="card recapbar row">
          <span class="grow">Welcome back! Start the session with a "Previously on…" recap?</span>
          <button class="primary" onclick={() => { recapDismissed = true; game.send({ t: "recap" }); }}>Recap</button>
          <button class="ghost" onclick={() => (recapDismissed = true)}>Skip</button>
        </div>
      {/if}
      {#if v.scene}<p class="scene muted">{v.scene}</p>{/if}
      <Feed log={v.log} pending={v.pending} busy={v.busy} big npcs={v.npcs} {avatarFor} speakingId={narrator.speakingId} onReplay={(m) => narrator.replay(m, v.npcs)} />
    </section>

    <aside>
      <div class="card joinbox row">
        {#if qr}<img src={qr} alt="QR code to join" />{/if}
        <div>
          <div class="small muted">Join</div>
          <div class="code">{v.code}</div>
        </div>
      </div>
      <Invite {code} title={v.title} compact />
      <a class="selfjoin small" href="#/play/{code}">Play on this device →</a>

      {@render voicePanel(v)}
      <HostControls {game} {v} compact />

      {#if v.activeNpc && v.mode === "conversation"}
        <div class="card npc">
          <div class="small muted">Talking to</div>
          <div class="npcname">{v.activeNpc.name}</div>
          <div class="small muted">{v.activeNpc.attitude}</div>
        </div>
      {/if}

      {#if v.combat}
        <div class="card">
          <h3>Turn order</h3>
          <ol class="order">
            {#each v.combat.order as o}
              <li class:active={o.id === v.combat.activeId}>{o.name}{#if o.id === v.combat.activeId}<span class="small acting-tag">acting now</span>{/if}</li>
            {/each}
          </ol>
          {#if v.enemies.length}
            <h3>Enemies</h3>
            {#each v.enemies as e}
              <div class="enemy"><span class="grow">{e.name}</span><span class="small muted">defense {e.defense}</span><b>{e.health}</b></div>
            {/each}
          {/if}
        </div>
      {/if}

      <div class="card">
        <h3>Party</h3>
        {#each party as c (c.id)}
          <div class="pc" class:down={c.health === 0} class:acting={v.combat?.activeId === c.id}>
            <div class="row">
              <Avatar src={avatarUrl(code, c)} name={c.name} size={36} />
              <span class="dot" class:on={c.online}></span>
              <b class="grow">{c.name}</b>
              <span class="small muted">{c.playerName}</span>
              <button class="ghost tiny" hidden={!v.canControl} title="Take {c.name} off the table" aria-label="Take {c.name} off the table" onclick={() => removeChar(c, false)}>×</button>
            </div>
            <HealthBar health={c.health} max={c.maxHealth} />
            {#if c.conditions.length}
              <div class="row wrap">{#each c.conditions as cond}<span class="chip bad">{cond}</span>{/each}</div>
            {/if}
          </div>
        {/each}
        {#if v.spectators.length}<p class="small muted">Watching: {v.spectators.join(", ")}</p>{/if}
      </div>

      <p class="small muted cost">API cost so far: ${v.costUsd.toFixed(2)}</p>
    </aside>
  </main>
{/if}

{#if dice.current}
  {#key dice.current}<DiceRoll roll={dice.current} big onDone={dice.next} />{/key}
{/if}
{#if narrator.needsGesture}
  <button class="primary unlock" onclick={() => narrator.unlock()}>🔊 Click to enable sound</button>
{/if}
{#if game.error}<div class="toast" role="alert">{game.error}</div>{/if}

<style>
  .center {
    min-height: 100vh;
    display: grid;
    place-content: center;
    text-align: center;
  }
  .back {
    color: var(--muted);
    text-decoration: none;
  }
  /* Lobby */
  .lobby {
    max-width: 1100px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
  }
  .lobby h1 {
    font-size: clamp(2rem, 4vw, 3.2rem);
    margin: 0.5rem 0 0.75rem;
  }
  .about {
    margin-bottom: 1.5rem;
    max-width: 60rem;
  }
  .blurb {
    font-family: var(--serif);
    font-size: clamp(1.15rem, 1.6vw, 1.45rem);
    line-height: 1.55;
    margin: 0 0 0.75rem;
  }
  .lobby-grid {
    display: grid;
    grid-template-columns: minmax(280px, 420px) 1fr;
    gap: 1.5rem;
    align-items: start;
  }
  @media (max-width: 800px) {
    .lobby-grid {
      grid-template-columns: 1fr;
    }
  }
  .qrcard {
    text-align: center;
  }
  .qrcard img {
    width: 100%;
    max-width: 320px;
    border-radius: 12px;
  }
  .selfjoin {
    display: inline-block;
    margin-top: 0.9rem;
    color: var(--gold);
  }
  .invitebox {
    margin-top: 1rem;
    text-align: left;
  }
  .code.big {
    font-size: 3rem;
    color: var(--gold);
  }
  .member {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    padding: 0.6rem 0;
    border-bottom: 1px solid var(--line);
    font-size: 1.15rem;
  }
  .lobbyside {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .recapbar {
    margin: 0.5rem 0 0.75rem;
    border-color: var(--gold);
  }
  .rm {
    display: flex;
    gap: 0.25rem;
    opacity: 0.55;
  }
  .member:hover .rm {
    opacity: 1;
  }
  .rm button {
    min-height: 32px;
    padding: 0.2rem 0.55rem;
  }
  .tiny {
    min-height: 0;
    padding: 0 0.35rem;
    border: none;
    color: var(--muted);
    font-size: 1.1rem;
    line-height: 1;
  }
  .begin {
    width: 100%;
    margin-top: 1.25rem;
    font-size: 1.2rem;
    min-height: 56px;
  }
  /* Game */
  .game {
    height: 100vh;
    display: grid;
    grid-template-columns: 1fr minmax(280px, 340px);
    grid-template-rows: auto 1fr;
  }
  .offline-banner {
    grid-column: 1 / -1;
  }
  .story {
    display: flex;
    flex-direction: column;
    min-height: 0;
    padding: 1.25rem 1.5rem 0 2rem;
    grid-row: 1 / -1;
  }
  .offline-banner + .story {
    grid-row: 2;
  }
  .story header h1 {
    font-size: clamp(1.4rem, 2vw, 2rem);
    margin: 0;
  }
  .scene {
    font-style: italic;
    margin: 0.4rem 0 0.75rem;
    font-size: 1.05rem;
  }
  .story :global(.feed) {
    flex: 1;
    min-height: 0;
    max-width: 62rem;
  }
  aside {
    border-left: 1px solid var(--line);
    background: #181410;
    padding: 1rem;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    grid-row: 1 / -1;
    grid-column: 2;
  }
  .offline-banner ~ aside {
    grid-row: 2;
  }
  aside h3 {
    font-size: 1rem;
    margin: 0 0 0.5rem;
  }
  .joinbox img {
    width: 84px;
    border-radius: 6px;
  }
  .joinbox .code {
    font-size: 1.6rem;
    color: var(--gold);
  }
  .npcname {
    font-family: var(--serif);
    font-size: 1.4rem;
  }
  .order {
    margin: 0 0 0.75rem;
    padding-left: 1.25rem;
  }
  .order li.active {
    color: var(--gold);
    font-weight: 700;
  }
  .acting-tag {
    margin-left: 0.5rem;
    font-weight: 400;
  }
  .enemy {
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    padding: 0.3rem 0;
    border-bottom: 1px solid var(--line);
  }
  .enemy b {
    color: var(--bad);
    min-width: 2ch;
    text-align: right;
  }
  .pc {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.5rem;
    border-radius: var(--radius);
    margin-bottom: 0.35rem;
  }
  .pc.acting {
    background: var(--gold-soft);
    outline: 1px solid var(--gold);
  }
  .pc.down {
    opacity: 0.55;
  }
  .cost {
    margin-top: auto;
  }
  .voice .seg button {
    flex: 1;
    padding: 0.4rem;
    font-size: 0.9rem;
  }
  .voice .seg button.on {
    border-color: var(--gold);
    background: var(--gold-soft);
    color: var(--gold);
  }
  .voice h3 {
    margin: 0;
  }
  .stop {
    min-height: 32px;
    padding: 0.2rem 0.5rem;
  }
  .bad {
    color: var(--bad);
  }
  .unlock {
    position: fixed;
    top: 1rem;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    font-size: 1.2rem;
    box-shadow: 0 6px 24px #000a;
  }
</style>
