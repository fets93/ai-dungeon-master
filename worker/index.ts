// Worker entry: a small JSON API for the campaign library, WebSocket routing to each campaign,
// and the static Svelte app for everything else.
import type { CampaignConfig, GameState, Strictness } from "../shared/types";
import { Campaign } from "./campaign";
import { Registry } from "./registry";
import { APP_VERSION } from "../shared/version";
import { credits, listVoices, synthesize, voiceConfigured } from "./voice";
import type { VoicesResponse } from "../shared/types";

export { Campaign, Registry };

export interface Env {
  ASSETS: Fetcher;
  CAMPAIGN: DurableObjectNamespace<Campaign>;
  REGISTRY: DurableObjectNamespace<Registry>;
  ANTHROPIC_API_KEY?: string;
  MOCK_LLM?: string;
  DM_MODEL?: string;
  REFEREE_MODEL?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_MOCK?: string;
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
    const body = (await request.json().catch(() => ({}))) as any;
    const config = readConfig(body);
    const hostPin = /^\d{4,6}$/.test(String(body?.hostPin ?? "")) ? String(body.hostPin) : null;
    const code = await newCode(env);
    const summary = await campaign(env, code).init(code, config, { hostPin });
    await registry(env).upsert(summary);
    return json({ code }, 201);
  }
  // /api/campaigns/import
  if (path[1] === "import" && method === "POST") {
    const state = (await request.json().catch(() => null)) as GameState | null;
    if (!state?.config || !Array.isArray(state.characters)) return json({ error: "Not a campaign export file." }, 400);
    const code = await newCode(env);
    const { avatars, ...rest } = state as GameState & { avatars?: Record<string, string> };
    const summary = await campaign(env, code).init(code, readConfig(state.config), { ...rest, config: readConfig(state.config), pending: [] }, avatars);
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
    const avatars = await campaign(env, code).avatarsForExport();
    return new Response(JSON.stringify({ ...state, avatars }, null, 2), {
      headers: { "content-type": "application/json", "content-disposition": `attachment; filename="campaign-${code}.json"` },
    });
  }
  if (path[2] === "restart" && method === "POST") {
    // Same setup and story arc, fresh progress, no player characters.
    const old = await campaign(env, code).exportState();
    if (!old) return json({ error: "Campaign is empty." }, 404);
    const newC = await newCode(env);
    const summary = await campaign(env, newC).init(newC, old.config, { storyArc: old.storyArc, blurb: old.blurb ?? "" });
    await registry(env).upsert(summary);
    return json({ code: newC }, 201);
  }
  return json({ error: "Not found" }, 404);
}

async function voicesApi(env: Env): Promise<Response> {
  const res: VoicesResponse = { configured: voiceConfigured(env), voices: [] };
  if (res.configured) {
    try {
      [res.voices, res.credits] = await Promise.all([listVoices(env), credits(env)]);
    } catch (e) {
      res.error = (e as Error).message;
    }
  }
  return json(res);
}

// GET /api/tts/CODE/MESSAGE_ID/SEGMENT -> MP3. The text comes from the campaign log, so this
// endpoint can only ever speak what the DM wrote. Results are cached, so replays cost no credits.
async function ttsApi(env: Env, ctx: ExecutionContext, parts: string[]): Promise<Response> {
  if (!voiceConfigured(env)) return json({ error: "ElevenLabs is not set up (ELEVENLABS_API_KEY missing)." }, 503);
  const [code, msgId, seg] = [parts[2]?.toUpperCase(), Number(parts[3]), Number(parts[4])];
  if (!/^[A-Z]{4}$/.test(code ?? "") || !Number.isInteger(msgId) || !Number.isInteger(seg)) return json({ error: "Bad request" }, 400);
  if (!(await registry(env).get(code))) return json({ error: "No campaign with that code." }, 404);
  const voices = await listVoices(env);
  if (!voices.length) return json({ error: "No ElevenLabs voices available." }, 502);
  const part = await campaign(env, code).speechSegment(msgId, seg, voices);
  if (!part) return json({ error: "Nothing to read." }, 404);
  const key = new Request(`https://tts.cache/${code}/${msgId}/${seg}/${part.voiceId}`);
  const cache = (caches as unknown as { default: Cache }).default; // Cloudflare's per-data-center cache
  const cached = await cache.match(key);
  if (cached) return cached;
  const audio = await synthesize(env, part.voiceId, part.text);
  if (!audio.ok || !audio.body) return audio;
  const [a, b] = audio.body.tee();
  const headers = { "content-type": "audio/mpeg", "cache-control": "public, max-age=604800" };
  ctx.waitUntil(cache.put(key, new Response(b, { headers })));
  return new Response(a, { headers });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

// /join/CODE: a tiny page whose link preview (WhatsApp, Signal, iMessage…) shows the campaign,
// then forwards the browser to the phone view.
async function joinPage(env: Env, url: URL, code: string): Promise<Response> {
  const c = await registry(env).get(code);
  const target = c ? `/#/play/${code}` : "/";
  const title = c ? `Join "${c.title}"` : "AI Dungeon Master";
  const desc = c?.summary ? c.summary.slice(0, 200) : "A role-playing game with an AI dungeon master. Join on your phone.";
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(title)} · AI Dungeon Master">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url.href)}">
<meta name="description" content="${esc(desc)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<style>body{background:#15120f;color:#f0e7d8;font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#d6a64f}</style>
</head><body><p>Opening the game… <a href="${esc(target)}">Tap here</a> if nothing happens.</p>
<script>location.replace(${JSON.stringify(target)})</script></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (parts[0] === "join" && parts[1]) return await joinPage(env, url, parts[1].toUpperCase().slice(0, 4));
      if (parts[0] === "api" && parts[1] === "avatar" && parts[2] && parts[3]) {
        const code = parts[2].toUpperCase();
        if (!(await registry(env).get(code))) return new Response("Not found", { status: 404 });
        const dataUrl = await campaign(env, code).getAvatar(decodeURIComponent(parts[3]));
        if (!dataUrl) return new Response("Not found", { status: 404 });
        const [, type, b64] = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/)!;
        const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
        // The URL carries ?v=<version>, so a cached copy never goes stale.
        return new Response(bytes, { headers: { "content-type": type, "cache-control": "public, max-age=31536000, immutable" } });
      }
      if (parts[0] === "api" && parts[1] === "voices") return await voicesApi(env);
      if (parts[0] === "api" && parts[1] === "tts") return await ttsApi(env, ctx, parts);
      if (parts[0] === "api" && parts[1] === "version") return json({ version: APP_VERSION });
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
