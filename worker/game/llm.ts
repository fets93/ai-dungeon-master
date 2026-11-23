import Anthropic from "@anthropic-ai/sdk";
import { mockLlm } from "./mock";

// USD per million tokens, from the Claude API pricing page (checked 2026-11-22).
const PRICES: Record<string, { in: number; out: number; cacheWrite: number; cacheRead: number }> = {
  "claude-opus-5-5": { in: 4, out: 20, cacheWrite: 5, cacheRead: 0.2 },
  "claude-sonnet-5-5": { in: 2, out: 10, cacheWrite: 2.5, cacheRead: 0.1 },
  "claude-haiku-5-5": { in: 0.1, out: 0.5, cacheWrite: 0.125, cacheRead: 0.01 },
};

export interface LlmEnv {
  ANTHROPIC_API_KEY?: string;
  MOCK_LLM?: string;
  DM_MODEL?: string;
  REFEREE_MODEL?: string;
}

export type CreateParams = Anthropic.MessageCreateParamsNonStreaming;

export interface Llm {
  dmModel: string;
  refereeModel: string;
  call(role: string, params: CreateParams): Promise<Anthropic.Message>;
}

export function makeLlm(env: LlmEnv, onCost: (usd: number) => void): Llm {
  const mock = env.MOCK_LLM === "1" || env.MOCK_LLM === "true";
  if (!mock && !env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set on the server.");
  const client = mock ? null : new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return {
    dmModel: env.DM_MODEL || "claude-sonnet-5-5",
    refereeModel: env.REFEREE_MODEL || "claude-haiku-5-5",
    async call(role, params) {
      const msg = mock ? mockLlm(role, params) : await client!.messages.create(params);
      const p = PRICES[params.model];
      if (p) {
        const u = msg.usage;
        onCost(
          (u.input_tokens * p.in +
            u.output_tokens * p.out +
            (u.cache_creation_input_tokens ?? 0) * p.cacheWrite +
            (u.cache_read_input_tokens ?? 0) * p.cacheRead) /
            1e6,
        );
      }
      return msg;
    },
  };
}
