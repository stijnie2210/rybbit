import { createRequire } from "node:module";
import { parseArgs } from "node:util";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const puppeteer = require("puppeteer");

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:4400" },
    host: { type: "string", default: "http://localhost:3001" },
    visitors: { type: "string", default: "200" },
    rates: { type: "string", default: "control=0.1,variant_a=0.1" },
    later: { type: "string", default: "0.3" },
    concurrency: { type: "string", default: "8" },
    seed: { type: "string" },
  },
});

const rates = Object.fromEntries(
  values.rates.split(",").map(pair => {
    const [variant, rate] = pair.split("=");
    return [variant.trim(), Number(rate)];
  })
);
const visitorCount = Number(values.visitors);
const laterShare = Number(values.later);
const concurrency = Number(values.concurrency);
const seed = values.seed ? Number(values.seed) : Math.floor(Math.random() * 2 ** 31);

let state = seed;
function random() {
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const randomIp = () =>
  [1 + Math.floor(random() * 222), Math.floor(random() * 256), Math.floor(random() * 256), 1 + Math.floor(random() * 254)].join(".");

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

async function openPage(context, ip) {
  const page = await context.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.url().startsWith(values.host)) {
      request.continue({ headers: { ...request.headers(), "x-forwarded-for": ip } });
    } else {
      request.continue();
    }
  });
  await page.goto(values.url, { waitUntil: "load" });
  await page.waitForFunction(() => document.querySelector("main")?.dataset.variant !== "pending", { timeout: 15000 });
  const variant = await page.$eval("main", main => main.dataset.variant);
  return { page, variant };
}

async function settle(page) {
  await page.waitForNetworkIdle({ idleTime: 400, timeout: 10000 }).catch(() => {});
}

async function runVisitor(browser, index) {
  const draw = { ip: randomIp(), returnIp: randomIp(), convert: random(), later: random() };
  const context = await browser.createBrowserContext();
  try {
    const first = await openPage(context, draw.ip);
    const rate = rates[first.variant];
    if (rate === undefined) throw new Error(`No rate given for variant "${first.variant}"`);
    const converts = draw.convert < rate;
    const convertsLater = converts && draw.later < laterShare;

    if (converts && !convertsLater) await first.page.click("#cta");
    await settle(first.page);
    await first.page.close();

    if (convertsLater) {
      const second = await openPage(context, draw.returnIp);
      if (second.variant !== first.variant) {
        console.warn(`visitor ${index}: saw ${first.variant} then ${second.variant}`);
      }
      await second.page.click("#cta");
      await settle(second.page);
      await second.page.close();
    }
    return { variant: first.variant, converts, convertsLater };
  } finally {
    await context.close();
  }
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--disable-blink-features=AutomationControlled"],
});

const results = [];
let next = 0;
let failures = 0;
const started = Date.now();

async function worker() {
  while (next < visitorCount) {
    const index = next++;
    try {
      results.push(await runVisitor(browser, index));
    } catch (error) {
      failures++;
      console.error(`visitor ${index}: ${error.message}`);
    }
    if (results.length % 50 === 0 && results.length > 0) {
      console.log(`${results.length}/${visitorCount} visitors`);
    }
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));
await browser.close();

const byVariant = {};
for (const result of results) {
  const arm = (byVariant[result.variant] ??= { visitors: 0, conversions: 0, returnConversions: 0 });
  arm.visitors++;
  if (result.converts) arm.conversions++;
  if (result.convertsLater) arm.returnConversions++;
}

console.log(`\nSeed ${seed}, ${results.length} visitors (${failures} failed) in ${Math.round((Date.now() - started) / 1000)}s`);
console.table(
  Object.fromEntries(
    Object.entries(byVariant).map(([variant, arm]) => [
      variant,
      {
        "true rate": rates[variant],
        visitors: arm.visitors,
        conversions: arm.conversions,
        "on return visit": arm.returnConversions,
        "observed rate": Number((arm.conversions / arm.visitors).toFixed(4)),
      },
    ])
  )
);
