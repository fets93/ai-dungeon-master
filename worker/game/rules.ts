// Game rules the LLM cannot override: dice, item and ability checks, and every state change from DM tools.
import { STATS, modifier, type Character, type GameState, type ResolvedAction, type Ruling, type Stat } from "../../shared/types";

export let rollD20 = () => 1 + Math.floor(Math.random() * 20);
export function setDice(fn: () => number) {
  rollD20 = fn;
}

export function findCharacter(s: GameState, name: string): Character | undefined {
  const n = name.trim().toLowerCase();
  return s.characters.find((c) => c.name.toLowerCase() === n || c.id === n);
}

const activeCharacters = (s: GameState) => s.characters.filter((c) => c.present);

export function resolve(s: GameState, r: Ruling): ResolvedAction {
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
  if (r.usesAbility) {
    const ab = c.abilities.find((a) => a.name.toLowerCase() === r.usesAbility!.toLowerCase());
    if (!ab) return { ruling: r, result: "rejected", note: `${c.name} has no ability "${r.usesAbility}".` };
    if (ab.usesPerRest > 0 && ab.usesLeft <= 0) return { ruling: r, result: "rejected", note: `${ab.name} is used up until the next rest.` };
    if (ab.usesPerRest > 0) ab.usesLeft -= 1;
  }

  if (r.verdict === "trivial") return { ruling: r, result: "auto_success" };

  const stat: Stat = r.stat && (STATS as readonly string[]).includes(r.stat) ? r.stat : "strength";
  const dc = Math.max(1, Math.min(30, Math.round(r.dc ?? 12)));
  const d = rollD20();
  const mod = modifier(c.stats[stat]);
  const total = d + mod;
  const success = d === 20 || (d !== 1 && total >= dc);
  const rollText = `${c.name} rolls ${stat} vs DC ${dc}: ${d} ${mod >= 0 ? "+" : "−"} ${Math.abs(mod)} = ${total} → ${success ? "success" : "failure"}${d === 20 ? " (natural 20)" : d === 1 ? " (natural 1)" : ""}`;
  return { ruling: r, result: success ? "success" : "failure", rollText };
}

export interface ToolResult {
  text: string;
  roll?: string; // shown in the feed as a dice roll
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
      });
      return ok(`Created NPC ${id}.`);
    }
    case "update_npc": {
      const npc = s.npcs.find((x) => x.id === input.id);
      if (!npc) throw new Error(`Unknown NPC ${input.id}`);
      if (input.attitude) npc.attitude = String(input.attitude);
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
      return { text: roll + (hit && c.health === 0 ? `. ${c.name} is down.` : ""), roll };
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
      return { text: res.rollText ?? res.note ?? "No roll.", roll: res.rollText };
    }
    default:
      throw new Error(`Unknown tool ${name}`);
  }
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

export function describeCharacters(s: GameState): string {
  const list = s.characters.filter((c) => c.present || (c.ownerId && s.started));
  return list
    .map((c) => {
      const stats = STATS.map((k) => `${k} ${c.stats[k]} (${modifier(c.stats[k]) >= 0 ? "+" : ""}${modifier(c.stats[k])})`).join(", ");
      const abil = c.abilities
        .map((a) => `${a.name} [${a.usesPerRest > 0 ? `${a.usesLeft}/${a.usesPerRest} uses` : "unlimited"}]: ${a.description}`)
        .join("; ");
      const inv = c.inventory.map((i) => `${i.qty}x ${i.name}`).join(", ") || "nothing";
      const away = c.present ? "" : " [player absent this session: keep in the background]";
      return `- ${c.name}${away}, ${c.concept}. Health ${c.health}/${c.maxHealth}. ${stats}.\n  Abilities: ${abil || "none"}\n  Inventory: ${inv}\n  Conditions: ${c.conditions.join(", ") || "none"}${c.backstory ? `\n  Backstory: ${c.backstory}` : ""}`;
    })
    .join("\n");
}
