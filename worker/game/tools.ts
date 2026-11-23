import type Anthropic from "@anthropic-ai/sdk";
import { STATS } from "../../shared/types";

type Tool = Anthropic.Tool;

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: "integer", description });

export const REFEREE_TOOL: Tool = {
  name: "adjudicate",
  description: "Return one binding ruling per player message.",
  input_schema: {
    type: "object",
    properties: {
      rulings: {
        type: "array",
        items: {
          type: "object",
          properties: {
            message_index: num("Index of the message in MESSAGES TO RULE ON"),
            character: str("Character name who acts"),
            verdict: { type: "string", enum: ["no_action", "trivial", "impossible", "needs_roll"] },
            reason: str("One short sentence explaining the ruling"),
            stat: { type: "string", enum: [...STATS] },
            dc: num("Difficulty class, only for needs_roll"),
            uses_ability: str("Exact ability name if the action relies on one"),
            uses_item: str("Exact item name if the action relies on one"),
            consumes_item: { type: "boolean", description: "True if the item is used up by the attempt (potion, scroll, thrown flask)" },
            success_outcome: str("What happens on success"),
            failure_consequence: str("What it costs on failure"),
          },
          required: ["message_index", "character", "verdict", "reason"],
        },
      },
    },
    required: ["rulings"],
  },
};

export const DM_TOOLS: Tool[] = [
  { name: "set_scene", description: "Set the current scene description (where the party is, what is around).", input_schema: { type: "object", properties: { scene: str("1-3 sentences") }, required: ["scene"] } },
  { name: "set_mode", description: "Switch between narration and conversation. Combat uses start_combat / end_combat.", input_schema: { type: "object", properties: { mode: { type: "string", enum: ["narration", "conversation"] } }, required: ["mode"] } },
  {
    name: "enemy_attack",
    description: "An enemy attacks a player character during combat. The server rolls d20 + attack_bonus against the target's defense and applies the damage on a hit.",
    input_schema: { type: "object", properties: { enemy: str("Enemy name"), target: str("Character name"), attack_bonus: num("0-8, typical 3"), damage: num("Damage on a hit, 1-12, typical 3-6") }, required: ["enemy", "target"] },
  },
  {
    name: "create_npc",
    description: "Create a named NPC before they first speak. Saved for the rest of the campaign.",
    input_schema: {
      type: "object",
      properties: {
        name: str("Name"),
        personality: str("Personality in a few words"),
        speech_style: str("How they talk"),
        goals: str("What they want"),
        knowledge: str("What they know that matters"),
        secrets: str("What they hide"),
        attitude: str("Attitude toward the party"),
        voice_gender: { type: "string", enum: ["male", "female", "neutral"], description: "How their voice sounds, used for text-to-speech" },
        voice_age: { type: "string", enum: ["young", "middle_aged", "old"] },
        voice_style: str("2-5 words on the voice's quality, e.g. 'deep, gravelly, slow' or 'bright and quick'"),
      },
      required: ["name", "personality", "speech_style", "goals", "voice_gender", "voice_age"],
    },
  },
  { name: "update_npc", description: "Change an NPC's attitude or add something they will remember.", input_schema: { type: "object", properties: { id: str("NPC id"), attitude: str("New attitude"), remember: str("A memory to keep") }, required: ["id"] } },
  { name: "set_active_npc", description: "The party is now talking to this NPC (switches to conversation mode).", input_schema: { type: "object", properties: { id: str("NPC id") }, required: ["id"] } },
  { name: "add_fact", description: "Record a lasting fact about the world.", input_schema: { type: "object", properties: { fact: str("One sentence") }, required: ["fact"] } },
  { name: "give_item", description: "Give a character an item.", input_schema: { type: "object", properties: { character: str("Name"), item: str("Item name"), qty: num("Quantity"), description: str("Short description") }, required: ["character", "item"] } },
  { name: "remove_item", description: "Remove an item from a character (used up, lost, stolen).", input_schema: { type: "object", properties: { character: str("Name"), item: str("Exact item name"), qty: num("Quantity") }, required: ["character", "item"] } },
  { name: "apply_damage", description: "Damage a character or an enemy.", input_schema: { type: "object", properties: { target: str("Character or enemy name"), amount: num("Damage, usually 1-8") }, required: ["target", "amount"] } },
  { name: "heal", description: "Heal a character.", input_schema: { type: "object", properties: { character: str("Name"), amount: num("Health") }, required: ["character", "amount"] } },
  { name: "add_condition", description: "Add a condition (poisoned, frightened, restrained...).", input_schema: { type: "object", properties: { character: str("Name"), condition: str("Condition") }, required: ["character", "condition"] } },
  { name: "remove_condition", description: "Remove a condition.", input_schema: { type: "object", properties: { character: str("Name"), condition: str("Condition") }, required: ["character", "condition"] } },
  {
    name: "start_combat",
    description: "Start combat against enemies.",
    input_schema: {
      type: "object",
      properties: {
        enemies: {
          type: "array",
          items: { type: "object", properties: { name: str("Unique name, e.g. 'Bandit 1'"), health: num("Health, 4-30 typical"), defense: num("DC to hit, 10-16 typical") }, required: ["name", "health", "defense"] },
        },
      },
      required: ["enemies"],
    },
  },
  { name: "end_combat", description: "End combat, back to narration.", input_schema: { type: "object", properties: {} } },
  { name: "rest", description: "The party takes a long rest: abilities restored, half health back.", input_schema: { type: "object", properties: {} } },
  {
    name: "request_roll",
    description: "Ask for a roll that comes up during narration (perception, a trap's save). The server rolls immediately and returns the result; narrate according to it.",
    input_schema: { type: "object", properties: { character: str("Name"), stat: { type: "string", enum: [...STATS] }, dc: num("DC"), reason: str("Why"), failure_consequence: str("What failure costs") }, required: ["character", "stat", "dc", "reason"] },
  },
];

export const STORY_TOOL: Tool = {
  name: "set_story",
  description: "Return the campaign title and high-level story arc.",
  input_schema: {
    type: "object",
    properties: { title: str("Short evocative title"), story_arc: str("High-level arc, under 180 words") },
    required: ["title", "story_arc"],
  },
};
