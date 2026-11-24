// Game rules the LLM cannot override: dice, item and ability checks, and every state change from DM tools.
import { DISPOSITION_MOD, NPC_STATS, STATS, modifier, type Ability, type Character, type GameState, type NpcStat, type ResolvedAction, type RollData, type Ruling, type Stat } from "../../shared/types";

// Cryptographic randomness, without modulo bias: values above the largest multiple of 20 are redrawn.
function cryptoD20(): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / 20) * 20;
  do crypto.getRandomValues(buf);
  while (buf[0] >= limit);
  return 1 + (buf[0] % 20);
}

export let rollD20 = cryptoD20;
export function setDice(fn: () => number) {
  rollD20 = fn;
}

export function findCharacter(s: GameState, name: string): Character | undefined {
  const n = name.trim().toLowerCase();
  return s.characters.find((c) => c.name.toLowerCase() === n || c.id === n);
}

const activeCharacters = (s: GameState) => s.characters.filter((c) => c.present);

// DC for swaying an NPC: 10 + their stat's modifier + how they feel about the party.
export function opposedDc(s: GameState, npcId: string, stat: NpcStat): { dc: number; why: string } | null {
  const npc = s.npcs.find((n) => n.id === npcId);
  if (!npc) return null;
  const score = npc.stats?.[stat] ?? 10;
  const disp = npc.disposition ?? "neutral";
  const dc = 10 + modifier(score) + DISPOSITION_MOD[disp];
  return { dc, why: `${npc.name}'s ${stat} ${score} (${fmt(modifier(score))}), ${disp} (${fmt(DISPOSITION_MOD[disp])})` };
}

const fmt = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

/**
 * Resolves one ruling: server-side checks, then the dice.
 * preRoll: two d20s locked when an ability was cast; otherwise fresh dice are rolled here.
 */
export function resolve(s: GameState, r: Ruling, preRoll?: number[]): ResolvedAction {
  if (r.verdict === "no_action") return { ruling: r, result: "no_action" };
  if (r.verdict === "impossible") return { ruling: r, result: "rejected", note: r.reason };

  const c = findCharacter(s, r.character);
  if (!c) return { ruling: r, result: "rejected", note: `No character named ${r.character}.` };
  if (c.health <= 0) return { ruling: r, result: "rejected", note: `${c.name} is down and cannot act.` };

  if (r.usesItem) {
    const item = c.inventory.find((i) => i.name.toLowerCase() === r.usesItem!.toLowerCase());
    if (!item || item.qty <= 0) return { ruling: r, result: "rejected", note: `${c.name} does not have "${r.usesItem}".` };
    if (r.consumesItem) {
      item.qty -= 1;
      if (item.qty === 0) c.inventory = c.inventory.filter((i) => i !== item);
    }
  }
  let ability: Ability | undefined;
  if (r.usesAbility) {
    ability = c.abilities.find((a) => a.name.toLowerCase() === r.usesAbility!.toLowerCase());
    if (!ability) return { ruling: r, result: "rejected", note: `${c.name} has no ability "${r.usesAbility}".` };
    if (ability.kind === "passive") return { ruling: r, result: "rejected", note: `${ability.name} is passive: it's always on and can't be cast.` };
    if (ability.usesPerRest > 0 && ability.usesLeft <= 0) return { ruling: r, result: "rejected", note: `${ability.name} is used up until the next rest.` };
    if (ability.usesPerRest > 0) ability.usesLeft -= 1;
    // A boost always works: it gives advantage on the character's next roll with its stat.
    if (ability.kind === "boost") {
      c.effects = [...(c.effects ?? []).filter((e) => e.name !== ability!.name), { name: ability.name, stat: ability.boostStat ?? null }];
      return { ruling: { ...r, reason: `${ability.name}: advantage on ${c.name}'s next ${ability.boostStat ?? "roll"}` }, result: "auto_success" };
    }
  }

  if (r.verdict === "trivial") return { ruling: r, result: "auto_success" };

  const stat: Stat = r.stat && (STATS as readonly string[]).includes(r.stat) ? r.stat : "strength";
  let dc = Math.max(1, Math.min(35, Math.round(r.dc ?? 12)));
  let dcWhy = "";
  if (r.opposedBy) {
    const o = opposedDc(s, r.opposedBy.npcId, r.opposedBy.stat);
    if (o) ({ dc, why: dcWhy } = o);
  }

  // Advantage: a matching boost (used up now) or the referee's call; advantage and disadvantage cancel out.
  let adv = r.edge === "advantage" ? 1 : r.edge === "disadvantage" ? -1 : 0;
  const boost = (c.effects ?? []).find((e) => e.stat === null || e.stat === stat);
  if (boost) {
    adv += 1;
    c.effects = (c.effects ?? []).filter((e) => e !== boost);
  }
  const edge = adv > 0 ? "advantage" : adv < 0 ? "disadvantage" : undefined;
  const dice = preRoll?.length ? preRoll.slice(0, 2) : [rollD20(), rollD20()];
  const d = edge === "advantage" ? Math.max(dice[0], dice[1]) : edge === "disadvantage" ? Math.min(dice[0], dice[1]) : dice[0];

  const mod = modifier(c.stats[stat]);
  const total = d + mod;
  const success = d === 20 || (d !== 1 && total >= dc);
  const margin = total - dc;
  const degree = success ? (margin >= 5 || d === 20 ? "great" : "success") : margin <= -5 || d === 1 ? "bad" : "failure";
  const degreeText = { great: "great success", success: "success", failure: "failure", bad: "bad failure" }[degree];
  const diceText = edge ? `${edge} [${dice[0]}, ${dice[1]}] → ${d}` : `${d}`;
  const rollText =
    `${c.name} rolls ${stat}${ability ? ` (${ability.name})` : ""}${boost ? ` with ${boost.name}` : ""} vs DC ${dc}${dcWhy ? ` (${dcWhy})` : ""}: ` +
    `${diceText} ${mod >= 0 ? "+" : "−"} ${Math.abs(mod)} = ${total} → ${degreeText}${d === 20 ? " (natural 20)" : d === 1 ? " (natural 1)" : ""}`;
  const roll: RollData = {
    characterId: c.id,
    label: `${c.name}: ${stat}${ability ? ` (${ability.name})` : ""}`,
    d20: d,
    dice: edge ? dice : undefined,
    edge,
    mod,
    total,
    dc,
    success,
    degree,
    preRolled: !!preRoll?.length,
  };
  return { ruling: r, result: success ? "success" : "failure", rollText, roll };
}

