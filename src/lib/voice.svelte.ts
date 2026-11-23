// Reads DM messages aloud on the main screen, one segment after another:
// narration in the narrator voice, NPC lines in their own voice.
import type { Message, VoiceMode } from "../../shared/types";
import { parseSpeech, type Segment } from "../../shared/speech";

export interface VoiceNpc {
  id: string;
  name: string;
  gender: string;
  age: string;
}

const LANG: Record<string, string> = { english: "en", german: "de", deutsch: "de", spanish: "es", french: "fr", italian: "it", dutch: "nl", portuguese: "pt" };

export class Narrator {
  speakingId = $state<number | null>(null);
  needsGesture = $state(false); // browser blocked autoplay: the screen must be clicked once
  error = $state<string | null>(null);

  replayFallback: VoiceMode = "browser"; // set to "elevenlabs" when it is configured
  private queue: { m: Message; npcs: VoiceNpc[] }[] = [];
  private audio: HTMLAudioElement | null = null;
  private generation = 0; // bumps on stop(), so stale playback loops end

  constructor(
    private code: string,
    private getMode: () => VoiceMode,
    private getLanguage: () => string,
  ) {}

  enqueue(m: Message, npcs: VoiceNpc[]) {
    if (this.getMode() === "off") return;
    this.queue.push({ m, npcs });
    if (this.speakingId === null) this.next();
  }

  replay(m: Message, npcs: VoiceNpc[]) {
    this.stop();
    this.queue = [{ m, npcs }];
    this.next(true);
  }

  stop() {
    this.generation++;
    this.queue = [];
    this.audio?.pause();
    this.audio = null;
    if ("speechSynthesis" in window) speechSynthesis.cancel();
    this.speakingId = null;
  }

  // Called from a click: retries what autoplay blocked.
  unlock() {
    this.needsGesture = false;
    if (this.pendingRetry) {
      const r = this.pendingRetry;
      this.pendingRetry = null;
      this.queue.unshift(r);
      this.next(true);
    }
  }
  private pendingRetry: { m: Message; npcs: VoiceNpc[] } | null = null;

  private async next(forced = false) {
    const item = this.queue.shift();
    if (!item) {
      this.speakingId = null;
      return;
    }
    const mode = this.getMode() === "off" ? this.replayFallback : this.getMode(); // ▶ works even with the voice off
    void forced;
    const gen = this.generation;
    this.speakingId = item.m.id;
    const segments = parseSpeech(item.m.text, item.npcs);
    try {
      if (mode === "browser") await this.playBrowser(segments, item.npcs, gen);
      else await this.playEleven(item.m.id, segments.length, gen);
    } catch (e) {
      if ((e as Error).name === "NotAllowedError") {
        this.needsGesture = true;
        this.pendingRetry = item;
        this.speakingId = null;
        return;
      }
      this.error = (e as Error).message;
      setTimeout(() => (this.error = null), 6000);
    }
    if (gen === this.generation) this.next();
  }

  private async playEleven(messageId: number, count: number, gen: number) {
    // Fetch the next segment while the current one plays.
    const url = (i: number) => `/api/tts/${this.code}/${messageId}/${i}`;
    let upcoming = count > 0 ? this.load(url(0)) : null;
    for (let i = 0; i < count && gen === this.generation; i++) {
      const el = upcoming!;
      upcoming = i + 1 < count ? this.load(url(i + 1)) : null;
      this.audio = el;
      await new Promise<void>((resolve, reject) => {
        el.onended = () => resolve();
        el.onerror = () => reject(new Error("Couldn't play the ElevenLabs voice (check the API key and credits)."));
        el.play().catch(reject);
      });
    }
  }

  private load(src: string) {
    const a = new Audio(src);
    a.preload = "auto";
    return a;
  }

  private async playBrowser(segments: Segment[], npcs: VoiceNpc[], gen: number) {
    if (!("speechSynthesis" in window)) throw new Error("This browser has no built-in voice.");
    const lang = LANG[this.getLanguage().toLowerCase()] ?? "en";
    const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang)) ?? null;
    for (const seg of segments) {
      if (gen !== this.generation) return;
      const u = new SpeechSynthesisUtterance(seg.text);
      u.voice = voice;
      u.lang = voice?.lang ?? lang;
      u.rate = 0.98;
      if (seg.kind === "npc") {
        // Same system voice, but pitch and pace per NPC so speakers stay distinct.
        const npc = npcs.find((n) => n.id === seg.npcId);
        u.pitch = npc?.gender === "female" ? 1.3 : npc?.gender === "male" ? 0.75 : 1.05;
        if (npc?.age === "old") (u.rate = 0.85), (u.pitch -= 0.1);
        if (npc?.age === "young") (u.rate = 1.08), (u.pitch += 0.1);
      }
      await new Promise<void>((resolve) => {
        u.onend = () => resolve();
        u.onerror = () => resolve();
        speechSynthesis.speak(u);
      });
    }
  }
}
