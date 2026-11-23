// End-to-end test against `wrangler dev` with MOCK_LLM=1.
// Simulates a main screen and three phones: join, create/claim characters, talk, table talk,
// Send to DM, combat turns, a late joiner, rejoin with a device token, and the library API.
//   npm run dev:worker   (in another terminal, with MOCK_LLM=1 in .dev.vars)
//   npm run e2e
import WebSocket from "ws";
import type { NewCharacterInput, ServerMsg } from "../shared/types";

const BASE = process.env.BASE ?? "http://localhost:8787";
const WS_BASE = BASE.replace(/^http/, "ws");
let failures = 0;
const check = (cond: unknown, label: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Client {
  ws!: WebSocket;
  last: Extract<ServerMsg, { t: "state" }> | null = null;
  token = "";
  errors: string[] = [];
  constructor(public label: string) {}
  async connect(code: string) {
    this.ws = new WebSocket(`${WS_BASE}/ws/${code}`);
    this.ws.on("message", (d) => {
      const m = JSON.parse(String(d)) as ServerMsg;
      if (m.t === "state") this.last = m;
      if (m.t === "welcome") this.token = m.token;
      if (m.t === "error") this.errors.push(m.message);
    });
    await new Promise((r) => this.ws.once("open", r));
  }
  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  async until(pred: () => boolean, label: string, ms = 5000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (pred()) return true;
      await sleep(30);
    }
    console.log(`  (timeout waiting for: ${label})`);
    return false;
  }
  get view() {
    return this.last!.view;
  }
  get you() {
    return this.last?.you ?? null;
  }
}

const char = (name: string, extra: Partial<NewCharacterInput> = {}): NewCharacterInput => ({
  name,
  concept: "Test hero",
  backstory: "",
  stats: { strength: 14, agility: 12, intelligence: 10, wisdom: 10, charm: 10, stamina: 12, resist: 10 },
  abilities: [{ name: "Lucky Break", description: "Once per rest, reroll a bad situation.", usesPerRest: 1 }],
  items: ["2x Healing potion", "Sword"],
  pin: "",
  ...extra,
});

