"use strict";

const bandClass = (band) => ({
  "Low": "low",
  "Moderate": "moderate",
  "High": "high",
  "Very High": "veryhigh",
}[band] || "low");

const state = { date: null, selected: null };

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  return res.json();
}

function fmt(n) { return (Math.round(n * 10) / 10).toFixed(1); }

async function loadSummary(date) {
  const s = await getJSON(`/api/summary?date=${date}`);
  const cards = [
    { label: "Population-weighted risk", value: fmt(s.population_weighted_risk_index), foot: `Territory-wide · ${date}` },
    { label: "Mean district risk", value: fmt(s.mean_risk_index), foot: `Range ${fmt(s.min_risk_index)}–${fmt(s.max_risk_index)}` },
    { label: "Highest-risk district", value: s.highest_risk_district.name, foot: `Index ${fmt(s.highest_risk_district.risk_index)} · ${s.highest_risk_district.band}`, small: true },
    { label: "Districts by band", value: bandBadges(s.band_counts), foot: "Low · Moderate · High · Very High", html: true },
  ];
  const el = document.getElementById("summary-cards");
  el.innerHTML = cards.map((c) => `
    <div class="card">
      <div class="card-label">${c.label}</div>
      <div class="card-value" style="${c.small ? 'font-size:22px' : ''}">${c.html ? c.value : c.value}</div>
      <div class="card-foot">${c.foot}</div>
    </div>`).join("");
}

function bandBadges(counts) {
  const order = [["Low", "low"], ["Moderate", "moderate"], ["High", "high"], ["Very High", "veryhigh"]];
  return `<span style="display:flex;gap:12px;font-size:26px">` +
    order.map(([label, cls]) => `<span class="band-${cls}" title="${label}">${counts[label] || 0}</span>`).join("") +
    `</span>`;
}

async function loadRanking(date) {
  const data = await getJSON(`/api/risk?date=${date}`);
  const list = document.getElementById("district-list");
  const districts = await districtNames();
  list.innerHTML = data.results.map((r, i) => {
    const cls = bandClass(r.band);
    const meta = districts[r.district_id] || { name: r.district_id, region: "" };
    return `
      <div class="district-row" data-id="${r.district_id}">
        <div class="rank">${i + 1}</div>
        <div>
          <div class="name">${meta.name}</div>
          <div class="region">${meta.region}</div>
        </div>
        <div class="risk-badge band-${cls}">
          <span class="risk-num">${fmt(r.risk_index)}</span>
          <span class="dot bg-${cls}"></span>
        </div>
      </div>`;
  }).join("");
  list.querySelectorAll(".district-row").forEach((row) => {
    row.addEventListener("click", () => selectDistrict(row.dataset.id));
  });
  if (state.selected) markActive(state.selected);
}

let _districtCache = null;
async function districtNames() {
  if (_districtCache) return _districtCache;
  const d = await getJSON("/api/districts");
  _districtCache = {};
  d.districts.forEach((x) => { _districtCache[x.id] = x; });
  return _districtCache;
}

function markActive(id) {
  document.querySelectorAll(".district-row").forEach((r) => {
    r.classList.toggle("active", r.dataset.id === id);
  });
}

async function selectDistrict(id) {
  state.selected = id;
  markActive(id);
  const detail = await getJSON(`/api/risk/${id}?date=${state.date}&days=30`);
  renderDetail(detail);
}

