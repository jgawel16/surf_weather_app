// react-app.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const RPC_NAME = "get_latest_sms_public";

const { useState, useEffect } = window.React;

/* ===== Spot metadata (shoreBearing) ===== */
const SPOTS_META = {
  "scheveningen": { name: "Scheveningen", region: "Z-H", shoreBearing: 260 },
  // ... (rest exact zoals jouw originele code)
};
const DEFAULT_META = { name: null, region: null, shoreBearing: 260 };
const getSpotMeta = (id) => (SPOTS_META[String(id||"").toLowerCase()] || { name: id, ...DEFAULT_META });

/* ===== Utils (idem als jouw code) ===== */
function degDiff(a,b){ let d = Math.abs(a-b) % 360; if(d>180) d = 360 - d; return d; }
// ... (alle andere functies uit jouw code ongewijzigd)

/* ===== Supabase fetch (idem) ===== */
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
    allSpotIds.forEach(id => {
      if (selectedSpots.includes(id)) toggleSpot(id);
    });
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
        // zoekveld
        window.React.createElement('input', {
          type:'text', placeholder:'Zoek surfspot…',
          value:query, onChange:e=>setQuery(e.target.value),
          className:'w-full border rounded-md p-1 text-sm'
        }),
        // alles uitvinken
        window.React.createElement('button', {
          onClick: clearAll,
          className:'w-full text-left text-xs text-red-500 hover:underline'
        }, 'Alles uitvinken'),
        // lijst
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

/* ===== App (aangepast favorieten-sectie) ===== */
function App(){
  const [data, setData] = useState({});
  const [selectedSpots, setSelectedSpots] = useState([]);
  const [filterBest, setFilterBest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errMsg, setErrMsg] = useState("");

  useEffect(() => { /* fetch supabase, zelfde als jouw code */ }, []);
  useEffect(() => { /* localStorage opslaan, zelfde als jouw code */ }, [selectedSpots]);
  useEffect(() => { /* drag scroll, zelfde als jouw code */ }, [data, selectedSpots, filterBest]);

  function toggleSpot(id){
    setSelectedSpots(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  }

  // ... computeDayAgg, spotsToShow etc. (idem als jouw code)

  const allSpotIds = Object.keys(data || {});

  return window.React.createElement('div', { className: 'space-y-6' },
    // header (zelfde)
    // ...
    // vervang favorieten sectie
    window.React.createElement('section', { className:'card p-4' },
      window.React.createElement('div', { className:'mb-2 text-sm text-slate-700' }, 'Selecteer je favoriete spots:'),
      window.React.createElement(SpotDropdown, { allSpotIds, selectedSpots, toggleSpot, loading })
    ),
    // content (zelfde als jouw code)
  );
}

window.ReactDOM.createRoot(document.getElementById('app')).render(window.React.createElement(App));