async function main() {
  // Library: create a campaign
  const res = await fetch(`${BASE}/api/campaigns`, { method: "POST", body: JSON.stringify({ title: "", prompt: "heist in a floating city", strictness: "hardcore" }) });
  const { code } = (await res.json()) as { code: string };
  check(res.status === 201 && /^[A-Z]{4}$/.test(code), `create campaign -> ${code}`);
  const list = (await (await fetch(`${BASE}/api/campaigns`)).json()) as any[];
  check(list.some((c) => c.code === code), "campaign appears in the library");
  check((await fetch(`${BASE}/api/campaigns/ZZZZ`)).status === 404, "unknown code -> 404");

  const screen = new Client("screen");
  await screen.connect(code);
  screen.send({ t: "hello", role: "screen" });
  await screen.until(() => !!screen.last, "screen state");
  check(screen.view.characters.filter((c) => c.readyMade).length === 3, "3 ready-made characters available");

  const a = new Client("anna");
  await a.connect(code);
  a.send({ t: "hello", role: "phone" });
  a.send({ t: "join", name: "Anna" });
  await a.until(() => !!a.you && !!a.token, "anna joined");
  check(a.you?.isHost, "first player is host");

  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  a.send({ t: "create_character", character: char("Thorin", { pin: "1234", avatar: PNG }) });
  await a.until(() => !!a.you?.character, "anna character");
  check(a.you?.character?.name === "Thorin" && a.you.character.maxHealth === 16, "character created with health from stamina");
  check(a.you?.character?.inventory.find((i) => i.name === "Healing potion")?.qty === 2, "item quantity parsed from '2x'");

  const thorinPub = () => screen.view.characters.find((x) => x.name === "Thorin")!;
  await screen.until(() => !!screen.view.characters.find((x) => x.name === "Thorin"), "thorin on screen");
  check(thorinPub().avatarVersion === 1, "portrait stored with the new character");
  const av = await fetch(`${BASE}/api/avatar/${code}/${thorinPub().id}?v=1`);
  check(av.ok && av.headers.get("content-type") === "image/png" && (await av.arrayBuffer()).byteLength === 70, "portrait served as an image");
  check(!JSON.stringify(screen.last).includes("iVBORw0K"), "portrait is not inside the game updates");
  a.send({ t: "set_avatar", dataUrl: "data:text/html;base64,PHNjcmlwdD4=" });
  await a.until(() => a.errors.length > 0, "bad avatar");
  check(a.errors.at(-1)?.includes("format"), "non-image upload rejected");
  a.send({ t: "set_avatar", dataUrl: PNG });
  await screen.until(() => thorinPub().avatarVersion === 2, "avatar v2");
  check(thorinPub().avatarVersion === 2, "changing the portrait bumps its version");

  const b = new Client("ben");
  await b.connect(code);
  b.send({ t: "hello", role: "phone" });
  b.send({ t: "join", name: "Ben" });
  await b.until(() => !!b.you, "ben joined");
  b.send({ t: "claim", characterId: "premade-veyra" });
  await b.until(() => b.you?.character?.name === "Veyra", "ben claims Veyra");
  check(b.you?.character?.name === "Veyra", "claim a ready-made character");
  check(!b.you?.isHost, "second player is not host");

  // Cheating checks
  b.send({ t: "create_character", character: char("Overpowered", { stats: { strength: 16, agility: 16, intelligence: 16, wisdom: 16, charm: 16, stamina: 16, resist: 16 } }) });
  await b.until(() => b.errors.length > 0, "stat budget error");
  check(b.errors.at(-1)?.includes("points"), "stat budget enforced by the server");
  b.send({ t: "claim", characterId: a.you!.character!.id, pin: "0000" });
  await b.until(() => b.errors.length > 1, "pin error");
  check(b.errors.at(-1)?.includes("PIN"), "PIN protects a character");

  // Long backstory at creation, then edited later
  const longStory = "A".repeat(2500);
  b.send({ t: "update_backstory", text: longStory });
  await b.until(() => b.you?.character?.backstory.length === 2500, "backstory update");
  check(b.you?.character?.backstory.length === 2500, "long backstory (2500 chars) saved via edit");

  // Privacy: Ben never receives Anna's full sheet
  check(!JSON.stringify(b.last).includes("Lucky Break"), "other players' sheets are not sent to Ben");

  // Begin
  b.send({ t: "begin" });
  await b.until(() => b.errors.length > 2, "non-host begin error");
  check(b.errors.at(-1)?.includes("host"), "only host/screen can begin");
  screen.send({ t: "begin" });
  await screen.until(() => screen.view.started && !screen.view.busy, "opening", 8000);
  check(screen.view.started, "adventure started");
  check(screen.view.title === "The Drowned Lantern", "AI generated the title from the prompt");
  check(screen.view.activeNpc?.name === "Mother Kessa" && screen.view.mode === "conversation", "DM created and activated an NPC");

  // Voice: settings, NPC voice matching, speech endpoint
  const vr = (await (await fetch(`${BASE}/api/voices`)).json()) as any;
  check(vr.configured && vr.voices.length > 0 && vr.credits?.limit > 0, "voices endpoint lists the ElevenLabs library and credits");
  b.send({ t: "set_voice", mode: "elevenlabs" });
  await b.until(() => b.errors.some((e) => e.includes("voice")), "non-host voice error");
  check(b.errors.some((e) => e.includes("voice")), "only screen/host can change the voice");
  screen.send({ t: "set_voice", mode: "elevenlabs" });
  await screen.until(() => screen.view.voiceMode === "elevenlabs", "voice mode");
  check(screen.view.voiceMode === "elevenlabs", "screen switches voice mode to ElevenLabs");
  const kessa = screen.view.npcs.find((n) => n.name === "Mother Kessa");
  check(kessa?.gender === "female" && kessa?.age === "old", "DM gave the NPC voice traits");
  const opening = screen.view.log.find((m) => m.speaker === "DM")!;
  const tts0 = await fetch(`${BASE}/api/tts/${code}/${opening.id}/0`);
  check(tts0.ok && tts0.headers.get("content-type") === "audio/mpeg", "speech endpoint returns MP3 for narration");
  check((await fetch(`${BASE}/api/tts/${code}/99999/0`)).status === 404, "speech endpoint refuses unknown messages");
  check((await fetch(`${BASE}/api/tts/${code}/${opening.id}/50`)).status === 404, "speech endpoint refuses unknown segments");

  // Conversation + table talk, then Send to DM
  a.send({ t: "say", text: "Who stole your ledger?", aloud: true });
  b.send({ t: "say", text: "don't mention the map", aloud: false });
  b.send({ t: "say", text: "I persuade her to tell us", aloud: true });
  await screen.until(() => screen.view.pending.length === 3, "3 pending");
  check(screen.view.pending.length === 3 && screen.view.pending.some((m) => !m.aloud), "pending shows said-aloud and table talk");
  const logBefore = screen.view.log.length;
  a.send({ t: "send_to_dm" });
  await screen.until(() => screen.view.log.length > logBefore + 3 && !screen.view.busy, "dm turn", 8000);
  check(screen.view.pending.length === 0, "pending cleared after Send to DM");
  check(screen.view.log.some((m) => m.kind === "roll" && m.text.startsWith("Veyra rolls charm")), "persuasion rolled server-side");
  check(screen.view.log.at(-1)?.speaker === "DM", "DM narration logged");
  const withLine = screen.view.log.at(-1)!;
  check(withLine.text.includes("{{mother-kessa:"), "DM narration marks NPC dialogue");
  const npcAudio = await fetch(`${BASE}/api/tts/${code}/${withLine.id}/1`);
  check(npcAudio.ok, "speech endpoint reads the NPC line");
  const exp1 = (await (await fetch(`${BASE}/api/campaigns/${code}/export`)).json()) as any;
  const kv = exp1.npcs.find((n: any) => n.id === "mother-kessa")?.voice?.voiceId;
  check(kv === "mock-old-woman" && kv !== exp1.narratorVoiceId, `NPC matched to a fitting voice (${kv}), distinct from narrator (${exp1.narratorVoiceId})`);

  // Impossible claim gets rejected
  a.send({ t: "say", text: "I find a key in my pocket", aloud: true });
  a.send({ t: "send_to_dm" });
  await screen.until(() => screen.view.log.some((m) => m.kind === "rejected") && !screen.view.busy, "rejection", 8000);
  check(screen.view.log.some((m) => m.kind === "rejected"), "impossible action rejected");

  // Consumable used twice, only 2 available: third fails
  a.send({ t: "say", text: "I drink a potion", aloud: true });
  a.send({ t: "say", text: "another potion", aloud: true });
  a.send({ t: "say", text: "and a third potion", aloud: true });
  a.send({ t: "send_to_dm" });
  await a.until(() => !a.view.busy && a.view.pending.length === 0 && !a.you?.character?.inventory.some((i) => i.name === "Healing potion"), "potions", 8000);
  check(!a.you?.character?.inventory.some((i) => i.name === "Healing potion"), "both potions consumed");
  check(screen.view.log.filter((m) => m.kind === "rejected").length === 2, "third potion rejected");

  // Combat: turn order is enforced
  a.send({ t: "say", text: "I attack the thug", aloud: true });
  a.send({ t: "send_to_dm" });
  await screen.until(() => screen.view.mode === "combat" && !screen.view.busy, "combat", 8000);
  check(screen.view.mode === "combat" && screen.view.enemies.length === 1, "combat started with an enemy");
  const order = screen.view.combat!.order.map((o) => o.name);
  check(order.length === 2, `initiative order: ${order.join(", ")}`);
  check(screen.view.combat!.activeId === screen.view.combat!.order[0].id, "first in initiative acts first after combat starts");
  const activeId = screen.view.combat!.activeId;
  const [actor, other] = activeId === a.you!.character!.id ? [a, b] : [b, a];
  other.send({ t: "say", text: "I attack too", aloud: true });
  await other.until(() => other.errors.some((e) => e.includes("not your turn")), "turn error");
  check(other.errors.some((e) => e.includes("not your turn")), "off-turn player cannot act aloud");
  other.send({ t: "say", text: "go for its legs", aloud: false });
  actor.send({ t: "say", text: "I attack the thug", aloud: true });
  const logLen = screen.view.log.length;
  actor.send({ t: "send_to_dm" });
  await screen.until(() => screen.view.log.length > logLen + 2 && !screen.view.busy, "combat turn", 8000);
  check(screen.view.log.some((m) => m.kind === "roll" && m.text.startsWith("Dock Thug attacks")), "enemy attack rolled by the server");
  check(screen.view.combat === null || screen.view.combat.activeId !== activeId, "turn advanced to the next player");

  // Late joiner gets introduced
  const c = new Client("cleo");
  await c.connect(code);
  c.send({ t: "hello", role: "phone" });
  c.send({ t: "join", name: "Cleo" });
  await c.until(() => !!c.you, "cleo joined");
  c.send({ t: "create_character", character: char("Mira") });
  await screen.until(() => screen.view.characters.some((x) => x.name === "Mira" && x.online), "mira online");
  check(screen.view.log.some((m) => m.kind === "join" && m.text.startsWith("Mira")), "late joiner announced");

  // Spectator
  const d = new Client("dan");
  await d.connect(code);
  d.send({ t: "hello", role: "phone" });
  d.send({ t: "join", name: "Dan" });
  await d.until(() => !!d.you, "dan joined");
  d.send({ t: "spectate" });
  await screen.until(() => screen.view.spectators.includes("Dan"), "spectator");
  check(screen.view.spectators.includes("Dan"), "spectator listed on the main screen");
  d.send({ t: "say", text: "hello", aloud: true });
  await d.until(() => d.errors.length > 0, "spectator say error");
  check(d.errors.length > 0, "spectators cannot speak");

  // Rejoin with token after disconnect
  const token = a.token;
  a.ws.close();
  await screen.until(() => !screen.view.characters.find((x) => x.name === "Thorin")!.online, "thorin offline");
  check(!screen.view.characters.find((x) => x.name === "Thorin")!.online, "disconnect shows character offline");
  const a2 = new Client("anna2");
  await a2.connect(code);
  a2.send({ t: "hello", role: "phone", token });
  await a2.until(() => a2.you?.character?.name === "Thorin", "rejoin");
  check(a2.you?.character?.name === "Thorin" && a2.you.isHost, "rejoin with device token restores character and host role");

  // Export + restart
  const exp = await (await fetch(`${BASE}/api/campaigns/${code}/export`)).json();
  check(exp.code === code && exp.players.every((p: any) => p.token === ""), "export works and hides device tokens");
  const rs = await fetch(`${BASE}/api/campaigns/${code}/restart`, { method: "POST" });
  const { code: code2 } = (await rs.json()) as { code: string };
  check(rs.status === 201 && code2 !== code, `restart with same premise -> ${code2}`);
  const imp = await fetch(`${BASE}/api/campaigns/import`, { method: "POST", body: JSON.stringify(exp) });
  const { code: code3 } = (await imp.json()) as { code: string };
  check(imp.status === 201, `import -> ${code3}`);
  check(Object.keys(exp.avatars ?? {}).length === 1, "export includes portraits");
  const thorinId = exp.characters.find((c: any) => c.name === "Thorin").id;
  check((await fetch(`${BASE}/api/avatar/${code3}/${thorinId}?v=1`)).ok, "import restores portraits");
  const lib = (await (await fetch(`${BASE}/api/campaigns`)).json()) as any[];
  check(lib.find((x) => x.code === code)?.party.includes("Thorin"), "library card shows the party");
  check(screen.view.costUsd > 0, `cost tracked: $${screen.view.costUsd}`);

  for (const x of [screen, a2, b, c, d]) x.ws.close();
  await fetch(`${BASE}/api/campaigns/${code2}`, { method: "DELETE" });
  await fetch(`${BASE}/api/campaigns/${code3}`, { method: "DELETE" });
  console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed");
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
