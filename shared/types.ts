// Types shared by the Worker (game server) and the Svelte frontend.

export const STATS = ["strength", "agility", "intelligence", "wisdom", "charm", "stamina", "resist"] as const;
export type Stat = (typeof STATS)[number];

export type Mode = "narration" | "conversation" | "combat";
export type Strictness = "casual" | "standard" | "hardcore";

export interface Ability {
  name: string;
  description: string;
  usesPerRest: number; // 0 = unlimited
  usesLeft: number;
}

export interface Item {
  name: string;
  qty: number;
  description?: string;
}

export interface Character {
  id: string;
  name: string;
  concept: string;
  backstory: string;
  stats: Record<Stat, number>;
  health: number;
  maxHealth: number;
  abilities: Ability[];
  inventory: Item[];
  conditions: string[];
  ownerId: string | null; // player id currently playing this character
  pin: string | null; // optional 4-digit PIN to claim it
  readyMade?: boolean;
  present?: boolean; // owner is connected right now (set by the server)
}

export interface Npc {
  id: string;
  name: string;
  personality: string;
  speechStyle: string;
  goals: string;
  knowledge: string;
  secrets: string;
  attitude: string;
  memory: string[];
}

export interface Enemy {
  name: string;
  health: number;
  defense: number;
}

export interface Message {
  id: number;
  speaker: string; // character name, "DM", "SYSTEM"
  playerId?: string;
  text: string;
  aloud: boolean;
  kind?: "roll" | "rejected" | "event" | "join";
}

export interface Player {
  id: string;
  token: string;
  name: string;
  characterId: string | null;
  spectator: boolean;
  isHost: boolean;
}

export interface CampaignConfig {
  title: string;
  prompt: string; // the group's rough story idea; empty = let the AI invent one
  language: string;
  tone: string;
  strictness: Strictness;
}

export interface GameState {
  code: string;
  config: CampaignConfig;
  storyArc: string;
  started: boolean;
  createdAt: number;
  lastPlayed: number;
  mode: Mode;
  activeNpcId: string | null;
  scene: string;
  summary: string;
  summarizedUpTo: number;
  facts: string[];
  characters: Character[];
  npcs: Npc[];
  enemies: Enemy[];
  combat: { order: string[]; index: number; round: number } | null;
  players: Player[];
  log: Message[];
  pending: Message[];
  introductions: string[]; // character ids that joined mid-story and need an introduction
  nextMsgId: number;
  costUsd: number;
}

// Referee output for one player message.
export interface Ruling {
  messageIndex: number;
  character: string;
  verdict: "no_action" | "trivial" | "impossible" | "needs_roll";
  reason: string;
  stat?: Stat;
  dc?: number;
  usesAbility?: string;
  usesItem?: string;
  consumesItem?: boolean;
  successOutcome?: string;
  failureConsequence?: string;
}

export interface ResolvedAction {
  ruling: Ruling;
  result: "no_action" | "auto_success" | "rejected" | "success" | "failure";
  rollText?: string;
  note?: string;
}

// ---- What clients receive ----

export interface PublicCharacter {
  id: string;
  name: string;
  concept: string;
  health: number;
  maxHealth: number;
  conditions: string[];
  playerName: string | null;
  online: boolean;
  hasPin: boolean;
  readyMade: boolean;
}

export interface PublicView {
  code: string;
  title: string;
  language: string;
  strictness: Strictness;
  started: boolean;
  busy: boolean;
  mode: Mode;
  scene: string;
  activeNpc: { name: string; attitude: string } | null;
  enemies: Enemy[];
  combat: { order: { id: string; name: string }[]; activeId: string | null; round: number } | null;
  characters: PublicCharacter[];
  spectators: string[];
  log: Message[];
  pending: Message[];
  facts: string[];
  npcs: { name: string; attitude: string }[];
  summary: string;
  costUsd: number;
}

export interface YouView {
  playerId: string;
  name: string;
  isHost: boolean;
  spectator: boolean;
  character: Character | null; // full sheet, only ever sent to its owner
}

export interface NewCharacterInput {
  name: string;
  concept: string;
  backstory: string;
  stats: Record<Stat, number>;
  abilities: { name: string; description: string; usesPerRest: number }[];
  items: string[]; // "2x Healing potion" or "Rope"
  pin: string;
}

export type ClientMsg =
  | { t: "hello"; role: "screen" }
  | { t: "hello"; role: "phone"; token?: string }
  | { t: "join"; name: string }
  | { t: "claim"; characterId: string; pin?: string }
  | { t: "create_character"; character: NewCharacterInput }
  | { t: "spectate" }
  | { t: "leave_character" }
  | { t: "say"; text: string; aloud: boolean }
  | { t: "unsay"; id: number }
  | { t: "send_to_dm" }
  | { t: "begin" };

export type ServerMsg =
  | { t: "state"; view: PublicView; you: YouView | null }
  | { t: "welcome"; token: string }
  | { t: "unknown_token" }
  | { t: "error"; message: string };

export interface CampaignSummary {
  code: string;
  title: string;
  started: boolean;
  party: string[];
  summary: string;
  lastPlayed: number;
  createdAt: number;
}

// Stat rules for character creation, used by both the form and the server check.
export const STAT_MIN = 8;
export const STAT_MAX = 16;
export const STAT_BASE = 10;
export const STAT_POINTS = 8; // extra points above base 10; lowering a stat below 10 refunds points
export const MAX_ABILITIES = 3;
export const MAX_ITEMS = 6;

export const modifier = (score: number) => Math.floor((score - 10) / 2);
export const maxHealthFor = (stamina: number) => 14 + 2 * modifier(stamina);
export const statPointsUsed = (stats: Record<Stat, number>) => STATS.reduce((sum, k) => sum + (stats[k] - STAT_BASE), 0);
