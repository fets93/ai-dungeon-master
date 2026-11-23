// One Durable Object per campaign: the single source of truth for its state,
// the WebSocket hub for the main screen and the phones, and the place where the DM runs.
import { DurableObject } from "cloudflare:workers";
import {
  AVATAR_MAX_BYTES,
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
import { generateStory, opening, recap, sendToDm } from "./game/engine";
import { makeLlm } from "./game/llm";
import { premadeCharacters } from "./game/premades";
import { activeCombatantId } from "./game/rules";
import type { Env } from "./index";

interface Attachment {
  role: "screen" | "phone";
  playerId?: string;
  unlocked?: boolean; // main screen entered the host PIN
}

// State before the last DM turn, for Undo / Retry.
interface UndoSnapshot {
  kind: "turn" | "opening" | "recap";
  state: GameState;
  batch: GameState["pending"];
}

export class Campaign extends DurableObject<Env> {
  private s: GameState | null = null;
  private busy = false;
  private canUndo = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.s = (await ctx.storage.get<GameState>("state")) ?? null;
      if (this.s) {
        // Fields added after the first release: fill defaults for older saves.
        this.s.voiceMode ??= "off";
        this.s.narratorVoiceId ??= null;
        this.s.blurb ??= "";
        this.s.hostPin ??= null;
        this.s.paused ??= false;
        this.canUndo = !!(await ctx.storage.get("undo"));
      }
    });
  }

  // ---------- RPC from the Worker ----------

  async init(code: string, config: CampaignConfig, carry?: Partial<GameState>, avatars?: Record<string, string>): Promise<CampaignSummary> {
    const now = Date.now();
    this.s = {
      code,
      config,
      storyArc: "",
      blurb: "",
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
      hostPin: null,
      paused: false,
      ...carry,
    };
    this.s.code = code;
    this.s.hostPin ??= null;
    this.s.paused = false;
    this.s.players = [];
    await this.ctx.storage.delete("undo");
    this.canUndo = false;
    for (const c of this.s.characters) {
      c.ownerId = null;
      c.present = false;
      const a = avatars?.[c.id];
      c.avatarVersion = 0;
      if (a) await this.storeAvatar(c, a).catch(() => {});
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
    // Host controls: the host's phone, or a main screen (unlocked with the PIN if one is set).
    const control = this.canControl(att, player);
    const needControl = () => {
      if (!control) throw new Error(s.hostPin && att.role === "screen" ? "Enter the host PIN to use this." : "Only the host can do that.");
    };

    switch (msg.t) {
      case "hello": {
        if (msg.role === "screen") {
          ws.serializeAttachment({ role: "screen" } satisfies Attachment);
          this.broadcast();
          // A new campaign gets its story (title, blurb, secret arc) as soon as the main screen opens it,
          // so players know what they're making characters for.
          if (!s.storyArc && !s.started && !this.busy) await this.runLlm(() => generateStory(s, this.llm()));
          return;
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
        if (msg.character.avatar) await this.storeAvatar(c, msg.character.avatar);
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

      case "set_avatar": {
        needPlayer();
        const c = myCharacter();
        if (!c) throw new Error("You don't have a character.");
        await this.storeAvatar(c, msg.dataUrl);
        await this.save();
        return this.broadcast();
      }

      case "remove_character": {
        if (!control) throw new Error("Only the main screen or the host can remove characters.");
        const c = s.characters.find((x) => x.id === msg.characterId);
        if (!c) throw new Error("That character doesn't exist.");
        const owner = s.players.find((p) => p.id === c.ownerId);
        if (owner) this.releaseCharacter(owner);
        c.ownerId = null;
        if (s.combat) {
          s.combat.order = s.combat.order.filter((id) => id !== c.id);
          if (s.combat.index >= s.combat.order.length) s.combat.index = 0;
        }
        if (msg.deleteIt && !c.readyMade) {
          s.characters = s.characters.filter((x) => x !== c);
          await this.ctx.storage.delete(`avatar:${c.id}`);
          this.event(`${c.name} was removed from the campaign.`);
        } else {
          this.event(`${c.name} left the table.`);
        }
        await this.save();
        this.broadcast();
        return this.updateRegistry();
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
        const whisper = !!msg.whisper;
        const active = activeCombatantId(s);
        if (active && active !== c.id && (msg.aloud || whisper)) throw new Error("It's not your turn. Table talk is still allowed.");
        s.pending.push({
          id: s.nextMsgId++,
          speaker: c.name,
          playerId: p.id,
          text,
          aloud: !!msg.aloud && !whisper,
          ...(whisper ? { whisper: true, whisperTo: c.id } : {}),
        });
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
        if (!control) throw new Error("Only the host or the main screen can start the adventure.");
        if (s.started) throw new Error("The adventure has already started.");
        if (!s.characters.some((c) => c.ownerId)) throw new Error("At least one character needs to be at the table first.");
        // Everyone at the table is part of the opening scene, even if their phone is locked right now.
        return this.runLlm(async () => {
          for (const c of s.characters) c.present = !!c.ownerId;
          await this.snapshot("opening", []);
          await opening(s, this.llm());
        }, false);
      }

      case "set_voice": {
        if (!control) throw new Error("Only the main screen or the host can change the voice.");
        if (msg.mode && ["off", "browser", "elevenlabs"].includes(msg.mode)) s.voiceMode = msg.mode as VoiceMode;
        if (msg.narratorVoiceId !== undefined) {
          s.narratorVoiceId = msg.narratorVoiceId || null;
          for (const n of s.npcs) if (n.voice?.voiceId === s.narratorVoiceId) n.voice.voiceId = undefined; // re-match clashes
        }
        await this.save();
        return this.broadcast();
      }

      case "unlock": {
        if (att.role !== "screen") return;
        if (!s.hostPin || msg.pin !== s.hostPin) throw new Error("Wrong PIN.");
        ws.serializeAttachment({ ...att, unlocked: true } satisfies Attachment);
        return this.broadcast();
      }

      case "set_host_pin": {
        needControl();
        const pin = msg.pin ? String(msg.pin).trim() : "";
        if (pin && !/^\d{4,6}$/.test(pin)) throw new Error("The host PIN must be 4 to 6 digits.");
        s.hostPin = pin || null;
        if (att.role === "screen") ws.serializeAttachment({ ...att, unlocked: true } satisfies Attachment);
        await this.save();
        return this.broadcast();
      }

      case "set_paused": {
        needControl();
        s.paused = !!msg.paused;
        this.event(s.paused ? "The game is paused." : "The game continues.");
        await this.save();
        return this.broadcast();
      }

      case "set_facts": {
        needControl();
        s.facts = (Array.isArray(msg.facts) ? msg.facts : [])
          .map((f) => String(f).trim().slice(0, 300))
          .filter(Boolean)
          .slice(0, 200);
        await this.save();
        return this.broadcast();
      }

      case "undo_turn": {
        needControl();
        if (this.busy) throw new Error("The DM is still thinking.");
        const snap = await this.restoreSnapshot();
        this.event(snap.kind === "opening" ? "The opening was undone." : "The last DM turn was undone.");
        await this.save();
        return this.broadcast();
      }

      case "retry_turn": {
        needControl();
        if (this.busy) throw new Error("The DM is still thinking.");
        const snap = await this.restoreSnapshot();
        const cur = this.s!; // restoring replaced the state object
        const later = cur.pending.slice(snap.batch.length); // typed after that turn: keep for the next send
        return this.runLlm(async () => {
          if (snap.kind === "opening") {
            for (const c of cur.characters) c.present = !!c.ownerId;
            await this.snapshot("opening", []);
            await opening(cur, this.llm());
          } else if (snap.kind === "recap") {
            await this.snapshot("recap", []);
            await recap(cur, this.llm());
          } else {
            cur.pending = later;
            await this.snapshot("turn", snap.batch);
            await sendToDm(cur, this.llm(), snap.batch);
          }
        }, snap.kind !== "opening");
      }

      case "recap": {
        needControl();
        if (!s.started) throw new Error("The adventure hasn't started yet.");
        return this.runLlm(async () => {
          await this.snapshot("recap", []);
          await recap(s, this.llm());
        });
      }

      case "send_to_dm": {
        const p = needPlayer();
        if (!s.started) throw new Error("The adventure hasn't started yet.");
        if (!s.pending.length) throw new Error("Nothing to send yet.");
        if (s.paused) throw new Error("The game is paused. The host can resume it.");
        const active = activeCombatantId(s);
        if (active && !p.isHost && myCharacter()?.id !== active) throw new Error("In combat, the active player ends their turn.");
        return this.runLlm(async () => {
          const batch = s.pending;
          s.pending = [];
          await this.snapshot("turn", batch);
          try {
            await sendToDm(s, this.llm(), batch);
          } catch (e) {
            s.pending = [...batch, ...s.pending]; // put messages back so nothing is lost
            await this.dropSnapshot();
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

  private async runLlm(work: () => Promise<void>, presence = true) {
    if (this.busy) throw new Error("The DM is still thinking.");
    this.busy = true;
    if (presence) this.markPresence();
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

  private canControl(att: Attachment, player?: Player): boolean {
    if (att.role === "screen") return !this.s!.hostPin || !!att.unlocked;
    return !!player?.isHost;
  }

  private async snapshot(kind: UndoSnapshot["kind"], batch: GameState["pending"]) {
    const snap: UndoSnapshot = { kind, state: structuredClone(this.s!), batch: structuredClone(batch) };
    await this.ctx.storage.put("undo", snap);
    this.canUndo = true;
  }

  private async dropSnapshot() {
    await this.ctx.storage.delete("undo");
    this.canUndo = false;
  }

  // Puts the game back to before the last DM turn. Players, settings, the API cost and
  // anything joined or typed since then are kept; the turn's messages go back to "not sent".
  private async restoreSnapshot(): Promise<UndoSnapshot> {
    const snap = await this.ctx.storage.get<UndoSnapshot>("undo");
    if (!snap) throw new Error("There's no DM turn to undo.");
    const now = this.s!;
    const old = structuredClone(snap.state);
    const owners = new Map(now.characters.map((c) => [c.id, c]));
    old.characters = [
      ...old.characters.filter((c) => owners.has(c.id)).map((c) => ({ ...c, ownerId: owners.get(c.id)!.ownerId, avatarVersion: owners.get(c.id)!.avatarVersion, backstory: owners.get(c.id)!.backstory })),
      ...now.characters.filter((c) => !old.characters.some((o) => o.id === c.id)),
    ];
    this.s = {
      ...old,
      players: now.players,
      voiceMode: now.voiceMode,
      narratorVoiceId: now.narratorVoiceId,
      hostPin: now.hostPin,
      paused: now.paused,
      costUsd: now.costUsd,
      nextMsgId: now.nextMsgId,
      config: now.config,
      pending: [...snap.batch, ...now.pending],
    };
    await this.dropSnapshot();
    return snap;
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

  // Portraits live in their own storage keys, so game updates stay small; clients load them by URL.
  private async storeAvatar(c: Character, dataUrl: string | null) {
    if (!dataUrl) {
      await this.ctx.storage.delete(`avatar:${c.id}`);
      c.avatarVersion = 0;
      return;
    }
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) throw new Error("That image format isn't supported.");
    if (dataUrl.length > AVATAR_MAX_BYTES) throw new Error("That image is too large.");
    await this.ctx.storage.put(`avatar:${c.id}`, dataUrl);
    c.avatarVersion = (c.avatarVersion ?? 0) + 1;
  }

  async getAvatar(characterId: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(`avatar:${characterId}`)) ?? null;
  }

  async avatarsForExport(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [k, v] of await this.ctx.storage.list<string>({ prefix: "avatar:" })) out[k.slice(7)] = v;
    return out;
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
      blurb: s.blurb,
      idea: s.config.prompt,
      tone: s.config.tone,
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
        avatarVersion: c.avatarVersion ?? 0,
      })),
      spectators: s.players.filter((p) => p.spectator && online.has(p.id)).map((p) => p.name),
      log: s.log.filter((m) => !m.whisperTo).slice(-120),
      pending: s.pending.filter((m) => !m.whisperTo),
      facts: s.facts,
      npcs: s.npcs.map((n) => ({ id: n.id, name: n.name, attitude: n.attitude, gender: n.voice?.gender ?? "neutral", age: n.voice?.age ?? "middle_aged" })),
      summary: s.summary,
      costUsd: Math.round(s.costUsd * 10000) / 10000,
      voiceMode: s.voiceMode,
      narratorVoiceId: s.narratorVoiceId,
      paused: s.paused,
      lastPlayed: s.lastPlayed,
      hasHostPin: !!s.hostPin,
      canUndo: this.canUndo,
      canControl: false,
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
    const s = this.s;
    for (const ws of this.sockets()) {
      const a = (ws.deserializeAttachment() ?? { role: "phone" }) as Attachment;
      if (a.role === "phone" && !a.playerId) continue; // not joined yet: gets state after join
      const player = s.players.find((p) => p.id === a.playerId);
      const charId = player?.characterId;
      // Whispers and their results go only to the player whose character they belong to.
      const mine = charId && s.log.some((m) => m.whisperTo === charId) || s.pending.some((m) => m.whisperTo && m.whisperTo === charId);
      const personal = mine
        ? {
            log: s.log.filter((m) => !m.whisperTo || m.whisperTo === charId).slice(-120),
            pending: s.pending.filter((m) => !m.whisperTo || m.whisperTo === charId),
          }
        : {};
      this.send(ws, { t: "state", view: { ...view, ...personal, canControl: this.canControl(a, player) }, you: this.youView(a.playerId) });
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
      summary: s.summary || plainSpeech([...s.log].reverse().find((m) => m.speaker === "DM" && !m.whisperTo)?.text ?? (s.blurb || s.config.prompt), s.npcs).slice(0, 220),
      lastPlayed: s.lastPlayed,
      createdAt: s.createdAt,
    };
  }

  private async updateRegistry() {
    const reg = this.env.REGISTRY.get(this.env.REGISTRY.idFromName("global"));
    await reg.upsert(this.summary());
  }
}
