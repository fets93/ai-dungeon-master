// The Send to DM pipeline: referee -> server checks and dice -> DM narration with tools.
import type Anthropic from "@anthropic-ai/sdk";
import type { GameState, Message, ResolvedAction, Ruling } from "../../shared/types";
import type { CreateParams, Llm } from "./llm";
import { dmSystem, dmTurnContext, OPENING_INSTRUCTION, refereeContext, refereeSystem, storyRequest, storySystem, SUMMARY_SYSTEM } from "./prompts";
import { advanceCombatTurn, applyTool, resolve } from "./rules";
import { DM_TOOLS, REFEREE_TOOL, STORY_TOOL } from "./tools";
import { plainSpeech } from "../../shared/speech";

const CACHED_TOOLS: Anthropic.Tool[] = DM_TOOLS.map((t, i) => (i === DM_TOOLS.length - 1 ? { ...t, cache_control: { type: "ephemeral" } } : t));

// Claude Opus 5.5, Sonnet 5.5, Fable and Mythos reject forced tool use (tool_choice "tool"/"any").
// For those, ask for the tool in the prompt with tool_choice "auto" and retry once if it answers in text.
const supportsForcedTools = (model: string) => !/opus-5-5|sonnet-5-5|fable|mythos/.test(model);

async function callTool(llm: Llm, role: string, params: CreateParams, toolName: string): Promise<Record<string, unknown> | null> {
  const forced = supportsForcedTools(params.model);
  const messages = [...params.messages];
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await llm.call(role, {
      ...params,
      messages,
      tool_choice: forced ? { type: "tool", name: toolName } : { type: "auto" },
    });
    const block = msg.content.find((b) => b.type === "tool_use" && b.name === toolName) as Anthropic.ToolUseBlock | undefined;
    if (block) return block.input as Record<string, unknown>;
    messages.push({ role: "assistant", content: msg.content.filter((b) => b.type === "text").length ? msg.content : "(no answer)" });
    messages.push({ role: "user", content: `Answer only by calling the ${toolName} tool now.` });
  }
  return null;
}

function log(s: GameState, m: Omit<Message, "id">) {
  s.log.push({ ...m, id: s.nextMsgId++ });
}

async function runReferee(s: GameState, llm: Llm, batch: Message[]): Promise<Ruling[]> {
  const tableTalk: Ruling[] = batch
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !m.aloud)
    .map(({ m, i }) => ({ messageIndex: i, character: m.speaker, verdict: "no_action" as const, reason: "table talk" }));
  if (!batch.some((m) => m.aloud)) return tableTalk;

  // The referee only sees what was said aloud; table talk is not an action.
  const aloudOnly = { ...s, pending: batch.filter((m) => m.aloud) };
  const indexMap = batch.map((m, i) => (m.aloud ? i : -1)).filter((i) => i >= 0);
  const input = await callTool(
    llm,
    "referee",
    {
      model: llm.refereeModel,
      max_tokens: 1200,
      system: refereeSystem(s) + "\n\nAlways answer by calling the adjudicate tool, never in plain text.",
      tools: [REFEREE_TOOL],
      messages: [{ role: "user", content: refereeContext(aloudOnly) }],
    },
    "adjudicate",
  );
  const raw = ((input as any)?.rulings ?? []) as any[];
  const seen = new Set<number>();
  const rulings: Ruling[] = [];
  for (const r of raw) {
    const idx = indexMap[r.message_index];
    if (idx === undefined || seen.has(idx)) continue;
    seen.add(idx);
    rulings.push({
      messageIndex: idx,
      character: batch[idx].speaker, // trust the server's speaker, not the model's
      verdict: ["no_action", "trivial", "impossible", "needs_roll"].includes(r.verdict) ? r.verdict : "no_action",
      reason: r.reason ?? "",
      stat: r.stat,
      dc: r.dc,
      usesAbility: r.uses_ability || undefined,
      usesItem: r.uses_item || undefined,
      consumesItem: !!r.consumes_item,
      successOutcome: r.success_outcome,
      failureConsequence: r.failure_consequence,
    });
  }
  return [...rulings, ...tableTalk].sort((a, b) => a.messageIndex - b.messageIndex);
}

function describeResolved(batch: Message[], resolved: ResolvedAction[]): string {
  return batch
    .map((m, i) => {
      const head = `${m.speaker}${m.aloud ? " (said aloud)" : " (table talk, NPCs did not hear this)"}: ${m.text}`;
      const r = resolved.find((x) => x.ruling.messageIndex === i);
      if (!r || r.result === "no_action") return head;
      const rl = r.ruling;
      const spent = rl.consumesItem && r.result !== "rejected" ? ` (${rl.usesItem} already removed from inventory)` : "";
      switch (r.result) {
        case "auto_success":
          return `${head}\n   -> SUCCEEDS without a roll. ${rl.reason}${spent}`;
        case "rejected":
          return `${head}\n   -> REJECTED: ${r.note}. This does not happen; narrate why.`;
        case "success":
          return `${head}\n   -> ${r.rollText}${spent}\n   -> Outcome: ${rl.successOutcome ?? "it works"}`;
        case "failure":
          return `${head}\n   -> ${r.rollText}${spent}\n   -> Consequence (apply it with tools): ${rl.failureConsequence ?? "it goes wrong"}`;
      }
    })
    .join("\n");
}

