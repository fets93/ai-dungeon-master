// Types shared by the Worker (game server) and the Svelte frontend.

export const STATS = ["strength", "agility", "intelligence", "wisdom", "charm", "stamina", "resist"] as const;
export type Stat = (typeof STATS)[number];

export type Mode = "narration" | "conversation" | "combat";
export type Strictness = "casual" | "standard" | "hardcore";

export type AbilityKind = "effect" | "boost" | "passive";

export interface Ability {
  name: string;
  description: string;
  usesPerRest: number; // 0 = unlimited
  usesLeft: number;
  kind?: AbilityKind; // effect: does something (rolls on cast) · boost: advantage on the next roll of boostStat · passive: always on
  boostStat?: Stat; // for boosts: which kind of roll gets advantage
}

// An active boost: advantage on the character's next roll with that stat (any stat if null).
export interface ActiveEffect {
  name: string;
  stat: Stat | null;
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
  avatarVersion?: number; // > 0 when a portrait is stored; bumps on every change (cache busting)
  effects?: ActiveEffect[];
}

export type VoiceGender = "male" | "female" | "neutral";
export type VoiceAge = "young" | "middle_aged" | "old";
export type VoiceMode = "off" | "browser" | "elevenlabs";

export interface NpcVoice {
  gender: VoiceGender;
  age: VoiceAge;
  style: string; // e.g. "slow and gravelly"
  voiceId?: string; // ElevenLabs voice, picked once and kept
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
  voice?: NpcVoice;
  stats?: Record<NpcStat, number>; // 6-18, 10 average
  disposition?: Disposition;
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
  kind?: "roll" | "rejected" | "event" | "join" | "recap" | "whisper";
  whisper?: boolean; // a player's secret action, only the DM and that player see it
  whisperTo?: string; // character id: message visible only to that character's player
  ability?: string; // the player used the "Use ability" button with this ability
  roll?: RollData; // structured dice result, for the dice animation
  preRoll?: number[]; // two d20s rolled and locked when an ability is cast (server only)
  castRoll?: number; // the first of them, shown to everyone right away
}

export interface RollData {
  characterId: string | null; // the character who rolled, or null for an enemy roll
  targetId?: string | null; // the character an enemy attack is aimed at
  label: string; // "Veyra: agility" or "Dock Thug attacks Veyra"
  d20: number; // the die that counts
  dice?: number[]; // both dice with advantage/disadvantage
  edge?: "advantage" | "disadvantage";
  mod: number;
  total: number;
  dc: number;
  success: boolean;
  degree?: "great" | "success" | "failure" | "bad"; // beat or missed the DC by 5+
  cast?: boolean; // only the locked roll at casting time: no DC yet
  preRolled?: boolean; // the dice were already shown at casting time
}

export interface Player {
  id: string;
  token: string;
  name: string;
  characterId: string | null;
  spectator: boolean;
  isHost: boolean;
}

export type NarrationStyle = "short" | "balanced" | "rich";

export interface CampaignConfig {
  style?: NarrationStyle; // how long and detailed the DM writes
  styleNote?: string; // free-text style wishes from the group
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
  blurb: string; // spoiler-free description for the players
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
  voiceMode: VoiceMode;
  narratorVoiceId: string | null;
  hostPin: string | null;
  paused: boolean;
}

// Referee output for one player message.
export interface Ruling {
  messageIndex: number;
  character: string;
  verdict: "no_action" | "trivial" | "impossible" | "needs_roll";
  reason: string;
  stat?: Stat;
  dc?: number;
  opposedBy?: { npcId: string; stat: NpcStat }; // the DC comes from an NPC's stat and disposition
  edge?: "advantage" | "disadvantage"; // from circumstances: help, conditions, position
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
  roll?: RollData;
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
  effects: string[];
  playerName: string | null;
  online: boolean;
  hasPin: boolean;
  readyMade: boolean;
  avatarVersion: number;
}

