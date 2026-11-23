// Offline stand-in for the Claude API (MOCK_LLM=1): plausible rulings and tool calls, placeholder narration.
// Lets the whole app run locally and in tests without an API key or cost.
import type Anthropic from "@anthropic-ai/sdk";
import type { CreateParams } from "./llm";

let n = 0;
const msg = (model: string, content: any[], stop: "end_turn" | "tool_use"): Anthropic.Message =>
  ({
    id: `mock_${++n}`,
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stop,
    stop_sequence: null,
    usage: { input_tokens: 3000, output_tokens: 300, cache_creation_input_tokens: 0, cache_read_input_tokens: 5000 },
  }) as unknown as Anthropic.Message;
const tool = (name: string, input: object) => ({ type: "tool_use", id: `toolu_${++n}`, name, input });
const text = (t: string) => ({ type: "text", text: t });

function userText(p: CreateParams, which: "first" | "last" = "last"): string {
  const m = which === "first" ? p.messages[0] : p.messages.at(-1)!;
  if (typeof m.content === "string") return m.content;
  return m.content.map((b: any) => (b.type === "text" ? b.text : "")).join("");
}

export function mockLlm(role: string, p: CreateParams): Anthropic.Message {
  if (role === "summary") return msg(p.model, [text("Mock summary: the party has been busy in the harbor.")], "end_turn");
  if (role === "story")
    return msg(p.model, [tool("set_story", { title: "The Drowned Lantern", blurb: "Saltmere is a rain-soaked harbor city where ships vanish on calm nights. You meet in the Drowned Lantern tavern on the night the harbor is closed. Sailors, smugglers and odd folk welcome.", story_arc: "Ships vanish on calm nights in the harbor city of Saltmere. A stolen ledger leads through smugglers and a corrupt harbor master to a drowned temple, where a cult wants to wake something old. The players decide what to do with what sleeps there." })], "tool_use");

  if (role === "referee") {
    const lines = userText(p).split("MESSAGES TO RULE ON:")[1].trim().split("\n");
    const rulings = lines
      .map((l) => l.match(/^\[(\d+)\] ([^:]+?): (.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => {
        const [i, who, t] = [Number(m[1]), m[2], m[3].toLowerCase()];
        const base = { message_index: i, character: who };
        if (/key in my pocket|my cousin/.test(t)) return { ...base, verdict: "impossible", reason: "Players cannot declare world facts." };
        if (/potion/.test(t)) return { ...base, verdict: "trivial", reason: "Drinks the potion.", uses_item: "Healing potion", consumes_item: true };
        if (/attack|stab|shoot|hit/.test(t)) return { ...base, verdict: "needs_roll", reason: "Attack.", stat: "strength", dc: 12, success_outcome: "the blow lands", failure_consequence: "the enemy dodges and closes in" };
        if (/sneak|climb/.test(t)) return { ...base, verdict: "needs_roll", reason: "Risky.", stat: "agility", dc: 14, success_outcome: "unnoticed", failure_consequence: "spotted by the guard" };
        if (/convince|persuade/.test(t)) return { ...base, verdict: "needs_roll", reason: "Against the NPC's goals.", stat: "charm", dc: 15, success_outcome: "the NPC agrees", failure_consequence: "the NPC grows suspicious" };
        return { ...base, verdict: "no_action", reason: "Dialogue." };
      });
    return msg(p.model, [tool("adjudicate", { rulings })], "tool_use");
  }

  // DM: after tool results, finish with narration.
  const last = p.messages.at(-1)!;
  if (Array.isArray(last.content) && last.content.some((b: any) => b.type === "tool_result")) {
    const said = userText(p, "first").split("THE PLAYERS JUST SAID / DID")[1] ?? "";
    const who = [...said.matchAll(/\n(\w[\w' -]*?) \((?:said aloud|table talk)/g)].map((m) => m[1]);
    const kessa = /mother-kessa/.test(userText(p, "first")) || p.messages.some((m: any) => JSON.stringify(m.content).includes("mother-kessa"));
    return msg(p.model, [text(`[Mock DM] The rain hammers on the windows of the Drowned Lantern.${kessa ? " The old woman squints at you. {{mother-kessa: Nobody leaves the harbor tonight, dearies.}} She taps the counter." : ""} ${who.length ? `${[...new Set(who)].join(" and ")} act, and the world answers exactly as the dice decided.` : "The night is young and the harbor is restless."} What do you do?`)], "end_turn");
  }

  const t = userText(p);
  const said = t.split("THE PLAYERS JUST SAID / DID")[1] ?? "";
  const calls: any[] = [];
  if (t.includes("Open the adventure")) {
    calls.push(
      tool("set_scene", { scene: "A rain-soaked harbor tavern, the Drowned Lantern, at midnight." }),
      tool("create_npc", { name: "Mother Kessa", personality: "shrewd, warm on the surface", speech_style: "slow, nautical slang", goals: "find who stole her ledger", knowledge: "the harbor master is corrupt", secrets: "she smuggles moonpearls", attitude: "curious", voice_gender: "female", voice_age: "old", voice_style: "raspy, slow" }),
      tool("set_active_npc", { id: "mother-kessa" }),
      tool("add_fact", { fact: "The harbor is closed by order of the harbor master." }),
    );
  }
  const actor = said.match(/\n(\w[\w' -]*?) \(said aloud\)/)?.[1];
  if (/attack/i.test(said) && !/MODE: combat/.test(t)) calls.push(tool("start_combat", { enemies: [{ name: "Dock Thug", health: 8, defense: 12 }] }));
  // Enemy strikes back first, so the test sees an enemy attack even when the player's blow kills it.
  if (/MODE: combat/.test(t) && actor) calls.push(tool("enemy_attack", { enemy: "Dock Thug", target: actor, attack_bonus: 3, damage: 3 }));
  if (/blow lands/.test(said) && /success/.test(said)) calls.push(tool("apply_damage", { target: "Dock Thug", amount: 3 }));
  if (/flee|surrender|end the fight/i.test(said)) calls.push(tool("end_combat", {}));
  if (calls.length === 0) calls.push(tool("add_fact", { fact: "Mock: something happened." }));
  return msg(p.model, [text("…"), ...calls], "tool_use");
}
