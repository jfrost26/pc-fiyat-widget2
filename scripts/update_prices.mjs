import fs from "fs";
import path from "path";
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
  const cleaned = String(str)
    .replace(/\s/g, "")
    .replace(/[^\d.,]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const val = Number(cleaned);
  return Number.isFinite(val) ? val : null;
}

/**
 * Akakçe sayfasından mağaza listesi çıkarmayı dener.
 * DOM zamanla değişebilir; bu yüzden birkaç selector/fallback kullanıyoruz.
 */
async function scrapeAkakceOffers(page) {
  // Sayfayı aç
  await page.goto(page.url(), { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);

  // Sayfada "₺" içeren fiyatlar ve mağaza isimleri genelde listede olur.
  // Aşağıdaki evaluate içinde olabildiğince esnek davranıyoruz.
  const offers = await page.evaluate(() => {
    const out = [];

    // 1) Akakçe'de çoğu üründe satıcı listesi bir tablo/liste halinde olur.
    // Çok spesifik selector vermek kırılgan; bu yüzden "₺" içeren satırları yakalıyoruz.
    const rows = Array.from(document.querySelectorAll("tr, li, div"));

    for (const r of rows) {
      const text = (r.textContent || "").replace(/\s+/g, " ").trim();
      if (!text.includes("₺")) continue;

      // Satır içinde bir link varsa onu al (yönlendirme linki)
      const a = r.querySelector("a[href]");
      const href = a ? a.href : null;

      // "₺12.345" benzeri fiyatı yakala
      const m = text.match(/₺\s*[\d.]+(?:,\d{1,2})?/);
      if (!m) continue;

      // Mağaza adı: link metni veya satırın başı
      const store =
        (a && (a.textContent || "").trim()) ||
        text.split("₺")[0].trim() ||
        "Mağaza";

      out.push({
        store,
        priceText: m[0],
        url: href
      });
    }

    // Çok fazla gürültü olabilir; benzer kayıtları azaltmak için (store+priceText) uniq yap
    const seen = new Set();
    const dedup = [];
    for (const o of out) {
      const key = `${o.store}__${o.priceText}__${o.url || ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(o);
    }

    return dedup;
  });

  // Node tarafında parse ve filtre
  const normalized = offers
    .map(o => ({
      site: "akakce",
      store: o.store,
      url: o.url, // yönlendirme linki (varsa)
      price: parseTRY(o.priceText),
      currency: "TRY"
    }))
    .filter(o => typeof o.price === "number" && o.price > 0);

  // En ucuzdan pahalıya sırala
  normalized.sort((a, b) => a.price - b.price);

  return normalized;
}

async function main() {
  const products = JSON.parse(fs.readFileSync(PRODUCTS_PATH, "utf8"));

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ userAgent: UA, locale: "tr-TR" });

  const out = {
    updated_at: nowISO(),
    products: []
  };

  for (const p of products) {
    const page = await context.newPage();
    page.url = () => p.akakce_url; // küçük hack: yukarıdaki fonksiyon page.url() çağırıyor

    let offers = [];
    let error = null;

    try {
      await page.goto(p.akakce_url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(1500);
      offers = await scrapeAkakceOffers(page);
    } catch (e) {
      error = String(e?.message || e);
    } finally {
      await page.close();
    }

    const best = offers.length
      ? { site: "akakce", store: offers[0].store, url: offers[0].url || p.akakce_url, price: offers[0].price, currency: "TRY" }
      : null;

    out.products.push({
      id: p.id,
      name: p.name,
      akakce_url: p.akakce_url,
      best,
      offers,
      error
    });

    // Akakçe'yi yormamak için küçük bekleme
    await new Promise(r => setTimeout(r, 800));
  }

  await context.close();
  await browser.close();

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(out, null, 2), "utf8");
  console.log(`Wrote ${OUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