export interface PublicView {
  code: string;
  title: string;
  blurb: string;
  idea: string; // the group's own story idea, if any
  tone: string;
  style: NarrationStyle;
  styleNote: string;
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
  npcs: { id: string; name: string; attitude: string; gender: VoiceGender; age: VoiceAge }[];
  summary: string;
  costUsd: number;
  voiceMode: VoiceMode;
  narratorVoiceId: string | null;
  paused: boolean;
  lastPlayed: number;
  hasHostPin: boolean;
  canUndo: boolean;
  canControl: boolean; // this connection may use host controls
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
  abilities: { name: string; description: string; usesPerRest: number; kind?: AbilityKind; boostStat?: Stat }[];
  items: string[]; // "2x Healing potion" or "Rope"
  pin: string;
  avatar?: string | null; // data:image/jpeg;base64,… already resized on the phone
}

export type ClientMsg =
  | { t: "hello"; role: "screen" }
  | { t: "hello"; role: "phone"; token?: string }
  | { t: "join"; name: string }
  | { t: "claim"; characterId: string; pin?: string }
  | { t: "create_character"; character: NewCharacterInput }
  | { t: "spectate" }
  | { t: "leave_character" }
  | { t: "update_backstory"; text: string }
  | { t: "set_avatar"; dataUrl: string | null }
  | { t: "remove_character"; characterId: string; deleteIt: boolean }
  | { t: "say"; text: string; aloud: boolean; whisper?: boolean; ability?: string }
  | { t: "set_style"; style: NarrationStyle; styleNote: string }
  | { t: "set_ability_kind"; name: string; kind: AbilityKind; boostStat?: Stat }
  | { t: "unlock"; pin: string }
  | { t: "set_host_pin"; pin: string | null }
  | { t: "undo_turn" }
  | { t: "retry_turn" }
  | { t: "set_paused"; paused: boolean }
  | { t: "set_facts"; facts: string[] }
  | { t: "recap" }
  | { t: "unsay"; id: number }
  | { t: "send_to_dm" }
  | { t: "set_voice"; mode?: VoiceMode; narratorVoiceId?: string | null }
  | { t: "begin" };

export type ServerMsg =
  | { t: "state"; view: PublicView; you: YouView | null }
  | { t: "welcome"; token: string }
  | { t: "unknown_token" }
  | { t: "error"; message: string };

// A voice from the ElevenLabs library, as the app uses it.
export interface VoiceInfo {
  id: string;
  name: string;
  gender: string;
  age: string;
  accent: string;
  description: string;
}

export interface VoicesResponse {
  configured: boolean;
  voices: VoiceInfo[];
  credits?: { used: number; limit: number };
  error?: string;
}

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
export const BACKSTORY_MAX = 3000; // about 500 words
export const AVATAR_SIZE = 320; // px, square
export const AVATAR_MAX_BYTES = 200_000; // data URL length limit, far above a 320px JPEG
// Invite link: a real path (not #/play/…) so chat apps can show the campaign's title and description.
export const inviteUrl = (origin: string, code: string) => `${origin}/join/${code}`;
export const avatarUrl = (code: string, c: { id: string; avatarVersion?: number }) =>
  c.avatarVersion ? `/api/avatar/${code}/${encodeURIComponent(c.id)}?v=${c.avatarVersion}` : null;

// Every point of a stat counts: 16 = +6, 14 = +4, 8 = -2. Stats outweigh the d20's luck more
// than classic D&D (where 16 = +3), while a natural 20 still always succeeds.
export const modifier = (score: number) => score - 10;
// Health keeps the gentler classic curve, so stamina doesn't create huge health pools.
export const maxHealthFor = (stamina: number) => 14 + 2 * Math.floor((stamina - 10) / 2);

export type Disposition = "hostile" | "unfriendly" | "neutral" | "friendly" | "allied";
// Added to the difficulty when a player tries to sway an NPC.
export const DISPOSITION_MOD: Record<Disposition, number> = { hostile: 6, unfriendly: 3, neutral: 0, friendly: -3, allied: -6 };
export const NPC_STATS = ["strength", "agility", "intelligence", "wisdom", "charm"] as const;
export type NpcStat = (typeof NPC_STATS)[number];
export const statPointsUsed = (stats: Record<Stat, number>) => STATS.reduce((sum, k) => sum + (stats[k] - STAT_BASE), 0);
