// react-app.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const RPC_NAME = "get_latest_sms_public";

const { useState, useEffect } = window.React;

function normalizeSpotId(id){
  return String(id || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/* ===== Spot metadata ===== */
const SPOTS_META = {
  "scheveningen": { name: "Scheveningen", region: "Z-H", shoreBearing: 260 },
  "wijk aan zee": { name: "Wijk aan Zee", region: "N-H", shoreBearing: 250 },
  "domburg": { name: "Domburg", region: "Zeeland", shoreBearing: 230 },
  "ijmuiden": { name: "IJmuiden", region: "N-H", shoreBearing: 260 },
  "zandmotor zuid": { name: "Zandmotor zuid", region: "Z-H", shoreBearing: 260 },
  "katwijk": { name: "Katwijk", region: "Z-H", shoreBearing: 260 },
  "noordwijk": { name: "Noordwijk", region: "Z-H", shoreBearing: 260 },
  "wassenaar": { name: "Wassenaar", region: "Z-H", shoreBearing: 260 },
  "kijkduin": { name: "Kijkduin", region: "Z-H", shoreBearing: 260 },
  "hoek van holland": { name: "Hoek van Holland", region: "Z-H", shoreBearing: 260 },
  "maasvlakte": { name: "Maasvlakte", region: "Z-H", shoreBearing: 260 },
  "ouddorp": { name: "Ouddorp", region: "Z-H", shoreBearing: 240 },
  "zandvoort": { name: "Zandvoort", region: "N-H", shoreBearing: 255 },
  "petten": { name: "Petten", region: "N-H", shoreBearing: 255 },
  "bergen": { name: "Bergen", region: "N-H", shoreBearing: 255 },
  "egmond": { name: "Egmond", region: "N-H", shoreBearing: 255 },
  "texel": { name: "Texel", region: "Wadden", shoreBearing: 220 },
  "vlieland": { name: "Vlieland", region: "Wadden", shoreBearing: 210 },
  "terschelling": { name: "Terschelling", region: "Wadden", shoreBearing: 210 },
  "ameland": { name: "Ameland", region: "Wadden", shoreBearing: 200 },
  "schiermonnikoog": { name: "Schiermonnikoog", region: "Wadden", shoreBearing: 190 },
  "cadzand": { name: "Cadzand", region: "Zeeland", shoreBearing: 220 },
  "oostende": { name: "Oostende", region: "BE", shoreBearing: 230 },
  "zeebrugge": { name: "Zeebrugge", region: "BE", shoreBearing: 230 },
  "middelkerke": { name: "Middelkerke", region: "BE", shoreBearing: 230 },
  "knokke-heist": { name: "Knokke-Heist", region: "BE", shoreBearing: 230 },
  "de panne": { name: "De Panne", region: "BE", shoreBearing: 230 },
  "ter heijde": { name: "Ter Heijde", region: "Z-H", shoreBearing: 260 }
};
const SPOT_ALIAS_MAP = (() => {
  const map = new Map();
  Object.keys(SPOTS_META).forEach(key => {
    const norm = normalizeSpotId(key);
    if (norm && !map.has(norm)) map.set(norm, key);
  });
  return map;
})();
const OPENMETEO_ALIASES = new Map([
  ['wijkaanzeenoordpier', 'wijk aan zee'],
  ['wijkenzeenoordpier', 'wijk aan zee'],
  ['wijkaanzee', 'wijk aan zee'],
  ['scheveningen', 'scheveningen']
]);
const DEFAULT_META = { name: null, region: null, shoreBearing: 260 };
const getSpotMeta = (id) =>
  SPOTS_META[String(id || "").toLowerCase()] || { name: id, ...DEFAULT_META };

const PART_KEYS = ["ochtend", "middag", "avond"];
const PART_LABELS = { ochtend: "Ochtend", middag: "Middag", avond: "Avond" };

function safeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseJSONSafe(value) {
  if (value == null) return null;
  if (typeof value === 'object') return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch (err) { console.warn('Kon JSON niet parsen', err); }
  }
  return null;
}

function average(values){
  if (!values || !values.length) return null;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

function meanCircularDeg(values){
  if (!values || !values.length) return null;
  const radians = values.map(v => (v * Math.PI) / 180);
  const sin = radians.reduce((acc, rad) => acc + Math.sin(rad), 0) / values.length;
  const cos = radians.reduce((acc, rad) => acc + Math.cos(rad), 0) / values.length;
  if (!Number.isFinite(sin) || !Number.isFinite(cos)) return null;
  const angle = Math.atan2(sin, cos) * (180 / Math.PI);
  return angle < 0 ? angle + 360 : angle;
}

function msToBeaufort(ms){
  if (ms == null || !Number.isFinite(ms)) return null;
  const limits = [0.5,1.5,3.3,5.5,7.9,10.7,13.8,17.1,20.7,24.4,28.4,32.6];
  for (let i = 0; i < limits.length; i += 1){
    if (ms < limits[i]) return i;
  }
  return 12;
}

function degToCompass(deg){
  if (deg == null || !Number.isFinite(deg)) return null;
  const dirs = ['N','NNO','NO','ONO','O','OZO','ZO','ZZO','Z','ZZW','ZW','WZW','W','WNW','NW','NNW'];
  const idx = Math.round(((deg % 360) / 22.5)) % dirs.length;
  return dirs[idx];
}

function hourToDaypart(hour){
  if (!Number.isFinite(hour)) return null;
  if (hour < 12) return 'ochtend';
  if (hour < 18) return 'middag';
  if (hour < 24) return 'avond';
  return null;
}

function aggregateOpenMeteoArray(records){
  if (!Array.isArray(records)) return {};
  const buckets = new Map();
  const originalNames = new Map();

  records.forEach(rec => {
    const spotRaw = rec?.Locatie ?? rec?.locatie ?? rec?.location;
    const date = rec?.Datum ?? rec?.datum ?? rec?.date;
    const time = rec?.Tijd ?? rec?.tijd ?? rec?.time;
    if (!spotRaw || !date || !time) return;
    const hour = Number(String(time).split(':')[0]);
    const part = hourToDaypart(hour);
    if (!part) return;
    const normSpot = normalizeSpotId(spotRaw);
    if (!normSpot) return;
    const spotEntry = buckets.get(normSpot) || new Map();
    if (!buckets.has(normSpot)) buckets.set(normSpot, spotEntry);
    if (!originalNames.has(normSpot)) originalNames.set(normSpot, spotRaw);
    const dayEntry = spotEntry.get(date) || { date, parts: {} };
    if (!spotEntry.has(date)) spotEntry.set(date, dayEntry);
    const partBucket = dayEntry.parts[part] || (dayEntry.parts[part] = {
      wave: [],
      period: [],
      windSpeed: [],
      windDir: []
    });

    const waveHeight = safeNumber(rec.wave_height ?? rec.swell_wave_height);
    if (waveHeight != null) partBucket.wave.push(waveHeight);
    const swellPeriod = safeNumber(rec.swell_wave_period ?? rec.wave_period);
    if (swellPeriod != null) partBucket.period.push(swellPeriod);
    const windSpeed = safeNumber(rec.wind_speed_10m ?? rec.wind_speed);
    if (windSpeed != null) partBucket.windSpeed.push(windSpeed);
    const windDir = safeNumber(rec.wind_direction_10m ?? rec.wind_wave_direction);
    if (windDir != null) partBucket.windDir.push(windDir);
  });

  const result = {};
  buckets.forEach((datesMap, normSpot) => {
    const canonical = OPENMETEO_ALIASES.get(normSpot)
      || SPOT_ALIAS_MAP.get(normSpot)
      || originalNames.get(normSpot)
      || normSpot;
    const days = [];
    datesMap.forEach(day => {
      const parts = {};
      Object.entries(day.parts).forEach(([partKey, values]) => {
        const entry = {};
        if (values.wave.length){
          const avgWave = average(values.wave);
          if (avgWave != null) entry.swell_m = Number(avgWave.toFixed(1));
        }
        if (values.period.length){
          const avgPeriod = average(values.period);
          if (avgPeriod != null) entry.period_s = Math.round(avgPeriod);
        }
        if (values.windSpeed.length){
          const avgWind = average(values.windSpeed);
          if (avgWind != null){
            entry.wind_bft = msToBeaufort(avgWind);
            entry.wind_kmh = Math.round(avgWind * 3.6);
          }
        }
        const meanDir = meanCircularDeg(values.windDir);
        if (meanDir != null){
          entry.wind_dir_deg = Math.round(meanDir);
          entry.wind_dir = degToCompass(meanDir);
        }
        if (['swell_m','period_s','wind_bft','wind_kmh','wind_dir'].some(k => entry[k] != null)){
          entry.source = 'openmeteo';
          parts[partKey] = entry;
        }
      });
      if (Object.keys(parts).length){
        days.push({ date: day.date, parts, source: 'openmeteo' });
      }
    });
    if (days.length){
      days.sort((a,b) => (a.date || '').localeCompare(b.date || ''));
      result[canonical] = days;
    }
  });

  return result;
}

/* ===== Utils ===== */
function degDiff(a, b) { let d = Math.abs(a - b) % 360; if (d > 180) d = 360 - d; return d; }
function normalizeWindDir(dir) {
  if (!dir) return null;
  const t = String(dir).trim().toUpperCase();
  const MAP = {
    'N': 'N','NOORD': 'N','NNO': 'NNO','NOORDNOORDOOST': 'NNO',
    'NO': 'NO','NOORDOOST': 'NO','ONO': 'ONO','OOSTNOORDOOST': 'ONO',
    'O': 'O','OOST': 'O','OZO': 'OZO','OOSTZUIDOOST': 'OZO',
    'ZO': 'ZO','ZUIDOOST': 'ZO','ZZO': 'ZZO','ZUIDZUIDOOST': 'ZZO',
    'Z': 'Z','ZUID': 'Z','ZZW': 'ZZW','ZUIDZUIDWEST': 'ZZW',
    'ZW': 'ZW','ZUIDWEST': 'ZW','WZW': 'WZW','WESTZUIDWEST': 'WZW',
    'W': 'W','WEST': 'W','WNW': 'WNW','WESTNOORDWEST': 'WNW',
    'NW': 'NW','NOORDWEST': 'NW','NNW': 'NNW','NOORDNOORDWEST': 'NNW'
  };
  return MAP[t] || dir;
}
function parseWindDirString(dir){
  if(!dir) return null;
  const t = String(dir).split(/[\/\s,]+/)[0].toUpperCase();
  const MAP = { 'N':0,'NNO':22.5,'NO':45,'ONO':67.5,'O':90,'OZO':112.5,'ZO':135,'ZZO':157.5,'Z':180,'ZZW':202.5,'ZW':225,'WZW':247.5,'W':270,'WNW':292.5,'NW':315,'NNW':337.5 };
  return MAP[t] ?? null;
}
function computeWindType(spotMeta, windDirStr){
  const deg = parseWindDirString(windDirStr);
  if (deg === null) return null;
  const diff = degDiff(deg, spotMeta.shoreBearing ?? 260);
  if (diff <= 45) return 'onshore';
  if (Math.abs(diff - 180) <= 45) return 'offshore';
  return 'crossshore';
}
function bftToKmh(bft){ if(bft == null || isNaN(bft)) return null; return Math.round(3.0096 * Math.pow(Number(bft), 1.5)); }
function computeScore({ swell_m, period_s, wind_bft, wind_type }){
  let score = 0;
  if (swell_m >= 1.2) score += 2; else if (swell_m >= 0.6) score += 1;
  if (period_s >= 9) score += 1; else if (period_s >= 7) score += 0.5;
  if (wind_type === 'offshore') score += 1;
  if (wind_type === 'crossshore') score += 0.5;
  if (wind_type === 'onshore' && wind_bft >= 4) score -= 1;
  return Math.max(0, Math.min(4, Math.round(score)));
}
function mapScoreToColor(score){
  if (score <= 0) return { classDay: 'q-red', classPart: 'part-red' };
  if (score === 1) return { classDay: 'q-orange', classPart: 'part-orange' };
  if (score === 2 || score === 3) return { classDay: 'q-green', classPart: 'part-green' };
  return { classDay: 'q-dark', classPart: 'part-dark' };
}
function buildConclusion(agg){
  if(!agg) return '';
  if (agg.score >= 4) return 'Top-condities, beste momenten bij hoogwater.';
  if (agg.score === 3) return 'Goede surfmomenten vandaag, vooral rond tij-window.';
  if (agg.score === 2) return 'Prima voor longboards of fish; minder ideaal voor shortboards.';
  if (agg.score === 1) return 'Klein en rommelig; leuk voor beginners.';
  return 'Geen surfbare condities.';
}

/* ===== Supabase fetch ===== */
async function loadFromSupabase(){
  const { data, error } = await supa.rpc(RPC_NAME);
  if (error) throw error;
  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (!row) return {};

  const payload = parseJSONSafe(row.body_processed) || {};
  Object.keys(payload).forEach(k => {
    if (Array.isArray(payload[k])) {
      payload[k].sort((a,b) => (a?.date||"").localeCompare(b?.date||""));
    }
  });

  const meteoRaw = parseJSONSafe(row.openmeteo);
  let meteoAgg = {};
  if (Array.isArray(meteoRaw)) {
    meteoAgg = aggregateOpenMeteoArray(meteoRaw);
  } else if (meteoRaw && typeof meteoRaw === 'object') {
    meteoAgg = meteoRaw;
  }
  const merged = { ...payload };
  const lookup = new Map();
  Object.keys(merged).forEach(key => {
    const norm = normalizeSpotId(key);
    if (norm && !lookup.has(norm)) lookup.set(norm, key);
  });

  Object.entries(meteoAgg).forEach(([spotIdRaw, days]) => {
    const normId = normalizeSpotId(spotIdRaw);
    const targetKey = lookup.get(normId) || spotIdRaw;
    if (!lookup.has(normId)) lookup.set(normId, targetKey);

    const existing = Array.isArray(merged[targetKey]) ? [...merged[targetKey]] : [];
    const indexByDate = new Map(existing.map((entry, idx) => [entry?.date, { idx, value: entry }]));

    (Array.isArray(days) ? days : []).forEach(day => {
      if (!day || !day.date) return;
      const partEntries = day.parts && typeof day.parts === 'object' ? day.parts : {};
      const normalizedParts = {};
      Object.entries(partEntries).forEach(([partKey, values]) => {
        if (!partKey) return;
        const cleanKey = partKey.toLowerCase();
        normalizedParts[cleanKey] = {
          ...(typeof values === 'object' && values ? values : {}),
          source: 'openmeteo'
        };
      });

      const existingRef = indexByDate.get(day.date);
      if (existingRef) {
        const current = existingRef.value || {};
        const mergedParts = { ...(current.parts || {}) };
        Object.entries(normalizedParts).forEach(([partKey, partValues]) => {
          mergedParts[partKey] = { ...(current.parts?.[partKey] || {}), ...partValues };
        });
        const updated = {
          ...current,
          parts: mergedParts,
          date: current.date || day.date,
          source: current.source || day.source || 'openmeteo'
        };
        existing[existingRef.idx] = updated;
      } else {
        existing.push({
          date: day.date,
          parts: normalizedParts,
          source: day.source || 'openmeteo'
        });
      }
    });

    existing.sort((a,b) => (a?.date||"").localeCompare(b?.date||""));
    merged[targetKey] = existing;
  });

  return merged;
}

/* ===== Sidebar ===== */
function Sidebar({ page, setPage }) {
  return window.React.createElement('aside', { className: 'hidden md:flex flex-col w-40 border-r p-4 gap-6' },
    window.React.createElement('img', { src: './Ingezoomd logo.png', alt: 'Logo', className: 'h-10 w-auto mb-6 object-contain' }),

    window.React.createElement('nav', { className: 'flex flex-col gap-4 text-sm' },
      ['home','cams'].map(item =>
        window.React.createElement('button', {
          key: item,
          onClick: () => setPage(item),
          className: `flex items-center gap-2 px-2 py-1 rounded transition-colors
            ${page===item ? 'font-bold text-purple-600' : 'text-gray-600 hover:text-purple-600'}`

        },
          window.React.createElement('span', { className:'material-icons' },
            item === 'home' ? 'home' : 'videocam'
          ),
          item === 'home' ? 'Home' : 'Cams'
        )
      )
    )
  );
}

/* ===== BottomNav ===== */
function BottomNav({ page, setPage }) {
  return window.React.createElement('nav', { className: 'md:hidden fixed bottom-0 left-0 right-0 bg-white border-t flex justify-around py-2' },
    ['home','cams'].map(item =>
      window.React.createElement('button', {
        key: item,
        onClick: () => setPage(item),
        className: `${page===item?'text-purple-600':'text-gray-600'} flex flex-col items-center`
      },
        window.React.createElement('span', { className:'material-icons text-2xl' },
          item === 'home' ? 'home' : 'videocam'
        )
      )
    )
  );
}

/* ===== Dummy CamsPage ===== */
function CamsPage() {
  return window.React.createElement('div', { className: 'p-6' },
    window.React.createElement('h1', { className: 'text-2xl font-bold mb-4' }, 'Live Surf Cams'),
    window.React.createElement('p', { className: 'text-slate-600' }, 'Hier komen later livecams van verschillende surfspots.')
  );
}

/* ===== Dropdown component ===== */
function SpotDropdown({ allSpotIds, selectedSpots, toggleSpot, loading }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dropdownRef = window.React.useRef(null);

  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredIds = allSpotIds.filter(id =>
    (getSpotMeta(id).name || id).toLowerCase().includes(query.toLowerCase())
  );

  const allSelected = allSpotIds.length > 0 && selectedSpots.length === allSpotIds.length;

  function toggleAll() {
    if (allSelected) {
      allSpotIds.forEach(id => {
        if (selectedSpots.includes(id)) toggleSpot(id);
      });
    } else {
      allSpotIds.forEach(id => {
        if (!selectedSpots.includes(id)) toggleSpot(id);
      });
    }
  }

  return window.React.createElement('div', { className: 'relative inline-block w-64', ref: dropdownRef },
    window.React.createElement('button', {
      onClick: () => setOpen(!open),
      className: 'w-full flex justify-between items-center rounded-md border border-gray-300 shadow-sm px-3 py-2 bg-white text-sm hover:bg-gray-50'
    }, [
      'Kies surfspots',
      window.React.createElement('svg', { key:'icon', className:'h-5 w-5 ml-2', fill:'none', stroke:'currentColor', viewBox:'0 0 24 24' },
        window.React.createElement('path', { strokeLinecap:'round', strokeLinejoin:'round', strokeWidth:'2', d:'M19 9l-7 7-7-7' })
      )
    ]),
    open && window.React.createElement('div', {
      className: 'absolute mt-2 w-full rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 max-h-80 overflow-y-auto z-20'
    },
      window.React.createElement('div', { className:'p-2 space-y-2' },
        window.React.createElement('input', {
          type:'text', placeholder:'Zoek surfspot…',
          value:query, onChange:e=>setQuery(e.target.value),
          className:'w-full border rounded-md p-1 text-sm'
        }),
        window.React.createElement('label', { className:'flex items-center text-sm font-semibold border-b pb-1 mb-1' },
          window.React.createElement('input', {
            type:'checkbox',
            checked: allSelected,
            onChange: toggleAll,
            className:'mr-2'
          }),
          'Alles'
        ),
        filteredIds.length
          ? filteredIds.map(id =>
              window.React.createElement('label', { key:id, className:'flex items-center text-sm' },
                window.React.createElement('input', {
                  type:'checkbox',
                  checked:selectedSpots.includes(id),
                  onChange:()=>toggleSpot(id),
                  className:'mr-2'
                }),
                getSpotMeta(id).name || id
              )
            )
          : window.React.createElement('div', { className:'text-xs text-slate-500' }, loading ? 'Laden…' : 'Geen spots gevonden')
      )
    )
  );
}

/* ===== Forecast HomePage ===== */
function HomePage() {
  const [data, setData] = useState({});
  const [selectedSpots, setSelectedSpots] = useState([]);
  const [filterBest, setFilterBest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");

  // Dummy sms-data
  const dummySms = {
    conclusion: "Goede surfmomenten vandaag, vooral in Zeeland.",
    notes_height: "Golfhoogte beter in Domburg, elders klein.",
    notes_wind: "Wind ZW 4 bft, wat rommelig.",
    notes_period: "Periode nog kort, betere sets later."
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const d = await loadFromSupabase();
        if (!cancelled) {
          setData(d);
          const allKeys = Object.keys(d || {});
          let initial = allKeys;
          try {
            const saved = localStorage.getItem('fav_spots_v2');
            if (saved) {
              const parsed = JSON.parse(saved);
              initial = parsed.filter(x => allKeys.includes(x));
              if (initial.length === 0) initial = allKeys;
            }
          } catch {}
          setSelectedSpots(initial);
        }
      } catch (e) {
        console.error("Supabase fetch error:", e);
        if (!cancelled) { setErrMsg("Kon data niet laden."); setData({}); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { localStorage.setItem('fav_spots_v2', JSON.stringify(selectedSpots)); } catch {}
  }, [selectedSpots]);

  function toggleSpot(id){
    setSelectedSpots(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  }

  function computeDayAgg(spotId, dayEntry){
    const meta = getSpotMeta(spotId);
    const partsByKey = PART_KEYS.map(k => (dayEntry.parts && dayEntry.parts[k]) ? dayEntry.parts[k] : null);
    const validParts = partsByKey.filter(Boolean);
    const swellValues = validParts.map(p => safeNumber(p.swell_m)).filter(v => v != null);
    const periodValues = validParts.map(p => safeNumber(p.period_s)).filter(v => v != null);
    const windValues = validParts.map(p => safeNumber(p.wind_bft)).filter(v => v != null);

    const swell_avg = swellValues.length ? swellValues.reduce((a, b) => a + b, 0) / swellValues.length : 0;
    const period_avg = periodValues.length ? Math.round(periodValues.reduce((a, b) => a + b, 0) / periodValues.length) : 0;
    const wind_bft_avg = windValues.length ? Math.round(windValues.reduce((a, b) => a + b, 0) / windValues.length) : null;
    const wind_dir =
      dayEntry.parts?.["middag"]?.wind_dir ||
      dayEntry.parts?.["ochtend"]?.wind_dir ||
      dayEntry.parts?.["avond"]?.wind_dir ||
      null;
    const wind_type = computeWindType(meta, wind_dir);
    const score = computeScore({ swell_m: swell_avg, period_s: period_avg, wind_bft: wind_bft_avg, wind_type });
    return {
      date: dayEntry.date,
      parts: dayEntry.parts,
      alert: !!dayEntry.alert,
      swell_m: isFinite(swell_avg) ? +swell_avg.toFixed(2) : null,
      period_s: isFinite(period_avg) ? period_avg : null,
      wind_bft: Number.isFinite(wind_bft_avg) ? wind_bft_avg : null,
      wind_dir: wind_dir || null,
      wind_type: wind_type || null,
      score,
      summary: buildConclusion({ score }),
      sms: dummySms
    };
  }

  function spotsToShow(){
    const allKeys = Object.keys(data || {});
    const active = selectedSpots.length ? allKeys.filter(s => selectedSpots.includes(s)) : allKeys;
    if (!filterBest || !allKeys.length) return active;
    const today = new Date().toISOString().slice(0,10);
    let bestSpot = null, bestScore = -1;
    active.forEach(spotId => {
      const arr = data[spotId] || [];
      const todayEntry = arr.find(d => d.date === today);
      if (!todayEntry) return;
      const agg = computeDayAgg(spotId, todayEntry);
      if (agg.score > bestScore){ bestScore = agg.score; bestSpot = spotId; }
    });
    return bestSpot ? [bestSpot, ...active.filter(s => s !== bestSpot)] : active;
  }

// Drag/swipe horizontaal voor forecast sliders
useEffect(() => {
  // Alleen drag gedrag voor desktop, mobiel gebruikt native swipe
  if (window.innerWidth < 768) return; 

  const sliders = Array.from(document.querySelectorAll('.draggable-slider'));
  if (!sliders.length) return;

  const cleanups = [];
  sliders.forEach(slider => {
    slider.style.touchAction = 'pan-y';
    slider.style.userSelect = 'none';

    let isDown = false;
    let startX = 0;
    let scrollLeft = 0;

    const onDown = (e) => {
      isDown = true;
      startX = e.pageX || e.touches[0].pageX;
      scrollLeft = slider.scrollLeft;
      slider.classList.add('cursor-grabbing');
    };

    const onMove = (e) => {
      if (!isDown) return;
      const x = e.pageX || (e.touches && e.touches[0].pageX);
      const walk = x - startX;
      slider.scrollLeft = scrollLeft - walk;
    };

    const onUp = () => {
      isDown = false;
      slider.classList.remove('cursor-grabbing');
    };

    slider.addEventListener('mousedown', onDown);
    slider.addEventListener('mousemove', onMove);
    slider.addEventListener('mouseup', onUp);
    slider.addEventListener('mouseleave', onUp);

    slider.addEventListener('touchstart', onDown, { passive: true });
    slider.addEventListener('touchmove', onMove, { passive: true });
    slider.addEventListener('touchend', onUp);

    cleanups.push(() => {
      slider.removeEventListener('mousedown', onDown);
      slider.removeEventListener('mousemove', onMove);
      slider.removeEventListener('mouseup', onUp);
      slider.removeEventListener('mouseleave', onUp);
      slider.removeEventListener('touchstart', onDown);
      slider.removeEventListener('touchmove', onMove);
      slider.removeEventListener('touchend', onUp);
    });
  });

  return () => cleanups.forEach(fn => fn());
}, [data, selectedSpots, filterBest]);

  const allSpotIds = Object.keys(data || {});

  return window.React.createElement('div', { className: 'space-y-6 p-6 w-full max-w-full overflow-hidden' },
    window.React.createElement('section', { className: 'bg-slate-50 p-6 rounded-md text-center w-full max-w-full overflow-hidden' },
      window.React.createElement('h1', { className: 'text-xl font-bold mb-1' }, "AI gestuurde surfforecast"),
      window.React.createElement('p', { className: 'italic text-slate-600' }, "Door Job & Jelle")
    ),
    window.React.createElement('section', { className: 'card p-4' },
      window.React.createElement('div', { className: 'mb-2 text-sm text-slate-700' }, 'Selecteer je favoriete spots:'),
      window.React.createElement('div', { className: 'flex flex-col sm:flex-row gap-3' },
        window.React.createElement(SpotDropdown, { allSpotIds, selectedSpots, toggleSpot, loading }),
        window.React.createElement('label', {
          className: 'w-64 flex items-center rounded-md border border-gray-300 shadow-sm px-3 py-2 bg-white text-sm cursor-pointer'
        },
          window.React.createElement('input', {
            type: 'checkbox',
            checked: filterBest,
            onChange: e => setFilterBest(e.target.checked),
            className: 'mr-2'
          }),
          'Toon beste spots'
        )
      )
    ),
    (loading
      ? window.React.createElement('div', { className: 'text-center py-16' }, 'Laden…')
      : spotsToShow().map(spotId => {
          const arr = data[spotId] || [];
          const meta = getSpotMeta(spotId);
          const aggs = arr.map(d => computeDayAgg(spotId, d));
          return window.React.createElement('section', { key: spotId, className: 'card p-4' },
            window.React.createElement('div', { className: 'flex justify-between mb-3' },
              window.React.createElement('div', null,
                window.React.createElement('div', { className: 'text-lg font-medium' }, meta.name || spotId),
                window.React.createElement('div', { className: 'text-xs text-slate-500' }, meta.region || '')
              )
            ),
            window.React.createElement('div', { className: 'overflow-x-auto h-scroll flex gap-4 py-2 draggable-slider' },
              aggs.map(ag => {
                const color = mapScoreToColor(ag.score);
                const sms = ag.sms || {};
                const conclusion = sms.conclusion || ag.summary;

                return window.React.createElement('div', { key: ag.date, className: `min-w-[320px] p-3 card ${color.classDay}` },
                  window.React.createElement('div', { className: 'flex justify-between items-start mb-2' },
                    window.React.createElement('div', null,
                      window.React.createElement('div', { className: 'font-semibold' }, new Date(ag.date).toLocaleDateString('nl-NL', { weekday: 'long' })),
                      window.React.createElement('div', { className: 'text-xs text-slate-500' }, new Date(ag.date).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' }))
                    ),
                    ag.alert ? window.React.createElement('div', { className: 'alert-badge', style: { background: 'var(--accent)' }, title: 'Alert aanwezig' }, '⚠') : null
                  ),
                  window.React.createElement('div', { className: 'mb-3 text-sm text-slate-700' }, conclusion),
                  window.React.createElement('div', { className: 'grid grid-cols-3 gap-3' },
                    PART_KEYS.map(part => {
                      const p = ag.parts?.[part] || {};
                      const windType = computeWindType(meta, p.wind_dir || ag.wind_dir);
                      const partScore = computeScore({
                        swell_m: (p.swell_m ?? ag.swell_m) ?? 0,
                        period_s: (p.period_s ?? ag.period_s) ?? 0,
                        wind_bft: (p.wind_bft ?? ag.wind_bft) ?? 0,
                        wind_type: windType
                      });
                      const partColor = mapScoreToColor(partScore);
                      const windKmh = (p.wind_kmh != null) ? Math.round(p.wind_kmh)
                                    : (p.wind_bft != null ? bftToKmh(p.wind_bft)
                                    : (ag.wind_bft != null ? bftToKmh(ag.wind_bft) : null));

                      return window.React.createElement('div', { key: part, className: `p-3 ${partColor.classPart}` },
                        window.React.createElement('div', { className: 'text-sm font-semibold capitalize mb-1' },
                          PART_LABELS[part] || part
                        ),
                        // Hoogte + tooltip
                        window.React.createElement('div', { className: 'text-xs text-slate-400 flex items-center' }, 'Golfhoogte',
                          sms.notes_height && window.React.createElement('span', { 
                            className: 'relative group ml-1 cursor-pointer text-purple-600 material-icons text-sm'
                          }, 
                            'info',
                            window.React.createElement('span', { 
                              className: 'absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-purple-600 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50'
                            }, sms.notes_height)
                          )
                        ),
                        window.React.createElement('div', { className: 'font-semibold' },
                          (p.swell_m ?? ag.swell_m) != null ? `${((p.swell_m ?? ag.swell_m)).toFixed(1)} m` : '—'
                        ),
                        // Periode + tooltip
                        window.React.createElement('div', { className: 'mt-2 text-xs text-slate-400 flex items-center' }, 'Swell Periode',
                          sms.notes_period && window.React.createElement('span', { 
                            className: 'relative group ml-1 cursor-pointer text-purple-600 material-icons text-sm'
                          }, 
                            'info',
                            window.React.createElement('span', { 
                              className: 'absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-purple-600 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50'
                            }, sms.notes_period)
                          )
                        ),
                        window.React.createElement('div', { className: 'font-semibold' },
                          (p.period_s ?? ag.period_s) != null ? `${(p.period_s ?? ag.period_s)}s` : '—'
                        ),
                        // Wind + tooltip
                        window.React.createElement('div', { className: 'mt-2 text-xs text-slate-400 flex items-center' }, 'Wind',
                          sms.notes_wind && window.React.createElement('span', { 
                            className: 'relative group ml-1 cursor-pointer text-purple-600 material-icons text-sm'
                          }, 
                            'info',
                            window.React.createElement('span', { 
                              className: 'absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block bg-purple-600 text-white text-xs rounded px-2 py-1 whitespace-nowrap z-50'
                            }, sms.notes_wind)
                          )
                        ),
                        window.React.createElement('div', { className: 'font-semibold' },
                          `${normalizeWindDir(p.wind_dir || ag.wind_dir) || '—'}${windKmh ? ` • ${windKmh} km/u` : ''}`
                        )
                      );
                    })
                  )
                );
              })
            )
          );
        })
    )
  );
}

/* ===== App ===== */
function App(){
  const [page, setPage] = useState('home');
  return window.React.createElement('div', { className: 'flex min-h-screen' },
    window.React.createElement(Sidebar, { page, setPage }),
    window.React.createElement('main', { className: 'flex-1 pb-12 md:pb-0 w-full max-w-full overflow-x-hidden' },
      page === 'home'
        ? window.React.createElement(HomePage)
        : window.React.createElement(CamsPage)
    ),
    window.React.createElement(BottomNav, { page, setPage })
  );
}

window.ReactDOM.createRoot(document.getElementById('app')).render(window.React.createElement(App));
