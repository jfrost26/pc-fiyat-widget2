function fmtTRY(n) {
  if (typeof n !== "number") return "N/A";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function load() {
  const res = await fetch("./data.json", { cache: "no-store" });
  const data = await res.json();

  document.getElementById("updatedAt").textContent =
    "Son güncelleme: " + new Date(data.updated_at).toLocaleString("tr-TR");

  const q = document.getElementById("q");
  const filter = document.getElementById("filter");
  const sort = document.getElementById("sort");

  const render = () => {
    const query = (q.value || "").toLowerCase().trim();
    let items = (data.products || []).slice();

    if (query) items = items.filter(p => (p.name || "").toLowerCase().includes(query));

    if (filter.value === "priced") items = items.filter(p => p.best && typeof p.best.price === "number");
    if (filter.value === "missing") items = items.filter(p => !p.best || typeof p.best.price !== "number");

    if (sort.value === "best_asc") {
      items.sort((a, b) => (a.best?.price ?? Infinity) - (b.best?.price ?? Infinity));
    } else {
      items.sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));
    }

    renderCards(items);
    renderTable(items);
  };

  q.addEventListener("input", render);
  filter.addEventListener("change", render);
  sort.addEventListener("change", render);

  render();
}

function renderCards(items) {
  const root = document.getElementById("cards");
  root.innerHTML = "";

  for (const p of items) {
    const best = p.best;
    const bestText = best ? fmtTRY(best.price) : "N/A";
    const bestStore = best ? (best.store || "—") : "—";
    const bestLink = best?.url || p.ref_url || "#";

    const offers = Array.isArray(p.offers) ? p.offers : [];
    const offersHtml = offers
      .map(o => {
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
      ${refHtml}
    `;
    root.appendChild(card);
  }
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
      .filter(o => typeof o.price === "number")
      .sort((a, b) => a.price - b.price)
      .map(o => `${o.store}: ${fmtTRY(o.price)}`)
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

load().catch((e) => {
  console.error(e);
  const updatedAt = document.getElementById("updatedAt");
  if (updatedAt) updatedAt.textContent = "Hata: data.json okunamadı";
});
