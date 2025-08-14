import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTO_REFRESH_MINUTES } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

/* ==== DOM ==== */
const $app    = document.querySelector("#app");
const setStatus = (msg, isError=false) => {
  let $status = document.querySelector(".status");
  if (!$status) {
    // optioneel status-element links van je refresh-knop
    const bar = document.querySelector(".toolbar");
    if (bar) {
      $status = document.createElement("span");
      $status.className = "status";
      bar.appendChild($status);
    }
  }
  if ($status) {
    $status.textContent = msg;
    $status.className = "status" + (isError ? " error" : "");
  }
};

/* ==== Helpers ==== */

// Robuust read met rare keynamen (spaties/hoofdletters)
const get = (obj, ...candidates) => {
  const norm = Object.fromEntries(Object.entries(obj || {}).map(([k,v]) => [k.trim().toLowerCase(), v]));
  for (const c of candidates) {
    const k = String(c).trim().toLowerCase();
    if (k in norm && norm[k] != null && norm[k] !== "") return norm[k];
  }
  return null;
};

// Datum -> label (Ma/Di/Wo…) als "Dag" ontbreekt
const weekdayShort = (d) => ["Zo","Ma","Di","Wo","Do","Vr","Za"][d.getDay()];
const fmtNL = (iso) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("nl-NL", { weekday: "short" })} ${String(d.getDate()).padStart(2,"0")} ${d.toLocaleDateString("nl-NL",{ month:"short" })}`;
};

// Bouw datastructuur: [{locatie, days:[{label, datum, dayScore?, parts:[...] }]}]
function buildModel(rows) {
  // Map: locatie -> Map: datum(YYYY-MM-DD) -> { label, datum, parts:[] }
  const byLoc = new Map();

  for (const r of rows) {
    const locatie = get(r, "Locatie") || "Onbekend";
    const datumISO = get(r, "Datum"); // "2025-08-18"
    if (!datumISO) continue;

    const dagLabel = get(r, "Dag") || weekdayShort(new Date(datumISO)); // "Maandag" of "Ma"
    const dagdeel  = get(r, "Dagdeel") || "Algemeen";

    const wind     = get(r, "Wind");
    const windR    = get(r, "Wind richting");
    const getij    = get(r, "Getij", "Getij ");
    const getijScore = get(r, "Getij score");
    const hoogte   = get(r, "Golf hoogte");
    const clean    = get(r, "Clean");
    const swell    = get(r, "Swell");
    const periode  = get(r, "Periode");
    const adviesPro = get(r, "Gaan Pro");
    const adviesBeg = get(r, "Gaan beginner");

    if (!byLoc.has(locatie)) byLoc.set(locatie, new Map());
    const daysMap = byLoc.get(locatie);
    if (!daysMap.has(datumISO)) {
      daysMap.set(datumISO, {
        label: dagLabel,
        datum: new Date(datumISO),
        parts: []
      });
    }
    daysMap.get(datumISO).parts.push({
      name: dagdeel,
      hoogte: hoogte ?? "—",
      periode: periode ?? "—",
      wind: [wind, windR].filter(Boolean).join(" ") || "—",
      getij: [getij, getijScore].filter(Boolean).join(" ") || (getij ?? "—"),
      clean: clean ?? null,
      swell: swell ?? null,
      adviesPro: adviesPro ?? null,
      adviesBeg: adviesBeg ?? null,
      score: null, // (optioneel) later berekenen
    });
  }

  // Sorteer per locatie op datum oplopend & maak dagLabel + dayScore
  const model = [];
  for (const [loc, daysMap] of byLoc) {
    const days = Array.from(daysMap.entries())
      .sort((a,b) => a[0].localeCompare(b[0]))
      .map(([iso, day]) => ({
        label: day.label,
        datum: fmtNL(iso),
        dayScore: null, // (optioneel) gemiddelde van parts.score
        parts: day.parts
      }));
    model.push({ locatie: loc, days });
  }
  return model;
}

/* ==== Render (zelfde stijl als je demo) ==== */

function Part(p){
  const el = document.createElement("div");
  el.className = "part";
  el.innerHTML = `
    <div class="p-name">${p.name}</div>
    <div class="kv">Golfhoogte<b>${p.hoogte}</b></div>
    <div class="kv">Swell Periode<b>${p.periode}</b></div>
    <div class="kv">Wind<b>${p.wind}</b></div>
    <div class="kv">Getij<b>${p.getij}</b></div>
    ${p.adviesPro ? `<div class="kv" style="grid-column:1/-1"><span>Advies (Pro)</span><b>${p.adviesPro}</b></div>` : ""}
    ${p.adviesBeg ? `<div class="kv" style="grid-column:1/-1"><span>Advies (Beginner)</span><b>${p.adviesBeg}</b></div>` : ""}
  `;
  return el;
}

function DayCol(d){
  const el = document.createElement("div");
  el.className = "day";
  el.innerHTML = `
    <div class="day-hd">
      <div>
        <div class="d-title">${d.label}</div>
        <div class="d-sub">${d.datum}</div>
      </div>
      ${d.dayScore != null ? `<div class="score" title="Dagscore">${d.dayScore}/10</div>` : `<div style="width:40px;height:40px"></div>`}
    </div>
    <div class="parts"></div>
  `;
  const parts = el.querySelector(".parts");
  d.parts.forEach(p => parts.appendChild(Part(p)));
  return el;
}

function LocationBlock(loc){
  const box = document.createElement("section");
  box.className = "location";
  box.innerHTML = `
    <div class="location-hd">
      <div class="location-title">${loc.locatie}</div>
      <div class="hint">7-daagse weergave</div>
    </div>
    <div class="days"></div>
  `;
  const days = box.querySelector(".days");
  loc.days.forEach(d => days.appendChild(DayCol(d)));
  return box;
}

function render(model){
  $app.innerHTML = "";
  model.forEach(loc => $app.appendChild(LocationBlock(loc)));
}

/* ==== Data ophalen + verwerken ==== */

async function fetchLatestJSON() {
  // Haal de laatste rij op (body_processed bevat de JSON-string)
  const { data, error } = await supabase.rpc("get_latest_sms");
  if (error) throw error;

  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (!row || !row.body_processed) throw new Error("Geen body_processed gevonden.");

  // Probeer JSON te parsen
  let parsed;
  try {
    parsed = JSON.parse(row.body_processed);
  } catch (e) {
    console.error("JSON parse error:", e);
    throw new Error("Kon body_processed niet als JSON parsen.");
  }
  if (!Array.isArray(parsed)) throw new Error("JSON is geen array.");

  return parsed;
}

async function load() {
  try{
    setStatus("Laden…");
    const rows = await fetchLatestJSON();
    const model = buildModel(rows);
    render(model);

    // Klein statuslabel
    setStatus(`Laatst ververst: ${new Date().toLocaleTimeString()}`);
  } catch (e){
    console.error(e);
    setStatus(`Fout: ${e.message}`, true);
  }
}

document.querySelector("#refresh")?.addEventListener("click", load);
load();

if (AUTO_REFRESH_MINUTES && Number(AUTO_REFRESH_MINUTES) > 0){
  setInterval(load, Number(AUTO_REFRESH_MINUTES) * 60 * 1000);
}
