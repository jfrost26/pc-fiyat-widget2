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

async function getBestFromAkakce(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1500);

  // 1) En stabil: meta fiyatlar
  const metaSelectors = [
    'meta[property="product:price:amount"]',
    'meta[property="og:price:amount"]',
    'meta[itemprop="price"]',
    'meta[name="twitter:data1"]'
  ];

  for (const sel of metaSelectors) {
    const v = await page.locator(sel).first().getAttribute("content").catch(() => null);
    const p = parseTRY(v);
    if (typeof p === "number" && p > 0) {
      // Mağaza adını stabil yakalayamazsak "Akakçe" döneceğiz
      return { price: p, store: "Akakçe", url };
    }
  }

  // 2) JSON-LD (structured data) içinde fiyat arama
  const jsonldPrice = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
    for (const s of scripts) {
      const t = (s.textContent || "").trim();
      if (!t) continue;
      try {
        const data = JSON.parse(t);

        const scan = (obj) => {
          if (!obj) return null;
          if (Array.isArray(obj)) {
            for (const it of obj) {
              const r = scan(it);
              if (r) return r;
            }
          } else if (typeof obj === "object") {
            // offer price pattern
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

        const found = scan(data);
        if (found) return String(found);
      } catch {
        // ignore
      }
    }
    return null;
  });

  {
    const p = parseTRY(jsonldPrice);
    if (typeof p === "number" && p > 0) return { price: p, store: "Akakçe", url };
  }

  // 3) Son çare: sayfada görünen ilk ₺ fiyatı
  const visiblePriceText = await page.evaluate(() => {
    const text = document.body ? (document.body.innerText || "") : "";
    const m = text.match(/₺\s*[\d.]+(?:,\d{1,2})?/);
    return m ? m[0] : null;
  });

  {
    const p = parseTRY(visiblePriceText);
    if (typeof p === "number" && p > 0) return { price: p, store: "Akakçe", url };
  }

  return null;
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
    let best = null;
    let offers = []; // stabil mod: boş bırakıyoruz
    let error = null;

    try {
      best = await getBestFromAkakce(page, p.akakce_url);
      if (!best) error = "AKAKCE_PRICE_NOT_FOUND";
    } catch (e) {
      error = String(e?.message || e);
    } finally {
      await page.close();
    }

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
