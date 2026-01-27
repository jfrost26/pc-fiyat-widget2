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

async function safeFetchJson(url) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * History dosyası formatı farklı olsa bile entries çıkarmaya çalışır.
 * Beklenen: history.products[productId] -> array
 */
function getHistoryEntries(history, productId) {
  if (!history) return [];

  // beklenen format
  if (history.products && typeof history.products === "object" && Array.isArray(history.products[productId])) {
    return history.products[productId];
  }

  // bazı alternatif olası formatlar (ileride değiştirirsen bile UI çalışsın diye)
  if (Array.isArray(history[productId])) return history[productId];
  if (history.items && Array.isArray(history.items[productId])) return history.items[productId];

  return [];
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
        <div class="histRow" style="margin-top:8px;padding-top:8px;border-top:1px solid rgba(0,0,0,.08)">
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
    const histCount = Array.isArray(entries) ? entries.length : 0;

    const historyHtml = showHist
      ? `<div class="history" style="margin-top:12px;padding:10px;border:1px solid rgba(0,0,0,.08);border-radius:10px">
          <div style="display:flex;gap:10px;align-items:baseline">
            <strong>History</strong>
            <span class="muted">(${histCount} değişim)</span>
          </div>
          ${renderHistoryList(entries)}
        </div>`
      : "";

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

async function load() {
  const data = await safeFetchJson("./data.json");
  const history = await safeFetchJson("./history.json");

  if (!data) {
    document.getElementById("updatedAt").textContent = "Hata: data.json okunamadı";
    return;
  }

  document.getElementById("updatedAt").textContent =
    "Son güncelleme: " + new Date(data.updated_at).toLocaleString("tr-TR");

  const hi = document.getElementById("historyInfo");
  if (hi) {
    hi.textContent = history?.updated_at ? ("History güncelleme: " + new Date(history.updated_at).toLocaleString("tr-TR")) : "History: bulunamadı (history.json yoksa normal)";
  }

  const q = document.getElementById("q");
  const filter = document.getElementById("filter");
  const sort = document.getElementById("sort");
  const showHistory = document.getElementById("showHistory");

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

    const showHist = !!showHistory?.checked;
    renderCards(items, history, showHist);
    renderTable(items);
  };

  q.addEventListener("input", render);
  filter.addEventListener("change", render);
  sort.addEventListener("change", render);
  showHistory.addEventListener("change", render);

  render();
}

load().catch((e) => {
  console.error(e);
  const updatedAt = document.getElementById("updatedAt");
  if (updatedAt) updatedAt.textContent = "Hata: UI yüklenemedi";
});