async function runDm(s: GameState, llm: Llm, userText: string): Promise<string> {
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: userText }];
  let narration = "";
  for (let step = 0; step < 6; step++) {
    const msg = await llm.call("dm", {
      model: llm.dmModel,
      max_tokens: 1500,
      system: [{ type: "text", text: dmSystem(s), cache_control: { type: "ephemeral" } }],
      tools: CACHED_TOOLS,
      messages,
    });
    for (const b of msg.content) if (b.type === "text" && b.text.trim() !== "…") narration += (narration ? "\n\n" : "") + b.text.trim();
    const uses = msg.content.filter((b) => b.type === "tool_use") as Anthropic.ToolUseBlock[];
    if (uses.length === 0 || msg.stop_reason !== "tool_use") break;
    const results: Anthropic.ToolResultBlockParam[] = uses.map((u) => {
      try {
        const out = applyTool(s, u.name, u.input as Record<string, unknown>);
        if (out.roll) log(s, { speaker: "SYSTEM", text: out.roll, aloud: true, kind: "roll" });
        return { type: "tool_result", tool_use_id: u.id, content: out.text };
      } catch (e) {
        return { type: "tool_result", tool_use_id: u.id, content: (e as Error).message, is_error: true };
      }
    });
    messages.push({ role: "assistant", content: msg.content });
    messages.push({ role: "user", content: results });
  }
  return narration.trim() || "(The DM pauses, then nods for you to continue.)";
}

export async function generateStory(s: GameState, llm: Llm) {
  const input = ((await callTool(
    llm,
    "story",
    {
      model: llm.dmModel,
      max_tokens: 1200,
      system: storySystem() + "\n\nAnswer only by calling the set_story tool.",
      tools: [STORY_TOOL],
      messages: [{ role: "user", content: storyRequest(s) }],
    },
    "set_story",
  )) ?? {}) as { title?: string; story_arc?: string; blurb?: string };
  if (!input.story_arc) throw new Error("The DM couldn't write the story. Try opening the campaign again.");
  if (input.story_arc) s.storyArc = input.story_arc;
  if (input.blurb) s.blurb = input.blurb.slice(0, 600);
  if (input.title && (!s.config.title || s.config.title === "New campaign")) s.config.title = input.title.slice(0, 80);
}

export async function opening(s: GameState, llm: Llm) {
  if (!s.storyArc) await generateStory(s, llm);
  s.introductions = [];
  const narration = await runDm(s, llm, dmTurnContext(s, "(Nothing yet: the adventure starts now.)", OPENING_INSTRUCTION));
  log(s, { speaker: "DM", text: narration, aloud: true });
  s.started = true;
}

// `batch` is taken out of s.pending by the caller, so messages typed while the DM is thinking wait for the next send.
export async function sendToDm(s: GameState, llm: Llm, batch: Message[]) {
  if (batch.length === 0) throw new Error("Nothing to send.");
  const rulings = await runReferee(s, llm, batch);
  const resolved = rulings.map((r) => resolve(s, r));
  const playersText = describeResolved(batch, resolved);

  for (const m of batch) s.log.push(m);
  for (const r of resolved) {
    if (r.rollText) log(s, { speaker: "SYSTEM", text: r.rollText, aloud: true, kind: "roll" });
    else if (r.result === "rejected") log(s, { speaker: "SYSTEM", text: `${r.ruling.character}: ${r.note}`, aloud: true, kind: "rejected" });
  }

  const wasCombat = s.mode === "combat";
  const narration = await runDm(s, llm, dmTurnContext(s, playersText));
  s.introductions = [];
  log(s, { speaker: "DM", text: narration, aloud: true });
  // The turn that starts a fight doesn't use up anyone's combat turn: initiative order begins fresh.
  if (wasCombat && s.mode === "combat") advanceCombatTurn(s);
  await maybeSummarize(s, llm);
}

async function maybeSummarize(s: GameState, llm: Llm) {
  const keep = 24;
  if (s.log.length - s.summarizedUpTo < keep + 30) return;
  const chunk = s.log.slice(s.summarizedUpTo, s.log.length - keep);
  const msg = await llm.call("summary", {
    model: llm.refereeModel,
    max_tokens: 600,
    system: SUMMARY_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Current summary:\n${s.summary || "(none)"}\n\nNew log entries:\n${chunk.map((m) => `${m.speaker}: ${plainSpeech(m.text, s.npcs)}`).join("\n")}\n\nWrite the updated summary.`,
      },
    ],
  });
  const text = msg.content
    .filter((b) => b.type === "text")
    .map((b) => (b as Anthropic.TextBlock).text)
    .join("")
    .trim();
  if (text) {
    s.summary = text;
    s.summarizedUpTo = s.log.length - keep;
  }
}
