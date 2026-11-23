// Browser walkthrough with headless Chrome against `wrangler dev` (MOCK_LLM=1, built dist/).
// One main screen and two phones play a short session; screenshots go to screenshots/.
//   npm run build && npm run dev:worker   (other terminal)
//   CHROME=/usr/bin/google-chrome npx tsx tests/ui.ts
import { mkdirSync } from "node:fs";
import puppeteer, { type Page } from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:8787";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
mkdirSync("screenshots", { recursive: true });
const shot = (p: Page, name: string) => p.screenshot({ path: `screenshots/${name}.png` });
const consoleErrors: string[] = [];

async function clickText(p: Page, text: string, ms = 8000) {
  // Waits until the button exists and is enabled (e.g. the DM finished thinking).
  await p
    .waitForFunction(
      (t) => [...document.querySelectorAll("button")].some((b) => b.textContent?.trim().startsWith(t) && !(b as HTMLButtonElement).disabled),
      { timeout: ms },
      text,
    )
    .catch(() => {
      throw new Error(`No enabled button "${text}"`);
    });
  await p.evaluate((t) => {
    const el = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim().startsWith(t) && !(b as HTMLButtonElement).disabled);
    (el as HTMLButtonElement).click();
  }, text);
}
async function waitText(p: Page, text: string, ms = 8000) {
  await p.waitForFunction((t) => document.body.innerText.includes(t), { timeout: ms }, text);
}

