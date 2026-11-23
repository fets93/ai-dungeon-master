// Worker entry: a small JSON API for the campaign library, WebSocket routing to each campaign,
// and the static Svelte app for everything else.
import type { CampaignConfig, GameState, Strictness } from "../shared/types";
import { Campaign } from "./campaign";
import { Registry } from "./registry";

export { Campaign, Registry };

export interface Env {
  ASSETS: Fetcher;
  CAMPAIGN: DurableObjectNamespace<Campaign>;
  REGISTRY: DurableObjectNamespace<Registry>;
  ANTHROPIC_API_KEY?: string;
  MOCK_LLM?: string;
  DM_MODEL?: string;
  REFEREE_MODEL?: string;
}

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I or O, so codes are not confused with 1 and 0
const registry = (env: Env) => env.REGISTRY.get(env.REGISTRY.idFromName("global"));
const campaign = (env: Env, code: string) => env.CAMPAIGN.get(env.CAMPAIGN.idFromName(code));
const json = (data: unknown, status = 200) => Response.json(data, { status });

async function newCode(env: Env): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => ALPHABET[b % ALPHABET.length]).join("");
    if (!(await registry(env).get(code))) return code;
  }
  throw new Error("Could not find a free campaign code.");
}

function readConfig(body: any): CampaignConfig {
  const strictness: Strictness = ["casual", "standard", "hardcore"].includes(body?.strictness) ? body.strictness : "standard";
  return {
    title: String(body?.title ?? "").trim().slice(0, 80) || "New campaign",
    prompt: String(body?.prompt ?? "").trim().slice(0, 1500),
    language: String(body?.language ?? "").trim().slice(0, 30) || "English",
    tone: String(body?.tone ?? "").trim().slice(0, 120) || "adventurous with some humor",
    strictness,
  };
}

async function api(request: Request, env: Env, path: string[]): Promise<Response> {
  const method = request.method;
  // /api/campaigns
  if (path.length === 1 && method === "GET") return json(await registry(env).list());
  if (path.length === 1 && method === "POST") {
    const config = readConfig(await request.json().catch(() => ({})));
    const code = await newCode(env);
    const summary = await campaign(env, code).init(code, config);
    await registry(env).upsert(summary);
    return json({ code }, 201);
  }
  // /api/campaigns/import
  if (path[1] === "import" && method === "POST") {
    const state = (await request.json().catch(() => null)) as GameState | null;
    if (!state?.config || !Array.isArray(state.characters)) return json({ error: "Not a campaign export file." }, 400);
    const code = await newCode(env);
    const summary = await campaign(env, code).init(code, readConfig(state.config), { ...state, config: readConfig(state.config), pending: [] });
    await registry(env).upsert(summary);
    return json({ code }, 201);
  }

  const code = (path[1] ?? "").toUpperCase();
  if (!/^[A-Z]{4}$/.test(code) || !(await registry(env).get(code))) return json({ error: "No campaign with that code." }, 404);

  if (path.length === 2 && method === "GET") return json(await registry(env).get(code));
  if (path.length === 2 && method === "DELETE") {
    await campaign(env, code).wipe();
    await registry(env).remove(code);
    return json({ ok: true });
  }
  if (path[2] === "export" && method === "GET") {
    const state = await campaign(env, code).exportState();
    if (state) for (const p of state.players) p.token = ""; // device tokens stay private
    return new Response(JSON.stringify(state, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="campaign-${code}.json"` },
    });
  }
  if (path[2] === "restart" && method === "POST") {
    // Same setup and story arc, fresh progress, no player characters.
    const old = await campaign(env, code).exportState();
    if (!old) return json({ error: "Campaign is empty." }, 404);
    const newC = await newCode(env);
    const summary = await campaign(env, newC).init(newC, old.config, { storyArc: old.storyArc });
    await registry(env).upsert(summary);
    return json({ code: newC }, 201);
  }
  return json({ error: "Not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (parts[0] === "api" && parts[1] === "campaigns") return await api(request, env, parts.slice(1));
      if (parts[0] === "ws" && parts[1]) {
        const code = parts[1].toUpperCase();
        if (!(await registry(env).get(code))) return new Response("No campaign with that code.", { status: 404 });
        return campaign(env, code).fetch(request);
      }
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
