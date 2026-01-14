function fmtTRY(n) {
  if (typeof n !== "number") return "N/A";
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY" }).format(n);
}

function siteLabel(s) {
  const map = {
    akakce: "Akakçe",
    amazontr: "Amazon TR",
    incehesap: "İncehesap",
    sinerji: "Sinerji",
    n11: "n11",
    idefix: "idefix",
    aykom: "Aykom",
    guvenliticaret: "GüvenliTicaret",
    revertpro: "RevertPro"
  };
  return map[s] || s;
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
    const bestSite = best ? siteLabel(best.site) : "—";

    const offersHtml = (p.offers || []).map(o => {
      const price = fmtTRY(o.price);
      const site = siteLabel(o.site);
      return `<div class="offer"><a href="${o.url}" target="_blank" rel="noreferrer">${site}</a><span>${price}</span></div>`;
    }).join("");

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h3>${p.name}</h3>
      <div class="badge">
        <strong>En ucuz: ${bestText}</strong>
        <span class="muted">(${bestSite})</span>
      </div>
      <div class="offers">${offersHtml}</div>
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
    const bestSite = best ? siteLabel(best.site) : "—";

    const others = (p.offers || [])
      .filter(o => !best || o.url !== best.url)
      .map(o => `${siteLabel(o.site)}: ${fmtTRY(o.price)}`)
      .join(" • ");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${bestPrice}</td>
      <td>${best ? `<a href="${best.url}" target="_blank" rel="noreferrer">${bestSite}</a>` : "—"}</td>
      <td class="muted">${others || "—"}</td>
    `;
    tbody.appendChild(tr);
  }
}

load().catch((e) => {
  document.getElementById("updatedAt").textContent = "Hata: data.json okunamadı";
  console.error(e);
});

