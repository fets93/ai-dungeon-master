// One Durable Object per campaign: the single source of truth for its state,
// the WebSocket hub for the main screen and the phones, and the place where the DM runs.
import { DurableObject } from "cloudflare:workers";
import {
  BACKSTORY_MAX,
  MAX_ABILITIES,
  MAX_ITEMS,
  STATS,
  STAT_MAX,
  STAT_MIN,
  STAT_POINTS,
  maxHealthFor,
  statPointsUsed,
  type CampaignConfig,
  type CampaignSummary,
  type Character,
  type ClientMsg,
  type GameState,
  type Item,
  type NewCharacterInput,
  type Player,
  type PublicView,
  type ServerMsg,
  type VoiceInfo,
  type VoiceMode,
  type YouView,
} from "../shared/types";
import { parseSpeech, plainSpeech } from "../shared/speech";
import { matchVoice, pickNarrator } from "./voice";
import { opening, sendToDm } from "./game/engine";
import { makeLlm } from "./game/llm";
import { premadeCharacters } from "./game/premades";
import { activeCombatantId } from "./game/rules";
import type { Env } from "./index";

interface Attachment {
  role: "screen" | "phone";
  playerId?: string;
}

export class Campaign extends DurableObject<Env> {
  private s: GameState | null = null;
  private busy = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<GameState>("state")) ?? null;
      if (this.s) {
        // Fields added after the first release: fill defaults for older saves.
        this.s.voiceMode ??= "off";
        this.s.narratorVoiceId ??= null;
      }
    });
  }

  // ---------- RPC from the Worker ----------

  async init(code: string, config: CampaignConfig, carry?: Partial<GameState>): Promise<CampaignSummary> {
    const now = Date.now();
    this.s = {
      code,
      config,
      storyArc: "",
      started: false,
      createdAt: now,
      lastPlayed: now,
      mode: "narration",
      activeNpcId: null,
      scene: "",
      summary: "",
      summarizedUpTo: 0,
      facts: [],
      characters: premadeCharacters(),
      npcs: [],
      enemies: [],
      combat: null,
      players: [],
      log: [],
      pending: [],
      introductions: [],
      nextMsgId: 1,
      costUsd: 0,
      voiceMode: "off",
      narratorVoiceId: null,
      ...carry,
    };
    this.s.code = code;
    this.s.players = [];
    for (const c of this.s.characters) {
      c.ownerId = null;
      c.present = false;
    }
    await this.save();
    return this.summary();
  }

  // Text and voice for one spoken part of a DM message. Text always comes from the log, never from the client.
  async speechSegment(messageId: number, index: number, voices: VoiceInfo[]): Promise<{ text: string; voiceId: string } | null> {
    const s = this.s;
    const m = s?.log.find((x) => x.id === messageId && x.speaker === "DM");
    if (!s || !m) return null;
    const seg = parseSpeech(m.text, s.npcs)[index];
    if (!seg) return null;
    let changed = false;
    if (!s.narratorVoiceId || !voices.some((v) => v.id === s.narratorVoiceId)) {
      s.narratorVoiceId = pickNarrator(voices);
      changed = true;
    }
    let voiceId = s.narratorVoiceId;
    if (seg.kind === "npc") {
      const npc = s.npcs.find((n) => n.id === seg.npcId)!;
      npc.voice ??= { gender: "neutral", age: "middle_aged", style: npc.speechStyle };
      if (!npc.voice.voiceId || !voices.some((v) => v.id === npc.voice!.voiceId)) {
        const taken = new Set(s.npcs.map((n) => n.voice?.voiceId).filter((x): x is string => !!x));
        npc.voice.voiceId = matchVoice(npc.voice, npc.id, voices, taken, s.narratorVoiceId) ?? undefined;
        changed = true;
      }
      voiceId = npc.voice.voiceId ?? voiceId;
    }
    if (changed) {
      await this.save();
      this.broadcast();
    }
    return voiceId ? { text: seg.text, voiceId } : null;
  }

  async exportState(): Promise<GameState | null> {
    return this.s;
  }

  async wipe() {
    for (const ws of this.ctx.getWebSockets()) ws.close(1000, "Campaign deleted");
    await this.ctx.storage.deleteAll();
    this.s = null;
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.s) return new Response("Campaign not found", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("Expected WebSocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ role: "phone" } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---------- WebSocket handlers ----------

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    if (!this.s) return ws.close(1011, "Campaign not found");
    let msg: ClientMsg;
    try {
      msg = JSON.parse(typeof raw === "string" ? raw : new TextDecoder().decode(raw));
    } catch {
      return this.send(ws, { t: "error", message: "Bad message" });
    }
    try {
      await this.handle(ws, msg);
    } catch (e) {
      this.send(ws, { t: "error", message: (e as Error).message });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string) {
    this.gone.add(ws);
    try {
      ws.close(code >= 1000 && code < 5000 && ![1004, 1005, 1006, 1015].includes(code) ? code : 1000, reason);
    } catch {}
    this.broadcast();
  }

  async webSocketError(ws: WebSocket) {
    this.gone.add(ws);
    this.broadcast();
  }

  // Sockets that are closing still show up in getWebSockets() during the close handler.
  private gone = new WeakSet<WebSocket>();
  private sockets() {
    return this.ctx.getWebSockets().filter((ws) => !this.gone.has(ws) && ws.readyState === 1);
  }

  private async handle(ws: WebSocket, msg: ClientMsg) {
    const s = this.s!;
    const att = (ws.deserializeAttachment() ?? { role: "phone" }) as Attachment;
    const player = att.playerId ? s.players.find((p) => p.id === att.playerId) : undefined;
    const needPlayer = () => {
      if (!player) throw new Error("Join the game first.");
      return player;
    };
    const myCharacter = () => s.characters.find((c) => c.id === player?.characterId && c.ownerId === player?.id);

    switch (msg.t) {
      case "hello": {
        if (msg.role === "screen") {
          ws.serializeAttachment({ role: "screen" } satisfies Attachment);
          return this.broadcast();
        }
        const p = msg.token ? s.players.find((x) => x.token === msg.token) : undefined;
        if (!p) return this.send(ws, { t: "unknown_token" });
        ws.serializeAttachment({ role: "phone", playerId: p.id } satisfies Attachment);
        return this.broadcast();
      }

      case "join": {
        const name = String(msg.name ?? "").trim().slice(0, 24);
        if (!name) throw new Error("Enter a name.");
        const p: Player = {
          id: crypto.randomUUID().slice(0, 8),
          token: crypto.randomUUID(),
          name,
          characterId: null,
          spectator: false,
          isHost: !s.players.some((x) => x.isHost),
        };
        s.players.push(p);
        ws.serializeAttachment({ role: "phone", playerId: p.id } satisfies Attachment);
        this.send(ws, { t: "welcome", token: p.token });
        await this.save();
        return this.broadcast();
      }

      case "claim": {
        const p = needPlayer();
        const c = s.characters.find((x) => x.id === msg.characterId);
        if (!c) throw new Error("That character does not exist.");
        if (c.pin && c.pin !== String(msg.pin ?? "")) throw new Error("Wrong PIN for this character.");
        if (c.ownerId && c.ownerId !== p.id && this.onlinePlayerIds().has(c.ownerId)) {
          const owner = s.players.find((x) => x.id === c.ownerId);
          throw new Error(`${c.name} is already being played by ${owner?.name ?? "someone"}.`);
        }
        this.releaseCharacter(p);
        c.ownerId = p.id;
        p.characterId = c.id;
        p.spectator = false;
        if (s.started && !s.log.some((m) => m.kind === "join" && m.text.startsWith(c.name + " "))) s.introductions.push(c.id);
        this.event(`${c.name} joins the table (${p.name}).`, "join");
        await this.save();
        return this.broadcast();
      }

      case "create_character": {
        const p = needPlayer();
        const c = this.buildCharacter(msg.character);
        this.releaseCharacter(p);
        c.ownerId = p.id;
        p.characterId = c.id;
        p.spectator = false;
        s.characters.push(c);
        if (s.started) s.introductions.push(c.id);
        this.event(`${c.name} joins the table (${p.name}).`, "join");
        await this.save();
        return this.broadcast();
      }

      case "update_backstory": {
        needPlayer();
        const c = myCharacter();
        if (!c) throw new Error("You don't have a character.");
        c.backstory = String(msg.text ?? "").trim().slice(0, BACKSTORY_MAX);
        await this.save();
        return this.broadcast();
      }

      case "spectate":
      case "leave_character": {
        const p = needPlayer();
        this.releaseCharacter(p);
        p.spectator = msg.t === "spectate";
        await this.save();
        return this.broadcast();
      }

      case "say": {
        const p = needPlayer();
        const c = myCharacter();
        if (!c) throw new Error("Pick or create a character to speak.");
        const text = String(msg.text ?? "").trim().slice(0, 600);
        if (!text) return;
        const active = activeCombatantId(s);
        if (active && active !== c.id && msg.aloud) throw new Error("It's not your turn. Table talk is still allowed.");
        s.pending.push({ id: s.nextMsgId++, speaker: c.name, playerId: p.id, text, aloud: !!msg.aloud });
        await this.save();
        return this.broadcast();
      }

      case "unsay": {
        const p = needPlayer();
        s.pending = s.pending.filter((m) => !(m.id === msg.id && m.playerId === p.id));
        await this.save();
        return this.broadcast();
      }

      case "begin": {
        if (att.role !== "screen" && !player?.isHost) throw new Error("Only the host or the main screen can start the adventure.");
        if (s.started) throw new Error("The adventure has already started.");
        this.markPresence();
        if (!s.characters.some((c) => c.present)) throw new Error("At least one player needs a character first.");
        return this.runLlm(() => opening(s, this.llm()));
      }

      case "set_voice": {
        if (att.role !== "screen" && !player?.isHost) throw new Error("Only the main screen or the host can change the voice.");
        if (msg.mode && ["off", "browser", "elevenlabs"].includes(msg.mode)) s.voiceMode = msg.mode as VoiceMode;
        if (msg.narratorVoiceId !== undefined) {
          s.narratorVoiceId = msg.narratorVoiceId || null;
          for (const n of s.npcs) if (n.voice?.voiceId === s.narratorVoiceId) n.voice.voiceId = undefined; // re-match clashes
        }
        await this.save();
        return this.broadcast();
      }

      case "send_to_dm": {
        const p = needPlayer();
        if (!s.started) throw new Error("The adventure hasn't started yet.");
        if (!s.pending.length) throw new Error("Nothing to send yet.");
        const active = activeCombatantId(s);
        if (active && !p.isHost && myCharacter()?.id !== active) throw new Error("In combat, the active player ends their turn.");
        return this.runLlm(async () => {
          const batch = s.pending;
          s.pending = [];
          try {
            await sendToDm(s, this.llm(), batch);
          } catch (e) {
            s.pending = [...batch, ...s.pending]; // put messages back so nothing is lost
            throw e;
          }
        });
      }
    }
  }

  // ---------- helpers ----------

  private llm() {
    return makeLlm(this.env, (usd) => (this.s!.costUsd += usd));
  }

  private async runLlm(work: () => Promise<void>) {
    if (this.busy) throw new Error("The DM is still thinking.");
    this.busy = true;
    this.markPresence();
    this.broadcast();
    try {
      await work();
      this.s!.lastPlayed = Date.now();
    } finally {
      this.busy = false;
      await this.save();
      this.broadcast();
      await this.updateRegistry();
    }
  }

  private event(text: string, kind: "join" | "event" = "event") {
    this.s!.log.push({ id: this.s!.nextMsgId++, speaker: "SYSTEM", text, aloud: true, kind });
  }

  private releaseCharacter(p: Player) {
    const c = this.s!.characters.find((x) => x.id === p.characterId);
    if (c && c.ownerId === p.id) c.ownerId = null;
    this.s!.introductions = this.s!.introductions.filter((id) => id !== p.characterId);
    p.characterId = null;
  }

  private buildCharacter(input: NewCharacterInput): Character {
    const s = this.s!;
    const name = String(input?.name ?? "").trim().slice(0, 24);
    if (!name) throw new Error("Your character needs a name.");
    if (s.characters.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new Error(`There is already a character called ${name}.`);
    const stats = {} as Character["stats"];
    for (const k of STATS) {
      const v = Math.round(Number(input.stats?.[k]));
      if (!(v >= STAT_MIN && v <= STAT_MAX)) throw new Error(`${k} must be between ${STAT_MIN} and ${STAT_MAX}.`);
      stats[k] = v;
    }
    if (statPointsUsed(stats) > STAT_POINTS) throw new Error(`You can only spend ${STAT_POINTS} points on stats.`);
    const abilities = (input.abilities ?? [])
      .filter((a) => a?.name?.trim() && a?.description?.trim())
      .slice(0, MAX_ABILITIES)
      .map((a) => {
        const uses = Math.max(0, Math.min(3, Math.round(Number(a.usesPerRest) || 0)));
        return { name: a.name.trim().slice(0, 40), description: a.description.trim().slice(0, 240), usesPerRest: uses, usesLeft: uses };
      });
    const inventory: Item[] = (input.items ?? [])
      .map((line) => String(line).trim())
      .filter(Boolean)
      .slice(0, MAX_ITEMS)
      .map((line) => {
        const m = line.match(/^(\d{1,2})\s*[x×]\s*(.+)$/i);
        return m ? { name: m[2].trim().slice(0, 40), qty: Math.max(1, Number(m[1])) } : { name: line.slice(0, 40), qty: 1 };
      });
    const pin = String(input.pin ?? "").trim();
    if (pin && !/^\d{4}$/.test(pin)) throw new Error("The PIN must be 4 digits.");
    const maxHealth = maxHealthFor(stats.stamina);
    return {
      id: `c-${crypto.randomUUID().slice(0, 8)}`,
      name,
      concept: String(input.concept ?? "").trim().slice(0, 80) || "Adventurer",
      backstory: String(input.backstory ?? "").trim().slice(0, BACKSTORY_MAX),
      stats,
      health: maxHealth,
      maxHealth,
      abilities,
      inventory,
      conditions: [],
      ownerId: null,
      pin: pin || null,
    };
  }

  private onlinePlayerIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.sockets()) {
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a?.playerId) ids.add(a.playerId);
    }
    return ids;
  }

  private markPresence() {
    const online = this.onlinePlayerIds();
    for (const c of this.s!.characters) c.present = !!c.ownerId && online.has(c.ownerId);
  }

  private publicView(): PublicView {
    const s = this.s!;
    this.markPresence();
    const online = this.onlinePlayerIds();
    const active = activeCombatantId(s);
    const npc = s.npcs.find((n) => n.id === s.activeNpcId);
    return {
      code: s.code,
      title: s.config.title,
      language: s.config.language,
      strictness: s.config.strictness,
      started: s.started,
      busy: this.busy,
      mode: s.mode,
      scene: s.scene,
      activeNpc: npc ? { name: npc.name, attitude: npc.attitude } : null,
      enemies: s.enemies,
      combat: s.combat && s.mode === "combat"
        ? {
            order: s.combat.order.map((id) => ({ id, name: s.characters.find((c) => c.id === id)?.name ?? "?" })),
            activeId: active,
            round: s.combat.round,
          }
        : null,
      characters: s.characters.map((c) => ({
        id: c.id,
        name: c.name,
        concept: c.concept,
        health: c.health,
        maxHealth: c.maxHealth,
        conditions: c.conditions,
        playerName: s.players.find((p) => p.id === c.ownerId)?.name ?? null,
        online: !!c.ownerId && online.has(c.ownerId),
        hasPin: !!c.pin,
        readyMade: !!c.readyMade,
      })),
      spectators: s.players.filter((p) => p.spectator && online.has(p.id)).map((p) => p.name),
      log: s.log.slice(-120),
      pending: s.pending,
      facts: s.facts,
      npcs: s.npcs.map((n) => ({ id: n.id, name: n.name, attitude: n.attitude, gender: n.voice?.gender ?? "neutral", age: n.voice?.age ?? "middle_aged" })),
      summary: s.summary,
      costUsd: Math.round(s.costUsd * 10000) / 10000,
      voiceMode: s.voiceMode,
      narratorVoiceId: s.narratorVoiceId,
    };
  }

  private youView(playerId?: string): YouView | null {
    const p = playerId ? this.s!.players.find((x) => x.id === playerId) : undefined;
    if (!p) return null;
    const c = this.s!.characters.find((x) => x.id === p.characterId && x.ownerId === p.id) ?? null;
    return { playerId: p.id, name: p.name, isHost: p.isHost, spectator: p.spectator, character: c ? { ...c, pin: null } : null };
  }

  private broadcast() {
    if (!this.s) return;
    const view = this.publicView();
    for (const ws of this.sockets()) {
      const a = (ws.deserializeAttachment() ?? { role: "phone" }) as Attachment;
      if (a.role === "phone" && !a.playerId) continue; // not joined yet: gets state after join
      this.send(ws, { t: "state", view, you: this.youView(a.playerId) });
    }
  }

  private send(ws: WebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private async save() {
    if (this.s) await this.ctx.storage.put("state", this.s);
  }

  summary(): CampaignSummary {
    const s = this.s!;
    return {
      code: s.code,
      title: s.config.title,
      started: s.started,
      party: s.characters.filter((c) => c.ownerId || (!c.readyMade && s.started)).map((c) => c.name),
      summary: s.summary || plainSpeech([...s.log].reverse().find((m) => m.speaker === "DM")?.text ?? s.storyArc, s.npcs).slice(0, 220),
      lastPlayed: s.lastPlayed,
      createdAt: s.createdAt,
    };
  }

  private async updateRegistry() {
    const reg = this.env.REGISTRY.get(this.env.REGISTRY.idFromName("global"));
    await reg.upsert(this.summary());
  }
}
