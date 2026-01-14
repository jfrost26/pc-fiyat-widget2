function fmtTRY(n) {
  if (typeof n !== "number") return "N/A";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
}

async function load() {
  const res = await fetch("./data.json", { cache: "no-store" });
  const data = await res.json();

  const updatedAt = document.getElementById("updatedAt");
  updatedAt.textContent = "Son güncelleme: " + new Date(data.updated_at).toLocaleString("tr-TR");

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

function safeLink(url, fallback) {
  return url || fallback || "#";
}

function renderCards(items) {
  const root = document.getElementById("cards");
  root.innerHTML = "";

  for (const p of items) {
    const best = p.best;
    const bestText = best ? fmtTRY(best.price) : "N/A";
    const bestStore = best ? (best.store || "—") : "—";
    const bestLink = safeLink(best?.url, p.akakce_url);

    const offersHtml = (p.offers || []).map(o => {
      const price = fmtTRY(o.price);
      const store = o.store || "Mağaza";
      const link = safeLink(o.url, p.akakce_url);
      return `<div class="offer"><a href="${link}" target="_blank" rel="noreferrer">${store}</a><span>${price}</span></div>`;
    }).join("");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${p.name}</h3>
      <div class="badge">
        <strong>En ucuz: ${bestText}</strong>
        <span class="muted">(<a href="${bestLink}" target="_blank" rel="noreferrer">${bestStore}</a>)</span>
      </div>
      <div class="offers">${offersHtml || `<div class="muted">Mağaza listesi bulunamadı. <a href="${safeLink(p.akakce_url)}" target="_blank" rel="noreferrer">Akakçe</a></div>`}</div>
      ${p.error ? `<div class="muted" style="margin-top:10px">Hata: ${p.error}</div>` : ""}
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
    const bestLink = safeLink(best?.url, p.akakce_url);

    const others = (p.offers || [])
      .filter(o => !best || o.url !== best.url)
      .map(o => `${o.store || "Mağaza"}: ${fmtTRY(o.price)}`)
      .join(" • ");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${bestPrice}</td>
      <td>${best ? `<a href="${bestLink}" target="_blank" rel="noreferrer">${bestStore}</a>` : "—"}</td>
      <td class="muted">${others || "—"}</td>
    `;
    tbody.appendChild(tr);
  }
}

load().catch((e) => {
  console.error(e);
  const updatedAt = document.getElementById("updatedAt");
  if (updatedAt) updatedAt.textContent = "Hata: data.json okunamadı";
});
