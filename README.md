# AI Dungeon Master

A tabletop role-playing game for friends with an AI game master. One shared main screen (TV or laptop) shows the story; everyone plays on their own phone. Runs free on Cloudflare's Workers Free plan; the only cost is the Claude API.

**How a turn works:** players talk (said aloud or table talk) → someone taps **Send to DM** → a strict **referee** (Claude Haiku) rules on every action → the **server** checks items and abilities and rolls the dice → the **DM** (Claude Sonnet) narrates the fixed outcome and changes the game only through tools.

## Features (MVP)

- **Campaign library** on the hub: new campaign from your story idea (or let the AI invent one), continue, restart with the same premise, export / import as JSON, delete. Narration language, tone and strictness per campaign.
- **Join by QR code** or 4-letter code. No accounts: each phone gets a device token and rejoins automatically after a screen lock or reload.
- **Portraits**: optional picture per character from the phone's camera or gallery, shrunk on the phone to a small square; shown on the main screen, in the chat and on the sheet, changeable later. Included in export/import.
- **Characters**: invent your own concept and abilities (with uses per rest), stats (strength, agility, intelligence, wisdom, charm, stamina, resist) on a point budget, starting items and a 4-digit PIN. Or take one of three ready-made guest characters (they stay in their campaign). Spectators can watch.
- **Saved characters**: characters you create live outside campaigns and carry their stats and items into the next one (joining a new campaign counts as a rest). A character is in one campaign at a time: picking one that's elsewhere asks whether to move it or make a copy under a new name. Deleting a campaign releases its characters instead of deleting them. The library lists them; deleting one needs its PIN. Characters from before v0.11 stay in their campaign.
- **Phone**: Play (story, said aloud / table talk, Send to DM), Character (full sheet, private to you), Journal (scene, story so far, NPCs, facts).
- **Main screen**: story in large type, pending messages, party health, active NPC, combat turn order and enemies, dice results, API cost.
- **Game modes**: narration, conversation with an NPC, and turn-based combat (initiative order, server-rolled enemy attacks).
- **Fair play**: impossible claims are rejected, unknown items and used-up abilities refused by the server, consumables used up on the attempt, stat budget and PIN enforced server-side.
- **Late joiners** are introduced into the scene by the DM; absent players' characters stay in the background.
- **Use ability button**: pick one of your character's abilities (uses left shown), say how or at whom, and it goes into the conversation; the server always counts the use.
- **Dice animation**: each roll tumbles and lands on the real result on the roller's phone (and on the target's phone for enemy attacks) and in the corner of the main screen, before the DM has finished writing. Rolls use cryptographic randomness.
- **Narration style**: Short, Balanced or Rich, plus free-text style wishes; set at creation, changeable in the Host panel.
- **Host controls**: undo or retry the DM's last turn, pause, "Previously on…" recap (suggested automatically after a break), edit the established facts, optional host PIN that locks the main screen's controls. On the main screen and on the host's phone (Journal tab).
- **Whispers**: secret actions to the DM. Referee and dice still apply, but the action, its roll and the DM's private answer appear only on that player's phone; the public narration shows only what others notice.
- **Voice**: the main screen can read the DM aloud: Off, Browser (free, built-in voice) or ElevenLabs. With ElevenLabs every NPC gets its own matching voice from your voice library; ▶ replays any DM response.

## Rules

**Checks:** d20 + modifier vs a difficulty (DC). The **modifier is stat − 10**: 16 → +6, 14 → +4, 8 → −2. Stats count about twice as much as in classic D&D, so a well-built character beats a lucky one more often; a natural 20 still always succeeds and a natural 1 always fails.

**Difficulty:**
- Against the world (climbing, traps, enemy defense): the referee picks from 8 easy · 12 moderate · 16 hard · 20 very hard · 24 nearly impossible (±2 for casual/hardcore).
- Against an NPC (persuade, deceive, intimidate, outwit, outrun): **10 + NPC's stat modifier + disposition**. Wisdom resists persuasion and intimidation, intelligence sees through lies. Disposition: hostile +6, unfriendly +3, neutral 0, friendly −3, allied −6. The DM gives every NPC stats and updates their disposition.
- Example: charm 16 vs a neutral NPC with wisdom 14 → DC 14. Roll 2 → 8, bad failure. Roll 10 → 16, success. Roll 20 → great success. Success chance 65% (25% with charm 8, 88% with advantage).

**Degrees:** beat the DC by 5+ → great success (a bonus); miss by 5+ → bad failure (a real cost).

