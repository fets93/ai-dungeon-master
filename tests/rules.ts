// Unit tests for the dice rules: npx tsx tests/rules.ts
import { modifier, type Character, type GameState } from "../shared/types";
import { opposedDc, resolve, rollD20 } from "../worker/game/rules";

let failures = 0;
const check = (cond: unknown, label: string) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
};

function game(charm = 16, npcWisdom = 14, disposition: "neutral" | "hostile" | "friendly" = "neutral"): GameState {
  const hero: Character = {
    id: "hero",
    name: "Hero",
    concept: "",
    backstory: "",
    stats: { strength: 10, agility: 12, intelligence: 10, wisdom: 10, charm, stamina: 10, resist: 10 },
    health: 14,
    maxHealth: 14,
    abilities: [
      { name: "Wiggle Moustache", description: "Charming wiggle", usesPerRest: 2, usesLeft: 2, kind: "boost", boostStat: "charm" },
      { name: "Street Wise", description: "Knows the docks", usesPerRest: 0, usesLeft: 0, kind: "passive" },
    ],
    inventory: [],
    conditions: [],
    effects: [],
    ownerId: "p1",
    pin: null,
  };
  return {
    characters: [hero],
    npcs: [{ id: "guard", name: "Guard", personality: "", speechStyle: "", goals: "", knowledge: "", secrets: "", attitude: "", memory: [], stats: { strength: 12, agility: 10, intelligence: 10, wisdom: npcWisdom, charm: 10 }, disposition }],
  } as unknown as GameState;
}
const persuade = { messageIndex: 0, character: "Hero", verdict: "needs_roll" as const, reason: "", stat: "charm" as const, opposedBy: { npcId: "guard", stat: "wisdom" as const } };

// Modifiers: stat - 10
check(modifier(16) === 6 && modifier(14) === 4 && modifier(8) === -2 && modifier(10) === 0, "modifier = stat - 10 (16 → +6, 14 → +4, 8 → -2)");

// Steffen's example: charm 16 vs wisdom 14, neutral → DC 14
check(opposedDc(game(), "guard", "wisdom")?.dc === 14, "DC vs neutral NPC with wisdom 14 = 10 + 4 = 14");
check(opposedDc(game(16, 14, "hostile"), "guard", "wisdom")?.dc === 20, "hostile NPC adds +6 → DC 20");
check(opposedDc(game(16, 14, "friendly"), "guard", "wisdom")?.dc === 11, "friendly NPC gives -3 → DC 11");

const r2 = resolve(game(), persuade, [2, 15]);
check(r2.roll!.total === 8 && r2.result === "failure" && r2.roll!.degree === "bad", "roll 2: 2 + 6 = 8 vs 14 → bad failure (missed by 6)");
const r20 = resolve(game(), persuade, [20, 3]);
check(r20.roll!.total === 26 && r20.result === "success" && r20.roll!.degree === "great", "roll 20: natural 20, 26 vs 14 → great success");
const r10 = resolve(game(), persuade, [10, 3]);
check(r10.roll!.total === 16 && r10.roll!.degree === "success", "roll 10: 16 vs 14 → success (by 2)");
const r1 = resolve(game(30), persuade, [1, 20]);
check(r1.result === "failure", "natural 1 always fails, even with a huge bonus");

// Boost: Wiggle Moustache gives advantage on the next charm roll, then it's used up
const g = game();
const boost = resolve(g, { messageIndex: 0, character: "Hero", verdict: "trivial", reason: "", usesAbility: "Wiggle Moustache" });
const hero = g.characters[0];
check(boost.result === "auto_success" && hero.effects?.length === 1 && hero.abilities[0].usesLeft === 1, "boost always works, spends a use and becomes an active effect");
const adv = resolve(g, persuade, [5, 17]);
check(adv.roll!.edge === "advantage" && adv.roll!.d20 === 17 && adv.rollText!.includes("with Wiggle Moustache"), "next charm roll has advantage: dice [5, 17] → 17 counts");
check(hero.effects?.length === 0, "the boost is used up by that roll");
const plain = resolve(g, persuade, [5, 17]);
check(plain.roll!.d20 === 5 && !plain.roll!.edge, "the roll after that is normal again");
const g2 = game();
resolve(g2, { messageIndex: 0, character: "Hero", verdict: "trivial", reason: "", usesAbility: "Wiggle Moustache" });
const climb = resolve(g2, { messageIndex: 0, character: "Hero", verdict: "needs_roll", reason: "", stat: "agility", dc: 12 }, [5, 17]);
check(climb.roll!.d20 === 5 && g2.characters[0].effects?.length === 1, "a charm boost doesn't affect an agility roll (and stays active)");

// Disadvantage, and both cancelling out
check(resolve(game(), { ...persuade, edge: "disadvantage" }, [5, 17]).roll!.d20 === 5, "disadvantage: dice [5, 17] → 5 counts");
const g3 = game();
resolve(g3, { messageIndex: 0, character: "Hero", verdict: "trivial", reason: "", usesAbility: "Wiggle Moustache" });
const both = resolve(g3, { ...persuade, edge: "disadvantage" }, [5, 17]);
check(both.roll!.d20 === 5 && !both.roll!.edge, "advantage (boost) + disadvantage cancel out: first die counts");

// Passive abilities can't be cast
check(resolve(game(), { messageIndex: 0, character: "Hero", verdict: "trivial", reason: "", usesAbility: "Street Wise" }).result === "rejected", "passive abilities can't be cast");

// Success chances match the table shown to the user (charm 16 vs wisdom 14, neutral)
const chance = (charm: number, edge?: "advantage") => {
  let wins = 0;
  for (let a = 1; a <= 20; a++)
    for (let b = 1; b <= 20; b++) if (resolve(game(charm), { ...persuade, edge }, [a, b]).result === "success") wins++;
  return wins / 400;
};
check(Math.abs(chance(16) - 0.65) < 0.001, `charm 16: ${chance(16) * 100}% success (expected 65%)`);
check(Math.abs(chance(8) - 0.25) < 0.001, `charm 8: ${chance(8) * 100}% success (expected 25%)`);
check(Math.abs(chance(16, "advantage") - 0.8775) < 0.001, `charm 16 with advantage: ${chance(16, "advantage") * 100}% (expected 87.75%)`);

// Fresh dice are fair
const counts = new Array(21).fill(0);
for (let i = 0; i < 100000; i++) counts[rollD20()]++;
check(counts[0] === 0 && counts.slice(1).every((c) => Math.abs(c / 100000 - 0.05) < 0.004), "d20 uniform over 100k rolls");

console.log(failures ? `\n${failures} FAILED` : "\nAll rule checks passed");
process.exit(failures ? 1 : 0);