function renderDetail(detail) {
  const d = detail.district;
  const cur = detail.current;
  const risk = cur.risk;
  const obs = cur.observation;
  const cls = bandClass(risk.band);

  document.getElementById("detail-title").textContent = d.name;
  document.getElementById("detail-sub").textContent = `${d.region} · pop ${d.population.toLocaleString()} · ${fmt(d.population_density)}/km²`;

  const series = detail.history.map((h) => h.risk.risk_index);
  const dates = detail.history.map((h) => h.risk.date);

  const el = document.getElementById("detail");
  el.innerHTML = `
    <div class="detail-meta">
      <div class="metric"><div class="m-label">Risk index</div><div class="m-value band-${cls}">${fmt(risk.risk_index)} <span style="font-size:13px">${risk.band}</span></div></div>
      <div class="metric"><div class="m-label">PM2.5</div><div class="m-value">${fmt(obs.pm25)}<span style="font-size:12px;color:var(--text-dim)"> µg/m³</span></div></div>
      <div class="metric"><div class="m-label">NO₂</div><div class="m-value">${fmt(obs.no2)}<span style="font-size:12px;color:var(--text-dim)"> µg/m³</span></div></div>
      <div class="metric"><div class="m-label">O₃</div><div class="m-value">${fmt(obs.o3)}<span style="font-size:12px;color:var(--text-dim)"> µg/m³</span></div></div>
      <div class="metric"><div class="m-label">ILI rate</div><div class="m-value">${fmt(obs.ili_rate)}<span style="font-size:12px;color:var(--text-dim)"> /1k</span></div></div>
    </div>
    <div class="chart-title">30-day risk index trend</div>
    ${lineChart(series, dates)}
    <div class="chart-title">Risk composition (today)</div>
    <div class="subbars">
      ${subBar("Air quality", risk.air_subindex, "high")}
      ${subBar("Epidemiological", risk.epi_subindex, "moderate")}
      ${subBar("Susceptibility", risk.susceptibility_subindex, "veryhigh")}
    </div>`;
}

function subBar(label, value, cls) {
  const pct = Math.max(0, Math.min(100, value));
  return `<div class="subbar-row">
    <span>${label}</span>
    <span class="subbar-track"><span class="subbar-fill bg-${cls}" style="width:${pct}%"></span></span>
    <span style="text-align:right">${fmt(value)}</span>
  </div>`;
}

function lineChart(values, labels) {
  const W = 560, H = 180, padL = 30, padR = 12, padT = 12, padB = 22;
  const n = values.length;
  const min = 0;
  const max = Math.max(100, Math.ceil(Math.max(...values) / 10) * 10);
  const x = (i) => padL + (i * (W - padL - padR)) / Math.max(1, n - 1);
  const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);

  let path = "";
  values.forEach((v, i) => { path += (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(v).toFixed(1) + " "; });
  let area = path + `L ${x(n - 1).toFixed(1)} ${(H - padB).toFixed(1)} L ${x(0).toFixed(1)} ${(H - padB).toFixed(1)} Z`;

  const gridLines = [0, 25, 50, 75, 100].map((g) =>
    `<line x1="${padL}" y1="${y(g)}" x2="${W - padR}" y2="${y(g)}" stroke="#26304d" stroke-width="1"/>
     <text x="4" y="${y(g) + 4}" fill="#93a0bd" font-size="10">${g}</text>`).join("");

  const lastLabel = labels[labels.length - 1];
  const firstLabel = labels[0];

  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="30-day risk index trend">
    <defs>
      <linearGradient id="areaGrad" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="#5b8cff" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="#5b8cff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    ${gridLines}
    <path d="${area}" fill="url(#areaGrad)"/>
    <path d="${path}" fill="none" stroke="#5b8cff" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle cx="${x(n - 1)}" cy="${y(values[n - 1])}" r="4" fill="#5b8cff"/>
    <text x="${padL}" y="${H - 6}" fill="#93a0bd" font-size="10">${firstLabel}</text>
    <text x="${W - padR}" y="${H - 6}" fill="#93a0bd" font-size="10" text-anchor="end">${lastLabel}</text>
  </svg>`;
}

async function refresh() {
  state.date = document.getElementById("date").value;
  try {
    await Promise.all([loadSummary(state.date), loadRanking(state.date)]);
    if (state.selected) await selectDistrict(state.selected);
  } catch (err) {
    console.error(err);
    document.getElementById("summary-cards").innerHTML = `<div class="card"><div class="card-label">Error</div><div class="card-value" style="font-size:16px">${err.message}</div></div>`;
  }
}

function init() {
  const today = new Date().toISOString().slice(0, 10);
  const input = document.getElementById("date");
  input.value = today;
  input.max = today;
  state.date = today;
  document.getElementById("refresh").addEventListener("click", refresh);
  input.addEventListener("change", refresh);
  refresh();
}

document.addEventListener("DOMContentLoaded", init);