**Advantage / disadvantage:** roll two d20, keep the higher / lower. From boost abilities, from help by another character or a clear edge, or (disadvantage) from conditions like poisoned. They cancel each other out.

**Abilities** have a type:
- **Effect** does something. Casting rolls the dice immediately; both dice (for a possible advantage) are locked on the server, the referee sets the DC without seeing them, and a cast can't be taken back.
- **Boost** always works and gives advantage on the character's next roll of one stat (e.g. Wiggle Moustache → charm). Shown as an active effect until used; a rest clears it.
- **Passive** is always on and never cast.

Players can change an ability's type on their Character tab. Abilities from before this system: unlimited ones became passive, the rest effects.

## Voice (ElevenLabs)

1. In ElevenLabs, create an API key (Developers → API Keys). Give it access to Text to Speech, Voices (read) and User (read, for the credit display).
2. `npx wrangler secret put ELEVENLABS_API_KEY` and paste the key. No redeploy needed.
3. On the main screen, set Voice to **ElevenLabs**. Pick a narrator or leave it on Automatic.

How it works: the DM marks NPC dialogue as `{{npc-id: words}}`. When it creates an NPC it also describes the voice (gender, age, style), and the server picks the best match from your library once and keeps it. Speech uses the `eleven_flash_v2_5` model (0.5 credits per character, 32 languages incl. German). A typical 3-hour session is about 100k characters, so roughly 50k credits. Audio is cached, so ▶ replays are free. Browsers block sound until the page is clicked once; the main screen shows a button for that.

## Deploy (about 10 minutes)

You need: Node 20+, a free [Cloudflare account](https://dash.cloudflare.com/sign-up), and a [Claude Console](https://platform.claude.com) API key with credits.

```bash
npm install
npx wrangler login                         # opens the browser once
npx wrangler secret put ANTHROPIC_API_KEY  # paste your key; it stays on Cloudflare
npm run deploy                             # builds the app and deploys the Worker
```

Wrangler prints the URL, e.g. `https://ai-dungeon-master.<your-subdomain>.workers.dev`. Open it on the TV or laptop, create a campaign, and have everyone scan the QR code.

Optional settings (Cloudflare dashboard → Worker → Settings → Variables, or `wrangler secret put`):

| Variable | Default | |
|---|---|---|
| `DM_MODEL` | `claude-sonnet-5-5` | `claude-opus-5-5` for richer narration (about 2× cost) |
| `REFEREE_MODEL` | `claude-haiku-5-5` | Also used for log summaries |

Anyone with the URL can see the campaign library, so share the link only with your group.

## Develop locally

```bash
npm install
cp .dev.vars.example .dev.vars   # MOCK_LLM=1 = fake DM, no API key, no cost
npm run build && npm run dev:worker    # http://localhost:8787
```

For live frontend changes, also run `npm run dev:web` (Vite on port 5173, proxies API and WebSockets to 8787). To test with the real DM locally, put `ANTHROPIC_API_KEY=...` in `.dev.vars` and remove `MOCK_LLM`. Phones on the same Wi-Fi can join via your computer's IP address.

Tests (with `npm run dev:worker` running in mock mode):

```bash
npm run e2e                                    # server checks: joining, rules, combat, voice, rejoin, export…
CHROME=/path/to/chrome npx tsx tests/ui.ts     # browser walkthrough with screenshots in screenshots/
npm run test:rules                             # dice math, advantage, boosts, opposed DCs (no server needed)
npm run check                                  # TypeScript + Svelte checks
```

## Code map

| Path | What |
|---|---|
| `worker/index.ts` | API for the library, WebSocket routing, static app |
| `worker/campaign.ts` | One Durable Object per campaign: state, WebSocket hub, join/claim/create, turn flow |
| `worker/registry.ts` | Campaign library (one Durable Object) |
| `worker/game/prompts.ts` | Referee, DM, story and summary prompts: **where most tuning happens** |
| `worker/game/rules.ts` | Dice, item and ability checks, all DM tool effects, combat turns |
| `worker/game/engine.ts` | Send to DM pipeline, opening, story generation, summaries |
| `worker/game/tools.ts` | Tool schemas for referee and DM |
| `worker/game/mock.ts` | Fake LLM for local development and tests |
| `shared/types.ts` | Types and character rules shared by server and app |
| `src/views/` | `Hub.svelte` (library), `Screen.svelte` (main screen), `Phone.svelte` (player) |

## Not in the MVP yet

From the plan, for later: AI story pitches with voting, whispers (private actions), "previously on" recap, host controls (undo DM turn, kick, edit facts), XP and leveling, AI autopilot for absent players, DM voice, scene images, content limits, referee review of invented abilities at creation.
