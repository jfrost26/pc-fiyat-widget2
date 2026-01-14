import fs from "fs";
import path from "path";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import { chromium } from "playwright";

const ROOT = process.cwd();
const PRODUCTS_PATH = path.join(ROOT, "products.json");
const OUT_PATH = path.join(ROOT, "docs", "data.json");

const UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function nowISO() {
  return new Date().toISOString();
}

// "12.345,67" -> 12345.67
function parseTRY(str) {
  if (!str) return null;
  const cleaned = str
    .replace(/\s/g, "")
    .replace(/[^\d.,]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : null;
}

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "tr-TR,tr;q=0.9,en;q=0.6" }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

function extractTitleFromHTML(html) {
  const $ = cheerio.load(html);
  return (
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").text()?.trim() ||
    null
  );
}

function extractImageFromHTML(html) {
  const $ = cheerio.load(html);
  return $('meta[property="og:image"]').attr("content")?.trim() || null;
}

/**
 * Akakçe: hızlı DOM + fallback
 */
function extractAkakcePriceFromHTML(html) {
  const $ = cheerio.load(html);

  // 1) Meta fiyatlar (Akakçe sayfalarında bazen burada oluyor)
  const metaSelectors = [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[itemprop="price"]',
    '[itemprop="price"]'
  ];
  for (const sel of metaSelectors) {
    const v = $(sel).attr("content") || $(sel).text();
    const p = parseTRY(v);
    if (p) return p;
  }

  // 2) Görünür fiyat sınıfları (fallback)
  const candidates = [".pt_v8", ".p_w_v9", ".p_w_v8", ".p_w", ".price", ".product-price"];
  for (const sel of candidates) {
    const t = $(sel).first().text();
    const p = parseTRY(t);
    if (p) return p;
  }

  // 3) Son çare: sayfa içinde geçen ilk ₺ fiyatı
  const m = html.match(/₺\s*[\d.]+(?:,\d{1,2})?/);
  if (m) return parseTRY(m[0]);

  return null;
}

async function extractPriceWithPlaywright(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(1500);

  // 1) JSON-LD (schema.org) price dene
  const jsonldPrices = await page.evaluate(() => {
    const out = [];
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of scripts) {
      try {
        const txt = s.textContent?.trim();
        if (!txt) continue;
        const data = JSON.parse(txt);

        const scan = (obj) => {
          if (!obj) return;
          if (Array.isArray(obj)) return obj.forEach(scan);
          if (typeof obj !== "object") return;

          if (obj.offers) scan(obj.offers);
          if (obj.price) out.push(String(obj.price));
          if (obj.lowPrice) out.push(String(obj.lowPrice));
          if (obj.highPrice) out.push(String(obj.highPrice));
          if (obj["@type"] === "Offer" && obj.price) out.push(String(obj.price));

          for (const v of Object.values(obj)) scan(v);
        };

        scan(data);
      } catch {}
    }
    return out;
  });

  for (const raw of jsonldPrices) {
    const p = Number(String(raw).replace(",", "."));
    if (Number.isFinite(p) && p > 0) return p;
  }

  // 2) DOM'dan "₺" içeren metinleri topla
  const texts = await page.evaluate(() => {
    const out = new Set();

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const t = walker.currentNode.nodeValue?.trim();
      if (!t) continue;
      if (t.length > 80) continue;
      if (t.includes("₺") || t.toLowerCase().includes("tl")) out.add(t);
    }

    const selectors = [
      '[itemprop="price"]',
      '[data-test="price"]',
      ".price",
      ".product-price",
      ".salePrice",
      ".currentPrice",
      ".final-price",
      ".a-price .a-offscreen"
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        const t = (el.getAttribute("content") || el.textContent || "").trim();
        if (t) out.add(t);
      });
    }

    return Array.from(out);
  });

  const prices = texts
    .map((t) => parseFloat(String(t).replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")))
    .filter((n) => Number.isFinite(n) && n > 0);

  if (!prices.length) return null;

  // PC parça fiyatlarında 50 TL altını ele
  const filtered = prices.filter((n) => n >= 50);
  return (filtered.length ? Math.min(...filtered) : Math.min(...prices));
}

async function fetchOffer(offer, browser) {
  const base = {
    site: offer.site,
    url: offer.url,
    currency: "TRY",
    fetched_at: nowISO()
  };

  // Akakçe: hızlı HTML fetch
  if (offer.site === "akakce") {
    try {
      const html = await fetchHTML(offer.url);
      return {
        ...base,
        title: extractTitleFromHTML(html),
        image: extractImageFromHTML(html),
        price: extractAkakcePriceFromHTML(html)
      };
    } catch (e) {
      return { ...base, price: null, error: String(e.message || e) };
    }
  }

  // Diğer siteler: Playwright render
  const context = await browser.newContext({
    userAgent: UA,
    locale: "tr-TR"
  });
  const page = await context.newPage();

  try {
    const price = await extractPriceWithPlaywright(page, offer.url);

    const title = await page.title().catch(() => null);
    const image = await page
      .locator('meta[property="og:image"]')
      .getAttribute("content")
      .catch(() => null);

    await context.close();
    return { ...base, price, title: title?.trim() || null, image: image?.trim() || null };
  } catch (e) {
    await context.close();

    // fallback: HTML + regex
    try {
      const html = await fetchHTML(offer.url);
      const m = html.match(/₺\s*[\d.]+\s*(?:,\s*\d{1,2})?/);
      return {
        ...base,
        title: extractTitleFromHTML(html),
        image: extractImageFromHTML(html),
        price: m ? parseTRY(m[0]) : null,
        error: `PW_FAIL: ${String(e.message || e)}`
      };
    } catch (e2) {
      return {
        ...base,
        price: null,
        error: `PW_FAIL: ${String(e.message || e)} | HTTP_FAIL: ${String(e2.message || e2)}`
      };
    }
  }
}

function bestOffer(offers) {
  const priced = offers.filter((o) => typeof o.price === "number");
  if (!priced.length) return null;
  priced.sort((a, b) => a.price - b.price);
  return priced[0];
}

async function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));

  const browser = await chromium.launch({ headless: true });

  const out = {
    updated_at: nowISO(),
    products: []
  };

  for (const p of products) {
    const offers = [];
    for (const o of p.offers) {
      offers.push(await fetchOffer(o, browser));
      await new Promise((r) => setTimeout(r, 400));
    }

    out.products.push({
      id: p.id,
      name: p.name,
      best: bestOffer(offers),
      offers
    });
  }

  await browser.close();

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

