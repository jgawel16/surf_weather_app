// react-app.js
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

// Supabase client (keys blijven in config.js)
const supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
const RPC_NAME = "get_latest_sms_public";

// React globals uit index.html
const { useState, useEffect } = window.React;

/* ===== Spot-metadata (shoreBearing) =====
 * keys exact zoals in jouw JSON (lowercase). Onbekend -> fallback 260°
 */
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

/* ===== Kompasrichtingen ===== */
const COMPASS_TO_DEG = {
  'N':0,'NNO':22.5,'NO':45,'ONO':67.5,'O':90,'OZO':112.5,'ZO':135,'ZZO':157.5,'Z':180,'ZZW':202.5,'ZW':225,'WZW':247.5,'W':270,'WNW':292.5,'NW':315,'NNW':337.5,
  // internationale varianten
  'NNE':22.5,'ENE':67.5,'ESE':112.5,'SSE':157.5,'SSW':202.5,'WSW':247.5,'WNW':292.5,'NNW':337.5
};

/* ===== Utils ===== */
function degDiff(a,b){ let d = Math.abs(a-b) % 360; if(d>180) d = 360 - d; return d; }
function parseWindDirString(dir){ if(!dir) return null; const t = String(dir).split(/[\/\s,]+/)[0].toUpperCase(); return COMPASS_TO_DEG[t] ?? null; }
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

/* ===== Supabase RPC (UI-model kant-en-klaar) ===== */
async function loadFromSupabase(){
  const { data, error } = await supa.rpc(RPC_NAME);
  if (error) throw error;
  const row = Array.isArray(data) && data.length ? data[0] : null;
  if (!row || row.body_processed == null) return {};
  const payload = (typeof row.body_processed === "string") ? JSON.parse(row.body_processed) : row.body_processed;
  Object.keys(payload).forEach(k => payload[k].sort((a,b) => (a.date||"").localeCompare(b.date||"")));
  return payload; // { spotId: [ {date, parts, alert?}, ... ], ... }
}

