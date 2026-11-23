# AI Dungeon Master

A tabletop role-playing game for friends with an AI game master. One shared main screen (TV or laptop) shows the story; everyone plays on their own phone. Runs free on Cloudflare's Workers Free plan; the only cost is the Claude API.

**How a turn works:** players talk (said aloud or table talk) → someone taps **Send to DM** → a strict **referee** (Claude Haiku) rules on every action → the **server** checks items and abilities and rolls the dice → the **DM** (Claude Sonnet) narrates the fixed outcome and changes the game only through tools.

## Features (MVP)

- **Campaign library** on the hub: new campaign from your story idea (or let the AI invent one), continue, restart with the same premise, export / import as JSON, delete. Narration language, tone and strictness per campaign.
- **Join by QR code** or 4-letter code. No accounts: each phone gets a device token and rejoins automatically after a screen lock or reload.
- **Characters**: invent your own concept and abilities (with uses per rest), stats (strength, agility, intelligence, wisdom, charm, stamina, resist) on a point budget, starting items, optional PIN. Or take one of three ready-made characters. Spectators can watch.
- **Phone**: Play (story, said aloud / table talk, Send to DM), Character (full sheet, private to you), Journal (scene, story so far, NPCs, facts).
- **Main screen**: story in large type, pending messages, party health, active NPC, combat turn order and enemies, dice results, API cost.
- **Game modes**: narration, conversation with an NPC, and turn-based combat (initiative order, server-rolled enemy attacks).
- **Fair play**: impossible claims are rejected, unknown items and used-up abilities refused by the server, consumables used up on the attempt, stat budget and PIN enforced server-side.
- **Late joiners** are introduced into the scene by the DM; absent players' characters stay in the background.

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
npm run e2e                                    # 39 server checks: joining, rules, combat, rejoin, export…
CHROME=/path/to/chrome npx tsx tests/ui.ts     # browser walkthrough with screenshots in screenshots/
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
