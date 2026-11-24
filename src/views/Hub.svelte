<script lang="ts">
  import type { CampaignSummary, Strictness } from "../../shared/types";
  import { APP_VERSION } from "../../shared/version";
  import Invite from "../components/Invite.svelte";

  let campaigns = $state<CampaignSummary[] | null>(null);
  let error = $state<string | null>(null);
  let joinCode = $state("");
  let creating = $state(false);
  let showForm = $state(false);

  let title = $state("");
  let prompt = $state("");
  let language = $state("English");
  let tone = $state("adventurous with some humor");
  let strictness = $state<Strictness>("standard");
  let hostPin = $state("");
  let style = $state<"short" | "balanced" | "rich">("balanced");
  let styleNote = $state("");

  async function load() {
    try {
      const r = await fetch("/api/campaigns");
      campaigns = await r.json();
    } catch {
      error = "Could not load campaigns.";
    }
  }
  load();

  async function post(url: string, body?: unknown) {
    const r = await fetch(url, { method: "POST", body: body ? JSON.stringify(body) : undefined });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "Something went wrong.");
    return data;
  }

  async function create(e: SubmitEvent) {
    e.preventDefault();
    creating = true;
    try {
      const { code } = await post("/api/campaigns", { title, prompt, language, tone, strictness, hostPin, style, styleNote });
      location.hash = `#/screen/${code}`;
    } catch (err) {
      error = (err as Error).message;
    } finally {
      creating = false;
    }
  }

  async function restart(c: CampaignSummary) {
    if (!confirm(`Start "${c.title}" again from the beginning? The current campaign stays in the library.`)) return;
    const { code } = await post(`/api/campaigns/${c.code}/restart`);
    location.hash = `#/screen/${code}`;
  }

  async function remove(c: CampaignSummary) {
    if (!confirm(`Delete "${c.title}" for good? Export it first if you want a backup.`)) return;
    await fetch(`/api/campaigns/${c.code}`, { method: "DELETE" });
    load();
  }

  async function importFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    try {
      const { code } = await post("/api/campaigns/import", JSON.parse(await file.text()));
      location.hash = `#/screen/${code}`;
    } catch (err) {
      error = (err as Error).message;
    }
  }

  function join(e: SubmitEvent) {
    e.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (/^[A-Z]{4}$/.test(code)) location.hash = `#/play/${code}`;
  }

  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h} h ago`;
    return new Date(t).toLocaleDateString();
  };
</script>

<main>
  <header>
    <h1>🎲 AI Dungeon Master</h1>
    <p class="muted">Open this page on the TV or laptop for the main screen. Players join on their phones.</p>
  </header>

  <section class="card join">
    <h2>Join a game</h2>
    <form class="row" onsubmit={join}>
      <input bind:value={joinCode} maxlength="4" placeholder="CODE" class="code" autocapitalize="characters" autocomplete="off" aria-label="Game code" />
      <button class="primary" disabled={!/^[A-Za-z]{4}$/.test(joinCode.trim())}>Join</button>
    </form>
  </section>

  <section>
    <div class="row between">
      <h2>Campaigns</h2>
      <div class="row">
        <label class="import">
          <input type="file" accept="application/json" onchange={importFile} hidden />
          <span>Import</span>
        </label>
        <button class="primary" onclick={() => (showForm = !showForm)}>{showForm ? "Close" : "+ New campaign"}</button>
      </div>
    </div>

    {#if showForm}
      <form class="card new" onsubmit={create}>
        <label for="idea">Story idea</label>
        <textarea id="idea" bind:value={prompt} rows="3" maxlength="1500" placeholder="A heist in a floating city, dark humor. Leave empty and the AI invents a story that fits your characters."></textarea>
        <div class="cols">
          <div>
            <label for="title">Title (optional)</label>
            <input id="title" bind:value={title} maxlength="80" placeholder="The AI picks one if empty" />
          </div>
          <div>
            <label for="lang">Narration language</label>
            <input id="lang" bind:value={language} list="langs" maxlength="30" />
            <datalist id="langs"><option value="English"></option><option value="German"></option><option value="Spanish"></option><option value="French"></option></datalist>
          </div>
        </div>
        <label for="tone">Tone</label>
        <input id="tone" bind:value={tone} maxlength="120" />
        <span class="lbl">Strictness</span>
        <div class="row seg">
          {#each ["casual", "standard", "hardcore"] as const as s}
            <button type="button" class:primary={strictness === s} onclick={() => (strictness = s)}>{s}</button>
          {/each}
        </div>
        <p class="small muted">How hard the referee rules: casual is forgiving, hardcore punishes reckless ideas.</p>
        <span class="lbl">Narration style</span>
        <div class="row seg">
          {#each [["short", "Short"], ["balanced", "Balanced"], ["rich", "Rich"]] as const as [k, label]}
            <button type="button" class:primary={style === k} onclick={() => (style = k)}>{label}</button>
          {/each}
        </div>
        <p class="small muted">Short: 2-4 sentences. Balanced: a short paragraph. Rich: atmospheric. You can change it during play.</p>
        <input bind:value={styleNote} maxlength="300" placeholder="Optional style wishes, e.g. noir detective, lots of dialogue" aria-label="Style wishes" />
        <label for="hpin">Host PIN (optional, 4-6 digits)</label>
        <input id="hpin" bind:value={hostPin} inputmode="numeric" maxlength="6" placeholder="Locks the main screen's controls" />
        <button class="primary full" disabled={creating}>{creating ? "Creating…" : "Create and open main screen"}</button>
      </form>
    {/if}

    {#if campaigns === null}
      <p class="muted">Loading…</p>
    {:else if campaigns.length === 0}
      <p class="muted">No campaigns yet. Create the first one.</p>
    {:else}
      <div class="list">
        {#each campaigns as c (c.code)}
          <article class="card camp">
            <div class="row between">
              <h3>{c.title}</h3>
              <span class="code muted">{c.code}</span>
            </div>
            <p class="small muted">
              {c.started ? `Last played ${ago(c.lastPlayed)}` : "Not started"}{c.party.length ? ` · ${c.party.join(", ")}` : ""}
            </p>
            {#if c.summary}<p class="sum">{c.summary}</p>{/if}
            <div class="row wrap">
              <a href="#/screen/{c.code}"><button class="primary">{c.started ? "Continue" : "Open"}</button></a>
              <button onclick={() => restart(c)}>Restart same premise</button>
              <a href="/api/campaigns/{c.code}/export" download><button>Export</button></a>
              <button class="ghost danger" onclick={() => remove(c)}>Delete</button>
            </div>
            <div class="inv"><Invite code={c.code} title={c.title} compact /></div>
          </article>
        {/each}
      </div>
    {/if}
  </section>

  <footer class="small muted">Version {APP_VERSION}</footer>

  {#if error}<div class="toast" role="alert">{error}</div>{/if}
</main>

<style>
  main {
    max-width: 860px;
    margin: 0 auto;
    padding: 1.5rem 1rem 4rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }
  header h1 {
    font-size: 2rem;
  }
  .between {
    justify-content: space-between;
  }
  .join form input {
    max-width: 10rem;
    text-transform: uppercase;
    text-align: center;
    font-size: 1.2rem;
  }
  .new {
    margin: 0.75rem 0 1rem;
  }
  .cols {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
  }
  @media (max-width: 560px) {
    .cols {
      grid-template-columns: 1fr;
    }
  }
  .seg button {
    flex: 1;
    text-transform: capitalize;
  }
  .full {
    width: 100%;
    margin-top: 1rem;
  }
  .import {
    margin: 0;
  }
  .import span {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0 1rem;
    border: 1px solid var(--line);
    border-radius: var(--radius);
    color: var(--ink);
    font-size: 1rem;
    cursor: pointer;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-top: 0.75rem;
  }
  .camp h3 {
    margin: 0;
  }
  .inv {
    margin-top: 0.6rem;
    max-width: 28rem;
  }
  .sum {
    font-family: var(--serif);
    color: #d9cfbf;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    margin: 0.25rem 0 0.75rem;
  }
</style>
