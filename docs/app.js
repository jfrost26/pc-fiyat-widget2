function fmtTRY(n) {
  if (typeof n !== "number") return "N/A";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
}

function fmtDT(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR");
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function trendArrow(curr, prev) {
  if (typeof curr !== "number" || typeof prev !== "number") return "";
  if (curr > prev) return "↑";
  if (curr < prev) return "↓";
  return "→";
}

function pctChange(curr, base) {
  if (typeof curr !== "number" || typeof base !== "number" || base === 0) return null;
  return ((curr - base) / base) * 100;
}

async function safeFetchJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function getHistoryEntries(history, productId) {
  if (!history) return [];
  if (history.products && typeof history.products === "object" && Array.isArray(history.products[productId])) {
    return history.products[productId];
  }
  if (Array.isArray(history[productId])) return history[productId];
  if (history.items && Array.isArray(history.items[productId])) return history.items[productId];
  return [];
}

function computeHistoryStats(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;

  let min = Infinity, max = -Infinity;
  let minEntry = null, maxEntry = null;

  for (const e of entries) {
    if (typeof e.price !== "number") continue;
    if (e.price < min) { min = e.price; minEntry = e; }
    if (e.price > max) { max = e.price; maxEntry = e; }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  const first = entries[0];
  const last = entries[entries.length - 1];

  // “Bir önceki değişim” (varsa) — build delta için kullanacağız
  const prev = entries.length >= 2 ? entries[entries.length - 2] : null;

  return { count: entries.length, first, last, prev, minEntry, maxEntry };
}

function renderHistoryList(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return `<div class="muted">History yok.</div>`;
  }

  const last5 = entries.slice(-5).reverse();

  return last5
    .map((e, idx) => {
      const price = fmtTRY(e.price);
      const store = escapeHtml(e.store || "—");
      const url = e.url || "#";
      const first = fmtDT(e.first_seen_at);
      const last = fmtDT(e.last_seen_at);

      const prevEntry = entries[entries.length - (idx + 2)];
      const arrow = prevEntry ? trendArrow(e.price, prevEntry.price) : "";

      return `
        <div style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.08)">
          <div>
            <strong>${arrow} ${price}</strong>
            <span class="muted"> — <a href="${url}" target="_blank" rel="noreferrer">${store}</a></span>
          </div>
          <div class="muted" style="margin-top:4px;font-size:0.9em">
            İlk: ${first} • Son: ${last}
          </div>
        </div>
      `;
    })
    .join("");
}

function renderTable(items) {
  const tbody = document.querySelector("#table tbody");
  tbody.innerHTML = "";

  for (const p of items) {
    const best = p.best;
    const bestPrice = best ? fmtTRY(best.price) : "N/A";
    const bestStore = best ? (best.store || "—") : "—";
    const bestLink = best?.url || p.ref_url || "#";

    const others = (p.offers || [])
      .filter((o) => typeof o.price === "number")
      .sort((a, b) => a.price - b.price)
      .map((o) => `${o.store}: ${fmtTRY(o.price)}`)
      .join(" • ");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${bestPrice}</td>
      <td>${best ? `<a href="${bestLink}" target="_blank" rel="noreferrer">${escapeHtml(bestStore)}</a>` : "—"}</td>
      <td class="muted">${escapeHtml(others || "—")}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderCards(items, history, showHist) {
  const root = document.getElementById("cards");
  root.innerHTML = "";

  for (const p of items) {
    const best = p.best;
    const bestText = best ? fmtTRY(best.price) : "N/A";
    const bestStore = best ? (best.store || "—") : "—";
    const bestLink = best?.url || p.ref_url || "#";

    const offers = Array.isArray(p.offers) ? p.offers : [];
    const offersHtml = offers
      .map((o) => {
        const store = escapeHtml(o.store || "Mağaza");
        const url = o.url || p.ref_url || "#";
        const price = typeof o.price === "number" ? fmtTRY(o.price) : "N/A";
        const err = o.error ? `<div class="muted" style="margin-top:4px">(${escapeHtml(o.error)})</div>` : "";
        return `<div class="offer">
          <a href="${url}" target="_blank" rel="noreferrer">${store}</a>
          <span>${price}</span>
          ${err}
        </div>`;
      })
      .join("");

    const refHtml = p.ref_url
      ? `<div class="muted" style="margin-top:10px">Referans: <a href="${p.ref_url}" target="_blank" rel="noreferrer">Akakçe</a></div>`
      : "";

    const entries = getHistoryEntries(history, p.id);
    const stats = computeHistoryStats(entries);

    let historyHtml = "";
    if (showHist) {
      if (!stats) {
        historyHtml = `
          <div style="margin-top:12px;padding:10px;border:1px solid rgba(0,0,0,.08);border-radius:10px">
            <strong>History</strong> <span class="muted">(0 değişim)</span>
            <div class="muted" style="margin-top:8px">History yok.</div>
          </div>
        `;
      } else {
        const firstPrice = stats.first?.price;
        const lastPrice = stats.last?.price;
        const minPrice = stats.minEntry?.price;
        const maxPrice = stats.maxEntry?.price;

        const diff = (typeof lastPrice === "number" && typeof firstPrice === "number") ? (lastPrice - firstPrice) : null;
        const pct = pctChange(lastPrice, firstPrice);

        const diffTxt =
          diff === null ? "—" :
          (diff === 0 ? "0" : (diff > 0 ? `+${fmtTRY(diff)}` : `-${fmtTRY(Math.abs(diff))}`));

        const pctTxt =
          pct === null ? "" :
          ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`;

        historyHtml = `
          <div style="margin-top:12px;padding:10px;border:1px solid rgba(0,0,0,.08);border-radius:10px">
            <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
              <strong>History</strong>
              <span class="muted">(${stats.count} değişim)</span>
            </div>

            <div class="muted" style="margin-top:8px">
              <div><strong>İlk:</strong> ${fmtTRY(firstPrice)} • <strong>Min:</strong> ${fmtTRY(minPrice)} • <strong>Max:</strong> ${fmtTRY(maxPrice)}</div>
              <div><strong>Değişim:</strong> ${diffTxt}${pctTxt}</div>
            </div>

            <div style="margin-top:8px">${renderHistoryList(entries)}</div>
          </div>
        `;
      }
    }

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${escapeHtml(p.name)}</h3>
      <div class="badge">
        <strong>En ucuz: ${bestText}</strong>
        <span class="muted">(<a href="${bestLink}" target="_blank" rel="noreferrer">${escapeHtml(bestStore)}</a>)</span>
      </div>

      <div class="offers">${offersHtml || `<div class="muted">Teklif yok.</div>`}</div>
      ${p.error ? `<div class="muted" style="margin-top:10px">Ürün durumu: ${escapeHtml(p.error)}</div>` : ""}

      ${historyHtml}
      ${refHtml}
    `;
    root.appendChild(card);
  }
}

function renderBuildTotal(allProducts, history) {
  const totalEl = document.getElementById("buildTotal");
  const deltaEl = document.getElementById("buildDelta");
  const noteEl = document.getElementById("buildNote");

  if (!totalEl || !deltaEl || !noteEl) return;

  const priced = (allProducts || []).filter(p => p.best && typeof p.best.price === "number");
  const missing = (allProducts || []).filter(p => !p.best || typeof p.best.price !== "number");

  const total = priced.reduce((sum, p) => sum + p.best.price, 0);

  // Approx delta: sum(current_best - previous_change_price)
  let delta = 0;
  let deltaCount = 0;

  for (const p of priced) {
    const entries = getHistoryEntries(history, p.id);
    const stats = computeHistoryStats(entries);
    const prevPrice = stats?.prev?.price;
    if (typeof prevPrice === "number") {
      delta += (p.best.price - prevPrice);
      deltaCount++;
    }
  }

  totalEl.textContent = fmtTRY(total);

  if (deltaCount > 0) {
    const sign = delta > 0 ? "+" : "";
    deltaEl.textContent = `• Son değişimlere göre: ${sign}${fmtTRY(delta)}`;
  } else {
    deltaEl.textContent = "";
  }

  if (missing.length === 0) {
    noteEl.textContent = "Tüm parçalar fiyatlandı (en ucuz mağazalar üzerinden).";
  } else {
    noteEl.textContent = `Not: ${missing.length} parçada fiyat yoksa toplam eksik/az çıkabilir.`;
  }
}

function renderComparisonTable(items, history, productsPublic, category) {
  const tbody = document.querySelector("#comparisonTable tbody");
  if (!tbody) return;

  const categoryMap = new Map(
    Array.isArray(productsPublic)
      ? productsPublic.map((p) => [p.id, p.category])
      : []
  );

  const filtered = (items || []).filter((p) => categoryMap.get(p.id) === category);
  filtered.sort((a, b) => (a.best?.price ?? Infinity) - (b.best?.price ?? Infinity));

  tbody.innerHTML = "";

  if (filtered.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="5" class="muted">Seçili kategoride ürün bulunamadı.</td>`;
    tbody.appendChild(tr);
    return;
  }

  for (const p of filtered) {
    const bestPrice = p.best ? fmtTRY(p.best.price) : "N/A";

    const entries = getHistoryEntries(history, p.id);
    const stats = computeHistoryStats(entries);
    const minPrice = stats?.minEntry?.price;
    const maxPrice = stats?.maxEntry?.price;
    const firstPrice = stats?.first?.price;
    const lastPrice = stats?.last?.price;

    const diff = (typeof lastPrice === "number" && typeof firstPrice === "number") ? (lastPrice - firstPrice) : null;
    const pct = pctChange(lastPrice, firstPrice);

    const diffTxt =
      diff === null ? "—" :
      (diff === 0 ? fmtTRY(0) : (diff > 0 ? `+${fmtTRY(diff)}` : `-${fmtTRY(Math.abs(diff))}`));

    const pctTxt =
      pct === null ? "" :
      ` (${pct > 0 ? "+" : ""}${pct.toFixed(1)}%)`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td>${bestPrice}</td>
      <td>${typeof minPrice === "number" ? fmtTRY(minPrice) : "—"}</td>
      <td>${typeof maxPrice === "number" ? fmtTRY(maxPrice) : "—"}</td>
      <td>${diffTxt}${pctTxt}</td>
    `;
    tbody.appendChild(tr);
  }
}

async function load() {
  const data = await safeFetchJson("./data.json");
  const history = await safeFetchJson("./history.json");
  const productsPublic = await safeFetchJson("./products.public.json");

  if (!data) {
    document.getElementById("updatedAt").textContent = "Hata: data.json okunamadı";
    return;
  }

  document.getElementById("updatedAt").textContent =
    "Son güncelleme: " + new Date(data.updated_at).toLocaleString("tr-TR");

  const hi = document.getElementById("historyInfo");
  if (hi) {
    hi.textContent = history?.updated_at
      ? ("History güncelleme: " + new Date(history.updated_at).toLocaleString("tr-TR"))
      : "History: bulunamadı (ilk run ise normal)";
  }

  // build total (always)
  renderBuildTotal(data.products || [], history);

  const q = document.getElementById("q");
  const filter = document.getElementById("filter");
  const sort = document.getElementById("sort");
  const showHistory = document.getElementById("showHistory");
  const comparisonCategory = document.getElementById("comparisonCategory");

  const render = () => {
    const query = (q.value || "").toLowerCase().trim();
    let items = (data.products || []).slice();

    if (query) items = items.filter((p) => (p.name || "").toLowerCase().includes(query));

    if (filter.value === "priced") items = items.filter((p) => p.best && typeof p.best.price === "number");
    if (filter.value === "missing") items = items.filter((p) => !p.best || typeof p.best.price !== "number");

    if (sort.value === "best_asc") {
      items.sort((a, b) => (a.best?.price ?? Infinity) - (b.best?.price ?? Infinity));
    } else {
      items.sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));
    }

    renderCards(items, history, !!showHistory?.checked);
    renderTable(items);
    renderComparisonTable(data.products || [], history, productsPublic, comparisonCategory?.value || "gpu");
  };

  q.addEventListener("input", render);
  filter.addEventListener("change", render);
  sort.addEventListener("change", render);
  showHistory.addEventListener("change", render);
  const scrollToComparison = () => {
    const target =
      document.querySelector("#comparisonSection") ||
      document.querySelector("#comparisonTable")?.closest(".tableWrap") ||
      document.querySelector("#comparisonTable");
    target?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  comparisonCategory?.addEventListener("change", () => {
    render();
    scrollToComparison();
  });

  render();
}

load().catch((e) => {
  console.error(e);
  const updatedAt = document.getElementById("updatedAt");
  if (updatedAt) updatedAt.textContent = "Hata: UI yüklenemedi";
});
