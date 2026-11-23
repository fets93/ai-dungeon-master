import type { Character } from "../../shared/types";

// Ready-made characters for guests or quick starts. Copied into every new campaign.
export function premadeCharacters(): Character[] {
  const base = { backstory: "", conditions: [], ownerId: null, pin: null, readyMade: true };
  return [
    {
      ...base,
      id: "premade-brann",
      name: "Brann",
      concept: "Dockside brawler with a debt to the wrong people",
      stats: { strength: 15, agility: 12, intelligence: 9, wisdom: 10, charm: 11, stamina: 13, resist: 8 },
      health: 16,
      maxHealth: 16,
      abilities: [
        { name: "Second Wind", description: "Once per rest, shrug off a hit: heal 6 health instantly.", usesPerRest: 1, usesLeft: 1 },
        { name: "Street Wise", description: "Knows how rough neighbourhoods work; easier to find people, fences and back alleys.", usesPerRest: 0, usesLeft: 0 },
      ],
      inventory: [
        { name: "Iron knuckles", qty: 1 },
        { name: "Rope", qty: 1 },
        { name: "Silver coins", qty: 10 },
      ],
    },
    {
      ...base,
      id: "premade-ilse",
      name: "Ilse",
      concept: "Hedge alchemist who sells cures that mostly work",
      stats: { strength: 8, agility: 12, intelligence: 15, wisdom: 12, charm: 12, stamina: 10, resist: 9 },
      health: 14,
      maxHealth: 14,
      abilities: [
        { name: "Flash Powder", description: "Throw a pouch that blinds everyone within a few steps for a moment. Not damaging.", usesPerRest: 2, usesLeft: 2 },
        { name: "Know Your Poisons", description: "Identify any substance, potion or poison by smell or taste.", usesPerRest: 0, usesLeft: 0 },
      ],
      inventory: [
        { name: "Healing potion", qty: 2 },
        { name: "Dagger", qty: 1 },
        { name: "Alchemy kit", qty: 1 },
      ],
    },
    {
      ...base,
      id: "premade-veyra",
      name: "Veyra",
      concept: "Storm-touched sailor, survivor of a ship that vanished",
      stats: { strength: 10, agility: 13, intelligence: 10, wisdom: 14, charm: 9, stamina: 12, resist: 10 },
      health: 16,
      maxHealth: 16,
      abilities: [
        { name: "Call the Squall", description: "Summon a violent gust of wind that knocks one person or object off their feet. Needs open air.", usesPerRest: 2, usesLeft: 2 },
        { name: "Sea Sense", description: "Always knows which way the sea is and senses unnatural things in water.", usesPerRest: 0, usesLeft: 0 },
      ],
      inventory: [
        { name: "Cutlass", qty: 1 },
        { name: "Spyglass", qty: 1 },
      ],
    },
  ];
}