export interface ToolResult {
  text: string;
  roll?: string; // shown in the feed as a dice roll
  rollData?: RollData;
}

export function applyTool(s: GameState, name: string, input: Record<string, any>): ToolResult {
  const char = () => {
    const c = findCharacter(s, String(input.character ?? ""));
    if (!c) throw new Error(`Unknown character "${input.character}". Known: ${s.characters.map((x) => x.name).join(", ")}`);
    return c;
  };
  const n = (v: unknown, min = 0, max = 999) => {
    const x = Math.round(Number(v));
    if (!Number.isFinite(x) || x < min || x > max) throw new Error(`Number out of range: ${v}`);
    return x;
  };
  const ok = (text: string): ToolResult => ({ text });

  switch (name) {
    case "set_scene":
      s.scene = String(input.scene).slice(0, 400);
      return ok("Scene updated.");
    case "set_mode": {
      if (!["narration", "conversation"].includes(input.mode)) throw new Error("Use start_combat / end_combat for combat.");
      s.mode = input.mode;
      if (s.mode !== "conversation") s.activeNpcId = null;
      return ok(`Mode is now ${s.mode}.`);
    }
    case "create_npc": {
      const id = String(input.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      if (s.npcs.some((x) => x.id === id)) return ok(`NPC ${id} already exists; use update_npc.`);
      s.npcs.push({
        id,
        name: String(input.name),
        personality: String(input.personality ?? ""),
        speechStyle: String(input.speech_style ?? ""),
        goals: String(input.goals ?? ""),
        knowledge: String(input.knowledge ?? ""),
        secrets: String(input.secrets ?? ""),
        attitude: String(input.attitude ?? "neutral"),
        memory: [],
        stats: npcStats(input.stats),
        disposition: disposition(input.disposition) ?? "neutral",
        voice: {
          gender: ["male", "female", "neutral"].includes(input.voice_gender) ? input.voice_gender : "neutral",
          age: ["young", "middle_aged", "old"].includes(input.voice_age) ? input.voice_age : "middle_aged",
          style: String(input.voice_style ?? input.speech_style ?? "").slice(0, 80),
        },
      });
      return ok(`Created NPC ${id}.`);
    }
    case "update_npc": {
      const npc = s.npcs.find((x) => x.id === input.id);
      if (!npc) throw new Error(`Unknown NPC ${input.id}`);
      if (input.attitude) npc.attitude = String(input.attitude);
      if (disposition(input.disposition)) npc.disposition = disposition(input.disposition);
      if (input.remember) npc.memory.push(String(input.remember));
      return ok(`Updated ${npc.name}.`);
    }
    case "set_active_npc": {
      const npc = s.npcs.find((x) => x.id === input.id);
      if (!npc) throw new Error(`Unknown NPC ${input.id}; create it first.`);
      s.activeNpcId = npc.id;
      if (s.mode !== "combat") s.mode = "conversation";
      return ok(`${npc.name} is now the active NPC.`);
    }
    case "add_fact":
      s.facts.push(String(input.fact));
      return ok("Fact recorded.");
    case "give_item": {
      const c = char();
      const qty = n(input.qty ?? 1, 1, 99);
      const ex = c.inventory.find((i) => i.name.toLowerCase() === String(input.item).toLowerCase());
      if (ex) ex.qty += qty;
      else c.inventory.push({ name: String(input.item), qty, description: input.description });
      return ok(`${c.name} receives ${qty} × ${input.item}.`);
    }
    case "remove_item": {
      const c = char();
      const qty = n(input.qty ?? 1, 1, 99);
      const ex = c.inventory.find((i) => i.name.toLowerCase() === String(input.item).toLowerCase());
      if (!ex || ex.qty < qty) throw new Error(`${c.name} does not have ${qty} × ${input.item}`);
      ex.qty -= qty;
      if (ex.qty === 0) c.inventory = c.inventory.filter((i) => i !== ex);
      return ok(`${c.name} loses ${qty} × ${input.item}.`);
    }
    case "apply_damage": {
      const target = String(input.target ?? input.character ?? "");
      const amount = n(input.amount, 0, 30);
      const c = findCharacter(s, target);
      if (c) {
        c.health = Math.max(0, c.health - amount);
        return ok(`${c.name} takes ${amount} damage (${c.health}/${c.maxHealth})${c.health === 0 ? " and is down" : ""}.`);
      }
      const e = s.enemies.find((x) => x.name.toLowerCase() === target.toLowerCase());
      if (!e) throw new Error(`Unknown target ${target}`);
      e.health = Math.max(0, e.health - amount);
      if (e.health === 0) s.enemies = s.enemies.filter((x) => x !== e);
      return ok(`${e.name} takes ${amount} damage${e.health === 0 ? " and is defeated" : ` (${e.health} left)`}.`);
    }
    case "enemy_attack": {
      // Enemies roll too: d20 + bonus against 10 + the target's agility modifier.
      const e = s.enemies.find((x) => x.name.toLowerCase() === String(input.enemy).toLowerCase());
      if (!e) throw new Error(`Unknown enemy ${input.enemy}`);
      const c = findCharacter(s, String(input.target));
      if (!c) throw new Error(`Unknown target ${input.target}`);
      const bonus = n(input.attack_bonus ?? 3, 0, 8);
      const dmg = n(input.damage ?? 4, 1, 12);
      const defense = 10 + modifier(c.stats.agility);
      const d = rollD20();
      const hit = d === 20 || (d !== 1 && d + bonus >= defense);
      if (hit) c.health = Math.max(0, c.health - dmg);
      const roll = `${e.name} attacks ${c.name}: ${d} + ${bonus} = ${d + bonus} vs ${defense} → ${hit ? `hit, ${dmg} damage (${c.health}/${c.maxHealth})` : "miss"}`;
      const rollData: RollData = { characterId: null, targetId: c.id, label: `${e.name} attacks ${c.name}`, d20: d, mod: bonus, total: d + bonus, dc: defense, success: hit };
      return { text: roll + (hit && c.health === 0 ? `. ${c.name} is down.` : ""), roll, rollData };
    }
    case "heal": {
      const c = char();
      const amount = n(input.amount, 0, 50);
      c.health = Math.min(c.maxHealth, c.health + amount);
      return ok(`${c.name} heals to ${c.health}/${c.maxHealth}.`);
    }
    case "add_condition": {
      const c = char();
      if (!c.conditions.includes(String(input.condition))) c.conditions.push(String(input.condition));
      return ok(`${c.name} is now ${input.condition}.`);
    }
    case "remove_condition": {
      const c = char();
      c.conditions = c.conditions.filter((x) => x.toLowerCase() !== String(input.condition).toLowerCase());
      return ok(`${c.name} is no longer ${input.condition}.`);
    }
    case "start_combat": {
      const enemies = (input.enemies ?? []) as any[];
      if (!enemies.length) throw new Error("start_combat needs at least one enemy");
      s.enemies = enemies.slice(0, 8).map((e) => ({ name: String(e.name), health: n(e.health, 1, 200), defense: n(e.defense, 5, 25) }));
      // Initiative for the player characters; enemies act inside the DM's narration via enemy_attack.
      const order = activeCharacters(s)
        .filter((c) => c.health > 0)
        .map((c) => ({ id: c.id, init: rollD20() + modifier(c.stats.agility) }))
        .sort((a, b) => b.init - a.init)
        .map((x) => x.id);
      s.combat = { order, index: 0, round: 1 };
      s.mode = "combat";
      s.activeNpcId = null;
      const first = s.characters.find((c) => c.id === order[0]);
      return ok(`Combat started against ${s.enemies.map((e) => e.name).join(", ")}. ${first ? `${first.name} acts first.` : ""}`);
    }
    case "end_combat":
      s.enemies = [];
      s.combat = null;
      s.mode = "narration";
      return ok("Combat over, back to narration.");
    case "rest":
      for (const c of s.characters) {
        for (const a of c.abilities) a.usesLeft = a.usesPerRest;
        c.effects = [];
        if (c.health > 0) c.health = Math.min(c.maxHealth, c.health + Math.ceil(c.maxHealth / 2));
      }
      return ok("The party rests: abilities restored, half health regained.");
    case "request_roll": {
      const res = resolve(s, {
        messageIndex: -1,
        character: String(input.character),
        verdict: "needs_roll",
        reason: String(input.reason ?? ""),
        stat: input.stat,
        dc: input.dc,
      });
      return { text: res.rollText ?? res.note ?? "No roll.", roll: res.rollText, rollData: res.roll };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

function npcStats(input: unknown): Record<NpcStat, number> {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = {} as Record<NpcStat, number>;
  for (const k of NPC_STATS) {
    const v = Math.round(Number(src[k]));
    out[k] = Number.isFinite(v) ? Math.max(6, Math.min(18, v)) : 10;
  }
  return out;
}

function disposition(v: unknown) {
  return (["hostile", "unfriendly", "neutral", "friendly", "allied"] as const).find((d) => d === v);
}

// Move the combat turn to the next character who can still act.
export function advanceCombatTurn(s: GameState) {
  if (!s.combat) return;
  const alive = (id: string) => {
    const c = s.characters.find((x) => x.id === id);
    return !!c && c.health > 0 && !!c.present;
  };
  s.combat.order = s.combat.order.filter((id) => s.characters.some((c) => c.id === id));
  if (!s.combat.order.some(alive)) return;
  for (let i = 0; i < s.combat.order.length; i++) {
    s.combat.index += 1;
    if (s.combat.index >= s.combat.order.length) {
      s.combat.index = 0;
      s.combat.round += 1;
    }
    if (alive(s.combat.order[s.combat.index])) return;
  }
}

export function activeCombatantId(s: GameState): string | null {
  if (!s.combat || s.mode !== "combat") return null;
  return s.combat.order[s.combat.index] ?? null;
}

export function describeCharacters(s: GameState, withBackstory = false): string {
  const list = s.characters.filter((c) => c.present || (c.ownerId && s.started));
  return list
    .map((c) => {
      const stats = STATS.map((k) => `${k} ${c.stats[k]} (${modifier(c.stats[k]) >= 0 ? "+" : ""}${modifier(c.stats[k])})`).join(", ");
      const abil = c.abilities
        .map((a) => `${a.name} [${a.kind ?? "effect"}${a.kind === "boost" ? ` on ${a.boostStat ?? "any roll"}` : ""}, ${a.usesPerRest > 0 ? `${a.usesLeft}/${a.usesPerRest} uses` : "unlimited"}]: ${a.description}`)
        .join("; ");
      const fx = c.effects?.length ? `\n  Active boosts: ${c.effects.map((e) => `${e.name} (advantage on next ${e.stat ?? "roll"})`).join(", ")}` : "";
      const inv = c.inventory.map((i) => `${i.qty}x ${i.name}`).join(", ") || "nothing";
      const away = c.present ? "" : " [player absent this session: keep in the background]";
      return `- ${c.name}${away}, ${c.concept}. Health ${c.health}/${c.maxHealth}. ${stats}.\n  Abilities: ${abil || "none"}\n  Inventory: ${inv}\n  Conditions: ${c.conditions.join(", ") || "none"}${fx}${withBackstory && c.backstory ? `\n  Backstory: ${c.backstory}` : ""}`;
    })
    .join("\n");
}
