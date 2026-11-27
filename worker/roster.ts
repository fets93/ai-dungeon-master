// The group's roster: characters that live outside any single campaign.
// A character is "checked out" to at most one campaign at a time; that campaign syncs its state back
// after every change, and releases it when the character leaves or the campaign is deleted.
import { DurableObject } from "cloudflare:workers";
import type { Character, RosterSummary } from "../shared/types";
import type { Env } from "./index";

interface Entry {
  character: Character; // latest state, ownerId/present cleared
  pinHash: string;
  campaignCode: string | null;
  campaignTitle: string | null;
  updatedAt: number;
}

async function hashPin(id: string, pin: string): Promise<string> {
  const data = new TextEncoder().encode(`${id}:${pin}`);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clean = (c: Character): Character => ({ ...c, ownerId: null, present: false, pin: null });

export class Roster extends DurableObject<Env> {
  private async entry(id: string): Promise<Entry | undefined> {
    return this.ctx.storage.get<Entry>(`char:${id}`);
  }
  private async put(e: Entry) {
    e.updatedAt = Date.now();
    await this.ctx.storage.put(`char:${e.character.id}`, e);
  }

  async list(): Promise<RosterSummary[]> {
    const rows = await this.ctx.storage.list<Entry>({ prefix: "char:" });
    return [...rows.values()]
      .map((e) => ({
        id: e.character.id,
        name: e.character.name,
        concept: e.character.concept,
        avatarVersion: e.character.avatarVersion ?? 0,
        campaignCode: e.campaignCode,
        campaignTitle: e.campaignTitle,
        updatedAt: e.updatedAt,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async nameTaken(name: string): Promise<boolean> {
    const n = name.trim().toLowerCase();
    return (await this.list()).some((r) => r.name.toLowerCase() === n);
  }

  async create(character: Character, pin: string, code: string, title: string): Promise<void> {
    if (!/^\d{4}$/.test(pin)) throw new Error("Every character needs a 4-digit PIN.");
    if (await this.nameTaken(character.name)) throw new Error(`There is already a character called ${character.name} in the group's roster.`);
    await this.put({ character: clean(character), pinHash: await hashPin(character.id, pin), campaignCode: code, campaignTitle: title, updatedAt: 0 });
  }

  async checkPin(id: string, pin: string): Promise<boolean> {
    const e = await this.entry(id);
    return !!e && e.pinHash === (await hashPin(id, String(pin ?? "")));
  }

  /**
   * Takes a character into a campaign. If it is in another campaign, only with move=true (the other
   * campaign loses it). Moving into a different campaign counts as a rest.
   */
  async checkout(
    id: string,
    pin: string,
    code: string,
    title: string,
    move: boolean,
  ): Promise<{ ok: true; character: Character; movedFrom: string | null } | { ok: false; reason: "pin" | "missing" | "elsewhere"; campaignCode?: string; campaignTitle?: string }> {
    const e = await this.entry(id);
    if (!e) return { ok: false, reason: "missing" };
    if (e.pinHash !== (await hashPin(id, String(pin ?? "")))) return { ok: false, reason: "pin" };
    if (e.campaignCode && e.campaignCode !== code && !move)
      return { ok: false, reason: "elsewhere", campaignCode: e.campaignCode, campaignTitle: e.campaignTitle ?? e.campaignCode };
    const movedFrom = e.campaignCode && e.campaignCode !== code ? e.campaignCode : null;
    if (e.campaignCode !== code) {
      // A new adventure starts rested: health and ability uses refill; items and stats carry over.
      const c = e.character;
      c.health = c.maxHealth;
      c.conditions = [];
      c.effects = [];
      for (const a of c.abilities) a.usesLeft = a.usesPerRest;
    }
    e.campaignCode = code;
    e.campaignTitle = title;
    await this.put(e);
    return { ok: true, character: structuredClone(e.character), movedFrom };
  }

  // A new, independent character with the same stats and items, under a new name and the same PIN.
  async copy(id: string, pin: string, newName: string, code: string, title: string): Promise<Character> {
    const e = await this.entry(id);
    if (!e || e.pinHash !== (await hashPin(id, String(pin ?? "")))) throw new Error("Wrong PIN for this character.");
    const name = newName.trim().slice(0, 24);
    if (!name) throw new Error("The copy needs a name.");
    if (await this.nameTaken(name)) throw new Error(`There is already a character called ${name}.`);
    const c: Character = { ...structuredClone(e.character), id: `r-${crypto.randomUUID().slice(0, 8)}`, name, avatarVersion: 0 };
    c.health = c.maxHealth;
    c.conditions = [];
    c.effects = [];
    for (const a of c.abilities) a.usesLeft = a.usesPerRest;
    await this.put({ character: c, pinHash: await hashPin(c.id, pin), campaignCode: code, campaignTitle: title, updatedAt: 0 });
    const avatar = await this.ctx.storage.get<string>(`avatar:${id}`);
    if (avatar) {
      await this.ctx.storage.put(`avatar:${c.id}`, avatar);
      c.avatarVersion = 1;
      await this.put({ ...(await this.entry(c.id))!, character: c });
    }
    return structuredClone(c);
  }

  /** Saves a campaign's current state of the character. Refused if the character has moved on. */
  async sync(code: string, character: Character): Promise<{ ok: boolean }> {
    const e = await this.entry(character.id);
    if (!e || e.campaignCode !== code) return { ok: false };
    e.character = clean(character);
    await this.put(e);
    return { ok: true };
  }

  /** The campaign lets go (character removed, campaign deleted). Keeps the latest state. */
  async release(code: string, character?: Character, id?: string) {
    const e = await this.entry(character?.id ?? id ?? "");
    if (!e || e.campaignCode !== code) return;
    if (character) e.character = clean(character);
    e.campaignCode = null;
    e.campaignTitle = null;
    await this.put(e);
  }

  async renameCampaign(code: string, title: string) {
    for (const e of (await this.ctx.storage.list<Entry>({ prefix: "char:" })).values())
      if (e.campaignCode === code && e.campaignTitle !== title) {
        e.campaignTitle = title;
        await this.put(e);
      }
  }

  async remove(id: string, pin: string) {
    if (!(await this.checkPin(id, pin))) throw new Error("Wrong PIN for this character.");
    await this.ctx.storage.delete([`char:${id}`, `avatar:${id}`]);
  }

  async setAvatar(id: string, dataUrl: string | null): Promise<number> {
    const e = await this.entry(id);
    if (!e) throw new Error("Unknown character.");
    if (dataUrl) await this.ctx.storage.put(`avatar:${id}`, dataUrl);
    else await this.ctx.storage.delete(`avatar:${id}`);
    e.character.avatarVersion = dataUrl ? (e.character.avatarVersion ?? 0) + 1 : 0;
    await this.put(e);
    return e.character.avatarVersion;
  }

  async getAvatar(id: string): Promise<string | null> {
    return (await this.ctx.storage.get<string>(`avatar:${id}`)) ?? null;
  }
}
