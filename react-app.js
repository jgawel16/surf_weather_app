// react-app.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const RPC_NAME = "get_latest_sms_public";

const { useState, useEffect } = window.React;

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
const DEFAULT_META = { name: null, region: null, shoreBearing: 260 };
const getSpotMeta = (id) => (SPOTS_META[String(id||"").toLowerCase()] || { name: id, ...DEFAULT_META });

/* ===== Utils ===== */
function degDiff(a,b){ let d = Math.abs(a-b) % 360; if(d>180) d = 360 - d; return d; }
function parseWindDirString(dir){ if(!dir) return null; const t = String(dir).split(/[\/\s,]+/)[0].toUpperCase(); return { 'N':0,'NO':45,'O':90,'ZO':135,'Z':180,'ZW':225,'W':270,'NW':315 }[t] ?? null; }
function computeWindType(spotMeta, windDirStr){
  const deg = parseWindDirString(windDirStr);
  if (deg === null) return 'unknown';
  const diff = degDiff(deg, spotMeta.shoreBearing ?? 260);
  if (diff <= 45) return 'onshore';
  if (Math.abs(diff - 180) <= 45) return 'offshore';
  return 'crossshore';
}
function bftToKmh(bft){ if(bft == null || isNaN(bft)) return null; return Math.round(3.0096 * Math.pow(Number(bft), 1.5)); }
function computeScore({swell_m, period_s, wind_bft, wind_type}){
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
  if (!row || row.body_processed == null) return {};
  const payload = (typeof row.body_processed === "string") ? JSON.parse(row.body_processed) : row.body_processed;
  Object.keys(payload).forEach(k => payload[k].sort((a,b) => (a.date||"").localeCompare(b.date||"")));
  return payload;
}

/* ===== Dropdown component ===== */
function SpotDropdown({ allSpotIds, selectedSpots, toggleSpot, loading }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filteredIds = allSpotIds.filter(id =>
    (getSpotMeta(id).name || id).toLowerCase().includes(query.toLowerCase())
  );

  function clearAll() {
    selectedSpots.forEach(id => toggleSpot(id));
  }

  return window.React.createElement('div', { className: 'relative inline-block w-64' },
    // knop
    window.React.createElement('button', {
      onClick: () => setOpen(!open),
      className: 'w-full flex justify-between items-center rounded-md border border-gray-300 shadow-sm px-3 py-2 bg-white text-sm hover:bg-gray-50'
    }, [
      'Kies surfspots',
      window.React.createElement('svg', { key:'icon', className:'h-5 w-5 ml-2', fill:'none', stroke:'currentColor', viewBox:'0 0 24 24' },
        window.React.createElement('path', { strokeLinecap:'round', strokeLinejoin:'round', strokeWidth:'2', d:'M19 9l-7 7-7-7' })
      )
    ]),
    // menu
    open && window.React.createElement('div', {
      className: 'absolute mt-2 w-full rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 max-h-80 overflow-y-auto z-20'
    },
      window.React.createElement('div', { className:'p-2 space-y-2' },
        window.React.createElement('input', {
          type:'text', placeholder:'Zoek surfspot…',
          value:query, onChange:e=>setQuery(e.target.value),
          className:'w-full border rounded-md p-1 text-sm'
        }),
        window.React.createElement('button', {
          onClick: clearAll,
          className:'w-full text-left text-xs text-red-500 hover:underline'
        }, 'Alles uitvinken'),
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

/* ===== App ===== */
function App(){
  const [data, setData] = useState({});
  const [selectedSpots, setSelectedSpots] = useState([]);
  const [filterBest, setFilterBest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");

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

  // toggle
  function toggleSpot(id){
    setSelectedSpots(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  }

  const allSpotIds = Object.keys(data || {});

  return window.React.createElement('div', { className: 'space-y-6' },
    // header
    window.React.createElement('header', { className: 'flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4' },
      window.React.createElement('div', { className: 'flex items-center gap-4' },
        window.React.createElement('img', { src: './Ingezoomd logo.png', alt: 'Logo', className: 'w-12 h-16 object-contain' }),
        window.React.createElement('div', null,
          window.React.createElement('h1', { className: 'text-2xl font-medium' }, 'Surf Forecast'),
          window.React.createElement('div', { className: 'text-sm text-slate-600' }, errMsg ? `Fout: ${errMsg}` : 'AI gestuurde surfdata, recht op je beeldscherm!')
        )
      ),
      window.React.createElement('div', { className: 'flex items-center gap-2' },
        window.React.createElement('label', { className: 'text-sm text-slate-600' }, 'Toon beste spots'),
        window.React.createElement('input', { type: 'checkbox', checked: filterBest, onChange: e => setFilterBest(e.target.checked) })
      )
    ),

    // favorieten → nu dropdown
    window.React.createElement('section', { className: 'card p-4' },
      window.React.createElement('div', { className: 'mb-2 text-sm text-slate-700' }, 'Selecteer je favoriete spots:'),
      window.React.createElement(SpotDropdown, { allSpotIds, selectedSpots, toggleSpot, loading })
    ),

    // content (zelfde als jouw code, niet opnieuw helemaal uitgeschreven ivm lengte)
    // ...
  );
}

window.ReactDOM.createRoot(document.getElementById('app')).render(window.React.createElement(App));
