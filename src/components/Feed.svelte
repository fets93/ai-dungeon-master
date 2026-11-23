<script lang="ts">
  import type { Message } from "../../shared/types";
  import { parseSpeech, type SpeechNpc } from "../../shared/speech";
  import { tick } from "svelte";

  let {
    log,
    pending = [],
    busy = false,
    big = false,
    showTableTalk = true,
    myPlayerId = null,
    onUnsay,
    npcs = [],
    onReplay,
    speakingId = null,
  }: {
    log: Message[];
    pending?: Message[];
    busy?: boolean;
    big?: boolean;
    showTableTalk?: boolean;
    myPlayerId?: string | null;
    onUnsay?: (id: number) => void;
    npcs?: SpeechNpc[];
    onReplay?: (m: Message) => void;
    speakingId?: number | null;
  } = $props();

  let box: HTMLDivElement;
  const visible = $derived(log.filter((m) => showTableTalk || m.aloud));

  // Keep the newest message in view when something new arrives.
  $effect(() => {
    void visible.length;
    void pending.length;
    void busy;
    tick().then(() => box?.scrollTo({ top: box.scrollHeight, behavior: "smooth" }));
  });
</script>

<div class="feed" class:big bind:this={box}>
  {#each visible as m (m.id)}
    {#if m.speaker === "DM"}
      <div class="dm" class:speaking={speakingId === m.id}>
        {#each parseSpeech(m.text, npcs) as seg}
          {#if seg.kind === "npc"}
            <span class="line"><b>{seg.name}</b> “{seg.text}”</span>
          {:else}
            <span>{seg.text}</span>
          {/if}{" "}
        {/each}
        {#if onReplay}<button class="ghost replay" aria-label="Read this aloud" title="Read aloud" onclick={() => onReplay(m)}>▶</button>{/if}
      </div>
    {:else if m.speaker === "SYSTEM"}
      <p class="sys {m.kind ?? ''}">
        {#if m.kind === "roll"}🎲{:else if m.kind === "rejected"}✖{:else if m.kind === "join"}➜{:else}•{/if}
        {m.text}
      </p>
    {:else}
      <p class="say" class:talk={!m.aloud}>
        <b>{m.speaker}</b>{#if !m.aloud}<span class="tag">table talk</span>{/if}
        <span>{m.text}</span>
      </p>
    {/if}
  {/each}

  {#if pending.length}
    <div class="pending">
      <div class="small muted">Not sent yet</div>
      {#each pending as m (m.id)}
        <p class="say pend" class:talk={!m.aloud}>
          <b>{m.speaker}</b>{#if !m.aloud}<span class="tag">table talk</span>{/if}
          <span>{m.text}</span>
          {#if onUnsay && m.playerId === myPlayerId}
            <button class="ghost x" aria-label="Remove message" onclick={() => onUnsay(m.id)}>×</button>
          {/if}
        </p>
      {/each}
    </div>
  {/if}

  {#if busy}
    <p class="dm thinking muted">The DM is thinking</p>
  {/if}
</div>

<style>
  .feed {
    overflow-y: auto;
    padding: 0.5rem 0.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    overscroll-behavior: contain;
  }
  p {
    margin: 0;
  }
  .dm {
    font-family: var(--serif);
    font-size: 1.08rem;
    line-height: 1.55;
    padding: 0.2rem 0 0.2rem 0.8rem;
    border-left: 3px solid var(--gold);
  }
  .dm > span {
    white-space: pre-line; /* keep the DM's paragraph breaks */
  }
  .dm .line {
    color: #f3d9a4;
  }
  .dm .line b {
    font-family: var(--sans);
    font-size: 0.75em;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--gold);
    margin-right: 0.15em;
  }
  .dm.speaking {
    border-left-color: var(--good);
  }
  .replay {
    min-height: 0;
    padding: 0 0.4rem;
    border: none;
    font-size: 0.8em;
    color: var(--muted);
    vertical-align: middle;
  }
  .big .dm {
    font-size: clamp(1.25rem, 1.6vw, 1.7rem);
    line-height: 1.6;
  }
  .sys {
    font-size: 0.85rem;
    color: var(--muted);
  }
  .big .sys {
    font-size: 1rem;
  }
  .sys.roll {
    color: var(--gold);
  }
  .sys.rejected {
    color: var(--bad);
  }
  .say {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 0.45rem 0.7rem;
    display: flex;
    gap: 0.5rem;
    align-items: baseline;
    flex-wrap: wrap;
  }
  .big .say {
    font-size: 1.1rem;
  }
  .say b {
    color: var(--gold);
  }
  .say.talk {
    border-style: dashed;
    color: var(--talk);
  }
  .say.talk b {
    color: var(--talk);
  }
  .tag {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    opacity: 0.8;
  }
  .say span:last-of-type {
    flex: 1;
  }
  .pending {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem;
    border: 1px dashed var(--line);
    border-radius: var(--radius);
  }
  .pend {
    opacity: 0.85;
  }
  .x {
    min-height: 0;
    padding: 0 0.4rem;
    border: none;
    font-size: 1.2rem;
    line-height: 1;
    color: var(--muted);
  }
</style>