/* ===== React App ===== */
function App(){
  const [data, setData] = useState({});         // { spotId: [ {date, parts, alert?}, ... ] }
  const [selectedSpots, setSelectedSpots] = useState([]); // keys uit data
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

  // drag-to-scroll
  useEffect(() => {
    const sliders = Array.from(document.querySelectorAll('.draggable-slider'));
    const list = [];
    sliders.forEach(slider => {
      let isDown = false, startX = 0, scrollLeft = 0;
      const onMouseDown = (e) => { isDown = true; slider.classList.add('cursor-grabbing'); startX = e.pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft; };
      const onMouseLeave = () => { isDown = false; slider.classList.remove('cursor-grabbing'); };
      const onMouseUp = () => { isDown = false; slider.classList.remove('cursor-grabbing'); };
      const onMouseMove = (e) => { if(!isDown) return; e.preventDefault(); const x = e.pageX - slider.offsetLeft; const walk = (x - startX) * 1.2; slider.scrollLeft = scrollLeft - walk; };
      const onTouchStart = (e) => { isDown = true; slider.classList.add('cursor-grabbing'); startX = e.touches[0].pageX - slider.offsetLeft; scrollLeft = slider.scrollLeft; };
      const onTouchMove = (e) => { if(!isDown) return; const x = e.touches[0].pageX - slider.offsetLeft; const walk = (x - startX) * 1.2; slider.scrollLeft = scrollLeft - walk; };
      const onTouchEnd = () => { isDown = false; slider.classList.remove('cursor-grabbing'); };
      slider.addEventListener('mousedown', onMouseDown);
      slider.addEventListener('mouseleave', onMouseLeave);
      slider.addEventListener('mouseup', onMouseUp);
      slider.addEventListener('mousemove', onMouseMove);
      slider.addEventListener('touchstart', onTouchStart, { passive: true });
      slider.addEventListener('touchmove', onTouchMove, { passive: true });
      slider.addEventListener('touchend', onTouchEnd);
      list.push({ slider, onMouseDown, onMouseLeave, onMouseUp, onMouseMove, onTouchStart, onTouchMove, onTouchEnd });
    });
    return () => {
      list.forEach(l => {
        l.slider.removeEventListener('mousedown', l.onMouseDown);
        l.slider.removeEventListener('mouseleave', l.onMouseLeave);
        l.slider.removeEventListener('mouseup', l.onMouseUp);
        l.slider.removeEventListener('mousemove', l.onMouseMove);
        l.slider.removeEventListener('touchstart', l.onTouchStart);
        l.slider.removeEventListener('touchmove', l.onTouchMove);
        l.slider.removeEventListener('touchend', l.onTouchEnd);
      });
    };
  }, [data, selectedSpots, filterBest]);

  function toggleSpot(id){
    setSelectedSpots(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  }

  function computeDayAgg(spotId, dayEntry){
    const meta = getSpotMeta(spotId);
    const partsArr = ['morning','midday','evening'].map(k => (dayEntry.parts && dayEntry.parts[k]) ? dayEntry.parts[k] : {swell_m:0,period_s:0,wind_bft:0,wind_dir:null});
    const swell_avg = partsArr.reduce((a,p) => a + (p.swell_m||0), 0) / partsArr.length;
    const period_avg = Math.round(partsArr.reduce((a,p) => a + (p.period_s||0), 0) / partsArr.length);
    const wind_bft_avg = Math.round(partsArr.reduce((a,p) => a + (p.wind_bft||0), 0) / partsArr.length);
    const wind_dir = partsArr[1]?.wind_dir || partsArr[0]?.wind_dir || partsArr[2]?.wind_dir || null;
    const wind_type = computeWindType(meta, wind_dir);
    const score = computeScore({ swell_m: swell_avg, period_s: period_avg, wind_bft: wind_bft_avg, wind_type });
    return {
      date: dayEntry.date,
      parts: dayEntry.parts,
      alert: !!dayEntry.alert,
      swell_m: isFinite(swell_avg) ? +swell_avg.toFixed(2) : null,
      period_s: isFinite(period_avg) ? period_avg : null,
      wind_bft: isFinite(wind_bft_avg) ? wind_bft_avg : null,
      wind_dir,
      wind_type,
      score,
      summary: buildConclusion({ score })
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

    // favorieten
    window.React.createElement('section', { className: 'card p-4' },
      window.React.createElement('div', { className: 'mb-2 text-sm text-slate-700' }, 'Selecteer je favoriete spots:'),
      window.React.createElement('div', { className: 'flex flex-wrap gap-3' },
        allSpotIds.length
          ? allSpotIds.map(id =>
              window.React.createElement('label', { key: id, className: 'inline-flex items-center gap-2 text-sm' },
                window.React.createElement('input', {
                  type: 'checkbox',
                  checked: selectedSpots.includes(id),
                  onChange: () => toggleSpot(id)
                }),
                window.React.createElement('span', null, getSpotMeta(id).name || id)
              )
            )
          : window.React.createElement('div', { className: 'text-sm text-slate-500' }, loading ? 'Laden…' : 'Geen spots gevonden')
      )
    ),

    // content
    loading
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
                return window.React.createElement('div', { key: ag.date, className: `min-w-[320px] p-3 card ${color.classDay}` },
                  window.React.createElement('div', { className: 'flex justify-between items-start mb-2' },
                    window.React.createElement('div', null,
                      window.React.createElement('div', { className: 'font-semibold' }, new Date(ag.date).toLocaleDateString('nl-NL', { weekday: 'long' })),
                      window.React.createElement('div', { className: 'text-xs text-slate-500' }, new Date(ag.date).toLocaleDateString('nl-NL', { day: '2-digit', month: 'short' }))
                    ),
                    ag.alert ? window.React.createElement('div', { className: 'alert-badge', style: { background: 'var(--accent)' }, title: 'Alert aanwezig' }, '⚠') : null
                  ),
                  window.React.createElement('div', { className: 'mb-3 text-sm text-slate-700' }, ag.summary),
                  window.React.createElement('div', { className: 'grid grid-cols-3 gap-3' },
                    ['morning','midday','evening'].map(part => {
                      const p = (arr.find(d => d.date === ag.date) || {}).parts?.[part] || {};
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
                          part === 'midday' ? 'Middag' : part === 'morning' ? 'Ochtend' : 'Avond'
                        ),
                        window.React.createElement('div', { className: 'text-xs text-slate-400' }, 'Golfhoogte'),
                        window.React.createElement('div', { className: 'font-semibold' },
                          (p.swell_m ?? ag.swell_m) != null ? `${((p.swell_m ?? ag.swell_m)).toFixed(1)} m` : '—'
                        ),
                        window.React.createElement('div', { className: 'mt-2 text-xs text-slate-400' }, 'Swell Periode'),
                        window.React.createElement('div', { className: 'font-semibold' },
                          (p.period_s ?? ag.period_s) != null ? `${(p.period_s ?? ag.period_s)}s` : '—'
                        ),
                        window.React.createElement('div', { className: 'mt-2 text-xs text-slate-400' }, 'Wind'),
                        window.React.createElement('div', { className: 'font-semibold' },
                          `${p.wind_dir || ag.wind_dir || '—'}${windKmh ? ` • ${windKmh} km/u` : ''}`
                        )
                      );
                    })
                  )
                );
              })
            )
          );
        })
  );
}

window.ReactDOM.createRoot(document.getElementById('app')).render(window.React.createElement(App));
