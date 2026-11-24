<script lang="ts">
  import type { Message } from "../../shared/types";
  import { parseSpeech, type SpeechNpc } from "../../shared/speech";
  import Avatar from "./Avatar.svelte";
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
    avatarFor,
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
    avatarFor?: (speaker: string) => string | null;
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
    {#if m.speaker === "DM" && m.kind === "whisper"}
      <p class="secret"><b>🕵 DM, only to you</b> {m.text}</p>
    {:else if m.speaker === "DM"}
      <div class="dm" class:speaking={speakingId === m.id} class:recap={m.kind === "recap"}>
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
        {m.text}{#if m.whisperTo}<span class="tag"> · secret</span>{/if}
      </p>
    {:else}
      <p class="say" class:talk={!m.aloud && !m.whisper} class:whisper={m.whisper}>
        {#if avatarFor}<Avatar src={avatarFor(m.speaker)} name={m.speaker} size={big ? 34 : 24} />{/if}
        <b>{m.speaker}</b>{#if m.whisper}<span class="tag">whisper</span>{:else if !m.aloud}<span class="tag">table talk</span>{/if}
        <span>{m.text}</span>{#if m.castRoll}<span class="cast">🎲 {m.castRoll}</span>{/if}
      </p>
    {/if}
  {/each}

  {#if pending.length}
    <div class="pending">
      <div class="small muted">Not sent yet</div>
      {#each pending as m (m.id)}
        <p class="say pend" class:talk={!m.aloud && !m.whisper} class:whisper={m.whisper}>
          <b>{m.speaker}</b>{#if m.whisper}<span class="tag">whisper</span>{:else if !m.aloud}<span class="tag">table talk</span>{/if}
          <span>{m.text}</span>{#if m.castRoll}<span class="cast">🎲 {m.castRoll}</span>{/if}
          {#if onUnsay && m.playerId === myPlayerId && !m.castRoll}
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
    align-items: center;
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
  .cast {
    flex: 0 !important;
    white-space: nowrap;
    color: var(--gold);
    font-weight: 700;
  }
  .say.whisper {
    border-style: dashed;
    border-color: #6e5a86;
    color: #cfb3ec;
  }
  .say.whisper b {
    color: #cfb3ec;
  }
  .secret {
    border: 1px dashed #6e5a86;
    background: rgba(180, 143, 214, 0.08);
    border-radius: var(--radius);
    padding: 0.5rem 0.7rem;
    font-family: var(--serif);
    color: #e6d6f5;
  }
  .secret b {
    font-family: var(--sans);
    font-size: 0.75rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #cfb3ec;
    display: block;
  }
  .dm.recap {
    font-style: italic;
    border-left-color: var(--talk);
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
