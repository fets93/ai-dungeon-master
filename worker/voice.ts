// ElevenLabs integration: the voice library, matching NPC traits to voices, and speech synthesis.
// ELEVENLABS_MOCK=1 returns a fake library and silent audio for local tests.
import type { NpcVoice, VoiceInfo } from "../shared/types";

const API = "https://api.elevenlabs.io";
export const TTS_MODEL = "eleven_flash_v2_5"; // multilingual, low latency, 0.5 credits per character

export interface VoiceEnv {
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_MOCK?: string;
}

export const voiceConfigured = (env: VoiceEnv) => !!env.ELEVENLABS_API_KEY || env.ELEVENLABS_MOCK === "1";
const isMock = (env: VoiceEnv) => env.ELEVENLABS_MOCK === "1";

const MOCK_VOICES: VoiceInfo[] = [
  { id: "mock-narrator", name: "George", gender: "male", age: "middle_aged", accent: "british", description: "warm storyteller, narration" },
  { id: "mock-old-woman", name: "Grandma", gender: "female", age: "old", accent: "american", description: "raspy, slow" },
  { id: "mock-young-man", name: "Liam", gender: "male", age: "young", accent: "american", description: "energetic" },
  { id: "mock-woman", name: "Sarah", gender: "female", age: "young", accent: "american", description: "soft, calm" },
  { id: "mock-old-man", name: "Bill", gender: "male", age: "old", accent: "american", description: "gruff, deep, gravelly" },
];

const norm = (s: unknown) => String(s ?? "").toLowerCase().trim().replace(/\s+/g, "_");

let cache: { at: number; voices: VoiceInfo[] } | null = null;

export async function listVoices(env: VoiceEnv): Promise<VoiceInfo[]> {
  if (isMock(env)) return MOCK_VOICES;
  if (!env.ELEVENLABS_API_KEY) return [];
  if (cache && Date.now() - cache.at < 3600_000) return cache.voices;
  const voices: VoiceInfo[] = [];
  let token: string | undefined;
  for (let page = 0; page < 5; page++) {
    const url = new URL(`${API}/v2/voices`);
    url.searchParams.set("page_size", "100");
    if (token) url.searchParams.set("next_page_token", token);
    const r = await fetch(url, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } });
    if (!r.ok) throw new Error(`ElevenLabs voices: ${r.status} ${await r.text().catch(() => "")}`.slice(0, 300));
    const data = (await r.json()) as any;
    for (const v of data.voices ?? []) {
      const l = v.labels ?? {};
      voices.push({
        id: v.voice_id,
        name: v.name ?? "Voice",
        gender: norm(l.gender),
        age: norm(l.age),
        accent: norm(l.accent),
        description: [v.description, l.description, l.descriptive, l.use_case].filter(Boolean).join(", ").toLowerCase(),
      });
    }
    if (!data.has_more || !data.next_page_token) break;
    token = data.next_page_token;
  }
  cache = { at: Date.now(), voices };
  return voices;
}

export async function credits(env: VoiceEnv): Promise<{ used: number; limit: number } | undefined> {
  if (isMock(env)) return { used: 1290, limit: 90000 };
  if (!env.ELEVENLABS_API_KEY) return undefined;
  try {
    const r = await fetch(`${API}/v1/user/subscription`, { headers: { "xi-api-key": env.ELEVENLABS_API_KEY } });
    if (!r.ok) return undefined;
    const d = (await r.json()) as any;
    return typeof d.character_count === "number" ? { used: d.character_count, limit: d.character_limit } : undefined;
  } catch {
    return undefined;
  }
}

// Default narrator: a voice described as a narrator or storyteller, otherwise a mature male voice.
export function pickNarrator(voices: VoiceInfo[]): string | null {
  const score = (v: VoiceInfo) =>
    (/narrat|story|audiobook/.test(v.description) ? 5 : 0) + (v.age === "middle_aged" || v.age === "old" ? 2 : 0) + (v.gender === "male" ? 1 : 0);
  return [...voices].sort((a, b) => score(b) - score(a))[0]?.id ?? null;
}

function hash(s: string) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// Best voice for an NPC's described traits; avoids the narrator and voices other NPCs already use.
export function matchVoice(want: NpcVoice, npcId: string, voices: VoiceInfo[], taken: Set<string>, narratorId: string | null): string | null {
  const styleWords = want.style.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3);
  const scored = voices
    .filter((v) => v.id !== narratorId)
    .map((v) => {
      let s = 0;
      if (v.gender === want.gender) s += 4;
      else if (want.gender === "neutral" || !v.gender) s += 1;
      else s -= 6;
      if (v.age === want.age) s += 3;
      else if (v.age && want.age) s += want.age === "middle_aged" || v.age === "middle_aged" ? 1 : 0;
      for (const w of styleWords) if (v.description.includes(w)) s += 1;
      if (taken.has(v.id)) s -= 3;
      return { v, s: s + (hash(npcId + v.id) % 100) / 1000 }; // stable tie-break
    })
    .sort((a, b) => b.s - a.s);
  return scored[0]?.v.id ?? null;
}

// ~0.3s of silent MP3 for mock mode (one MPEG-1 Layer III frame header repeated).
const SILENT_FRAME = new Uint8Array([0xff, 0xfb, 0x90, 0x64, ...new Array(413).fill(0)]);

export async function synthesize(env: VoiceEnv, voiceId: string, text: string): Promise<Response> {
  if (isMock(env)) {
    const body = new Uint8Array(SILENT_FRAME.length * 12);
    for (let i = 0; i < 12; i++) body.set(SILENT_FRAME, i * SILENT_FRAME.length);
    return new Response(body, { headers: { "content-type": "audio/mpeg" } });
  }
  const r = await fetch(`${API}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": env.ELEVENLABS_API_KEY!, "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: TTS_MODEL }),
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => "");
    return Response.json({ error: `ElevenLabs: ${r.status} ${msg}`.slice(0, 400) }, { status: 502 });
  }
  return new Response(r.body, { headers: { "content-type": "audio/mpeg" } });
}