let browser: Awaited<ReturnType<typeof puppeteer.launch>>;
async function main() {
  browser = await puppeteer.launch({ executablePath: process.env.CHROME ?? "/usr/bin/google-chrome", args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  const newPage = async (w: number, h: number, mobile: boolean) => {
    const ctx = await browser.createBrowserContext(); // separate localStorage per device
    const p = await ctx.newPage();
    await p.setViewport({ width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
    p.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
    p.on("pageerror", (e) => consoleErrors.push(String(e)));
    return p;
  };

  // Hub: create a campaign through the form
  const screen = await newPage(1440, 900, false);
  await screen.goto(BASE);
  await waitText(screen, "Campaigns");
  await clickText(screen, "+ New campaign");
  await screen.type("#idea", "A heist in a floating city, dark humor");
  await shot(screen, "01-hub-new-campaign");
  await clickText(screen, "Create and open main screen");
  await screen.waitForFunction(() => location.hash.startsWith("#/screen/"));
  const code = (await screen.evaluate(() => location.hash.split("/")[2]))!;
  await waitText(screen, "Begin the adventure");
  console.log("campaign", code);

  // Phone 1: join and create a character
  const anna = await newPage(390, 844, true);
  await anna.goto(`${BASE}/#/play/${code}`);
  await anna.waitForSelector("#pname");
  await anna.type("#pname", "Anna");
  await shot(anna, "02-phone-join");
  await clickText(anna, "Join");
  await waitText(anna, "Create a new character");
  await shot(anna, "03-phone-pick-role");
  await clickText(anna, "Create a new character");
  await anna.type("#cname", "Thorin");
  await anna.type("#concept", "Exiled dwarf locksmith");
  const fileInput = await anna.$('input[type="file"]');
  await fileInput!.uploadFile("tests/fixtures/portrait.png");
  await anna.waitForSelector(".photo img.av", { timeout: 5000 });
  const previewLen = await anna.$eval(".photo img.av", (i) => (i as HTMLImageElement).src.length);
  console.log(previewLen < 150000 ? `PASS  900x600 photo shrunk to ${Math.round(previewLen / 1024)} KB before upload` : `FAIL  preview too large: ${previewLen}`);
  for (let i = 0; i < 4; i++) await anna.click('button[aria-label="Raise strength"]');
  for (let i = 0; i < 4; i++) await anna.click('button[aria-label="Raise stamina"]');
  await anna.type('input[aria-label="Ability name"]', "Master Key");
  await anna.type('textarea[aria-label="What it does"]', "Opens any ordinary mechanical lock in a few seconds. Not magical locks.");
  const items = await anna.$$("input.item");
  await items[0].type("Lockpicks");
  await items[1].type("2x Healing potion");
  await shot(anna, "04-phone-character-form");
  await clickText(anna, "Create character");
  await waitText(anna, "You're the host");
  await sleep(200);

  // Phone 2: join and take a ready-made character
  const ben = await newPage(390, 844, true);
  await ben.goto(`${BASE}/#/play/${code}`);
  await ben.waitForSelector("#pname");
  await ben.type("#pname", "Ben");
  await clickText(ben, "Join");
  await waitText(ben, "Veyra");
  await ben.evaluate(() => {
    const card = [...document.querySelectorAll(".pick")].find((c) => c.textContent?.includes("Veyra"));
    (card?.querySelector("button") as HTMLButtonElement).click();
  });
  await waitText(ben, "Exploration");
  await sleep(300);
  const lobbyImg = await screen.waitForSelector(".member img.av", { timeout: 5000 }).then(() => true).catch(() => false);
  console.log(lobbyImg ? "PASS  portrait shows on the main screen" : "FAIL  no portrait on the main screen");
  await shot(screen, "05-screen-lobby");

  // Voice: switch the main screen to ElevenLabs before the story starts
  const ttsRequests: string[] = [];
  screen.on("request", (r) => r.url().includes("/api/tts/") && ttsRequests.push(r.url()));
  await clickText(screen, "ElevenLabs");
  await screen.waitForFunction(() => document.querySelector(".voice .seg button.on")?.textContent === "ElevenLabs");

  // Begin from the main screen
  await clickText(screen, "Begin the adventure");
  await waitText(screen, "Mother Kessa", 10000);
  await sleep(500);

  // Talk: aloud + table talk, then Send to DM
  await anna.type("textarea", "Who stole your ledger, Mother Kessa?");
  await clickText(anna, "Add");
  await clickText(ben, "🤫 Table talk");
  await ben.type("textarea", "don't mention the map");
  await clickText(ben, "Add");
  await clickText(ben, "🗣 Say aloud");
  await ben.type("textarea", "I persuade her to tell us what was in it");
  await clickText(ben, "Add");
  await sleep(300);
  await shot(anna, "06-phone-pending");
  await shot(screen, "07-screen-pending");
  await clickText(anna, "Send to DM");
  await waitText(screen, "Veyra rolls charm", 10000);
  await sleep(1500);
  const segs = new Set(ttsRequests.map((u) => u.split("/api/tts/")[1]));
  console.log(segs.size >= 2 ? `PASS  main screen requested speech for ${segs.size} segments` : `FAIL  speech requests: ${[...segs].join(", ")}`);
  console.log((await screen.evaluate(() => !!document.querySelector(".dm .line"))) ? "PASS  NPC dialogue rendered as a quoted line" : "FAIL  NPC dialogue not rendered");
  await shot(screen, "08-screen-after-turn");
  await shot(ben, "09-phone-after-turn");

  // Combat
  await anna.type("textarea", "I attack the thug by the door");
  await clickText(anna, "Add");
  await clickText(anna, "Send to DM");
  await waitText(screen, "Turn order", 10000);
  await sleep(600);
  await shot(screen, "10-screen-combat");
  await shot(ben, "11-phone-combat");

  // Sheet + journal tabs
  await clickText(anna, "Character");
  await sleep(200);
  await shot(anna, "12-phone-sheet");
  await clickText(anna, "Journal");
  await sleep(200);
  await shot(anna, "13-phone-journal");

  // Rejoin after reload (device token)
  await anna.reload();
  await waitText(anna, "Thorin", 8000).catch(() => {});
  const rejoined = await anna.evaluate(() => document.body.innerText.includes("Thorin") && !document.querySelector("#pname"));
  console.log(rejoined ? "PASS  rejoin after reload" : "FAIL  rejoin after reload");

  // Library shows the campaign
  await screen.goto(BASE);
  await waitText(screen, "Continue");
  await shot(screen, "14-hub-library");

  console.log(consoleErrors.length ? `Console errors:\n${consoleErrors.join("\n")}` : "PASS  no console errors");
  await browser.close();
  await fetch(`${BASE}/api/campaigns/${code}`, { method: "DELETE" });
}

main().catch(async (e) => {
  console.error(e);
  const pages = (await Promise.all(browser.browserContexts().map((c) => c.pages()))).flat();
  for (const [i, p] of pages.entries()) await p.screenshot({ path: `screenshots/fail-${i}.png` }).catch(() => {});
  if (consoleErrors.length) console.log(consoleErrors.join("\n"));
  await browser.close();
  process.exit(1);
});
