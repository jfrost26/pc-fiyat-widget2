import fs from "fs";
import path from "path";
import { chromium } from "playwright";

const ROOT = process.cwd();
const PRODUCTS_PATH = path.join(ROOT, "products.json");
const OUT_DATA_PATH = path.join(ROOT, "docs", "data.json");
const OUT_HISTORY_PATH = path.join(ROOT, "docs", "history.json");
const OUT_PUBLIC_PRODUCTS_PATH = path.join(ROOT, "docs", "products.public.json");
const DEBUG_DIR = path.join(ROOT, "docs", "debug");

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function nowISO() {
  return new Date().toISOString();
}

function parseTRY(str) {
  if (!str) return null;
  const s = String(str);
  const cleaned = s
    .replace(/\s/g, "")
    .replace(/[^\d.,]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : null;
}

function ensureDebugDir() {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
}

async function saveDebug(page, id) {
  ensureDebugDir();
  const safe = id.replace(/[^a-z0-9_-]+/gi, "_");
  const pngPath = path.join(DEBUG_DIR, `${safe}.png`);
  try {
    await page.screenshot({ path: pngPath, fullPage: true });
  } catch {}
  return { pngPath: `docs/debug/${safe}.png` };
}

function readJsonSafe(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Site bağımsız fiyat çıkarma
async function extractPriceFromPage(page) {
  const metaSelectors = [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[itemprop="price"]',
    'meta[name="twitter:data1"]',
    'meta[name="twitter:data2"]'
  ];

  for (const sel of metaSelectors) {
    const v = await page.locator(sel).first().getAttribute("content").catch(() => null);
    const p = parseTRY(v);
    if (typeof p === "number" && p > 0) return p;
  }

  const jsonldCandidate = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    const scan = (obj) => {
      if (!obj) return null;
      if (Array.isArray(obj)) {
        for (const it of obj) {
          const r = scan(it);
          if (r) return r;
        }
      } else if (typeof obj === "object") {
        if (obj.price) return obj.price;
        if (obj.offers) {
          const r = scan(obj.offers);
          if (r) return r;
        }
        for (const k of Object.keys(obj)) {
          const r = scan(obj[k]);
          if (r) return r;
        }
      }
      return null;
    };

    for (const s of scripts) {
      const t = (s.textContent || "").trim();
      if (!t) continue;
      try {
        const data = JSON.parse(t);
        const found = scan(data);
        if (found) return String(found);
      } catch {}
    }
    return null;
  });

  {
    const p = parseTRY(jsonldCandidate);
    if (typeof p === "number" && p > 0) return p;
  }

  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(600);

  const visible = await page.evaluate(() => {
    const text = document.body ? (document.body.innerText || "") : "";
    const m = text.match(/(?:₺|TL)\s*[\d.]+(?:,\d{1,2})?/);
    return m ? m[0] : null;
  });

  {
    const p = parseTRY(visible);
    if (typeof p === "number" && p > 0) return p;
  }

  return null;
}

async function fetchOffer(context, productId, offer) {
  const page = await context.newPage();
  try {
    await page.goto(offer.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);

    const title = await page.title().catch(() => "");
    const bodyText = await page.evaluate(() => document.body?.innerText || "").catch(() => "");
    const blocked = /captcha|robot|blocked|doğrula|erişim|engellendi|unusual traffic/i.test(title + " " + bodyText);
    if (blocked) {
      const dbg = await saveDebug(page, `${productId}_${offer.store}_blocked`);
      return { store: offer.store, url: offer.url, price: null, error: `BLOCKED (debug: ${dbg.pngPath})` };
    }

    const price = await extractPriceFromPage(page);
    if (!price) {
      const dbg = await saveDebug(page, `${productId}_${offer.store}_noprice`);
      return { store: offer.store, url: offer.url, price: null, error: `PRICE_NOT_FOUND (debug: ${dbg.pngPath})` };
    }

    return { store: offer.store, url: offer.url, price };
  } catch (e) {
    const dbg = await saveDebug(page, `${productId}_${offer.store}_error`);
    return { store: offer.store, url: offer.url, price: null, error: `ERROR: ${String(e?.message || e)} (debug: ${dbg.pngPath})` };
  } finally {
    await page.close();
  }
}

/**
 * HISTORY FORMAT:
 * {
 *   "updated_at": "...",
 *   "products": {
 *     "<productId>": [
 *        { "price": 12345.67, "store": "aykom", "url": "...", "first_seen_at": "...", "last_seen_at": "..." },
 *        ...
 *     ]
 *   }
 * }
 */
function updateHistory(history, productId, best) {
  if (!best || typeof best.price !== "number") return;

  if (!history.products) history.products = {};
  if (!history.products[productId]) history.products[productId] = [];

  const arr = history.products[productId];
  const ts = nowISO();

  const last = arr.length ? arr[arr.length - 1] : null;

  // Aynı fiyat + aynı mağaza => yeni kayıt ekleme, sadece last_seen_at güncelle
  if (last && last.price === best.price && last.store === best.store) {
    last.last_seen_at = ts;
    // URL değişmişse güncelle (bazı mağazalarda URL değişebilir)
    last.url = best.url || last.url;
  } else {
    arr.push({
      price: best.price,
      store: best.store || "—",
      url: best.url || "",
      first_seen_at: ts,
      last_seen_at: ts
    });
  }

  // limit: 200 değişim
  const MAX = 200;
  if (arr.length > MAX) history.products[productId] = arr.slice(arr.length - MAX);
}

async function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: UA,
    locale: "tr-TR",
    viewport: { width: 1280, height: 800 }
  });

  const outData = {
    updated_at: nowISO(),
    products: []
  };

  // History'yi oku (varsa)
  const history = readJsonSafe(OUT_HISTORY_PATH, { updated_at: null, products: {} });

  for (const p of products) {
    console.log("Product:", p.name);

    const offersOut = [];
    for (const offer of p.offers || []) {
      console.log("  -", offer.store);
      const r = await fetchOffer(context, p.id, offer);
      offersOut.push(r);
      await new Promise((res) => setTimeout(res, 700));
    }

    const priced = offersOut.filter((o) => typeof o.price === "number" && o.price > 0);
    priced.sort((a, b) => a.price - b.price);

    const best = priced.length
      ? { price: priced[0].price, store: priced[0].store, url: priced[0].url, currency: "TRY" }
      : null;

    outData.products.push({
      id: p.id,
      name: p.name,
      ref_url: p.ref_url,
      best,
      offers: offersOut,
      error: best ? null : "NO_PRICES_FOUND"
    });

    // history güncelle
    updateHistory(history, p.id, best);

    await new Promise((res) => setTimeout(res, 900));
  }

  await context.close();
  await browser.close();

  // dosyalara yaz
  fs.mkdirSync(path.dirname(OUT_DATA_PATH), { recursive: true });
  fs.writeFileSync(OUT_DATA_PATH, JSON.stringify(outData, null, 2), "utf8");

  history.updated_at = nowISO();
  fs.writeFileSync(OUT_HISTORY_PATH, JSON.stringify(history, null, 2), "utf8");

  const publicProducts = products.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category || null,
    ref_url: p.ref_url,
    offers: p.offers || []
  }));
  fs.writeFileSync(OUT_PUBLIC_PRODUCTS_PATH, JSON.stringify(publicProducts, null, 2), "utf8");

  console.log("Wrote", OUT_DATA_PATH);
  console.log("Wrote", OUT_HISTORY_PATH);
  console.log("Wrote", OUT_PUBLIC_PRODUCTS_PATH);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
