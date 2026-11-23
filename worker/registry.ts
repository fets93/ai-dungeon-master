// A single Durable Object that keeps the campaign library (one row per campaign).
import { DurableObject } from "cloudflare:workers";
import type { CampaignSummary } from "../shared/types";
import type { Env } from "./index";

export class Registry extends DurableObject<Env> {
  async list(): Promise<CampaignSummary[]> {
    const rows = await this.ctx.storage.list<CampaignSummary>({ prefix: "c:" });
    return [...rows.values()].sort((a, b) => b.lastPlayed - a.lastPlayed);
  }

  async get(code: string): Promise<CampaignSummary | undefined> {
    return this.ctx.storage.get<CampaignSummary>(`c:${code}`);
  }

  async upsert(summary: CampaignSummary) {
    await this.ctx.storage.put(`c:${summary.code}`, summary);
  }

  async remove(code: string) {
    await this.ctx.storage.delete(`c:${code}`);
  }
}
