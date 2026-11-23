// NPC speech markup in DM narration: {{npc-id: the exact words they say}}
// The DM writes it; the app renders it as dialogue and reads each part in the right voice.

export interface SpeechNpc {
  id: string;
  name: string;
}

export type Segment = { kind: "narration"; text: string } | { kind: "npc"; npcId: string; name: string; text: string };

const MARKUP = /\{\{\s*([^:{}]{1,60}?)\s*:\s*([\s\S]*?)\}\}/g;

function findNpc(npcs: SpeechNpc[], ref: string): SpeechNpc | undefined {
  const r = ref.trim().toLowerCase();
  return npcs.find((n) => n.id === r || n.name.toLowerCase() === r);
}

export function parseSpeech(text: string, npcs: SpeechNpc[]): Segment[] {
  const out: Segment[] = [];
  const pushNarration = (t: string) => {
    const clean = t.replace(/[ \t]+/g, " ").trim();
    if (!clean) return;
    const last = out.at(-1);
    if (last?.kind === "narration") last.text = `${last.text} ${clean}`;
    else out.push({ kind: "narration", text: clean });
  };
  let pos = 0;
  for (const m of text.matchAll(MARKUP)) {
    pushNarration(text.slice(pos, m.index));
    const words = m[2].trim().replace(/^["“„«]|["”“»]$/g, "");
    const npc = findNpc(npcs, m[1]);
    if (npc && words) out.push({ kind: "npc", npcId: npc.id, name: npc.name, text: words });
    else if (words) pushNarration(`"${words}"`); // unknown speaker: keep the words as narration
    pos = (m.index ?? 0) + m[0].length;
  }
  pushNarration(text.slice(pos));
  return out;
}

// Plain text for summaries and library cards: Mother Kessa: "Who sent you?"
export function plainSpeech(text: string, npcs: SpeechNpc[]): string {
  return text.replace(MARKUP, (_, ref: string, words: string) => {
    const npc = findNpc(npcs, ref);
    return npc ? `${npc.name}: "${words.trim()}"` : `"${words.trim()}"`;
  });
}
