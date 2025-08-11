import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTO_REFRESH_MINUTES } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const $cards = document.querySelector("#cards");
const $status = document.querySelector("#status");
const $refresh = document.querySelector("#refresh");
const $tgBegin = document.querySelector("#tg-beginner");
const $tgPro = document.querySelector("#tg-pro");

// (UI only) toggle styling
[$tgBegin, $tgPro].forEach(btn => {
  btn.addEventListener("click", () => {
    $tgBegin.classList.toggle("active", btn === $tgBegin);
    $tgPro.classList.toggle("active", btn === $tgPro);
  });
});

function setStatus(msg, isError=false){
  $status.textContent = msg;
  $status.className = "status" + (isError ? " error" : "");
}

function makeCard({ timestamp, body_processed }){
  // We hebben één kaart, met placeholders voor score/golf/periode/wind
  const card = document.createElement("article");
  card.className = "card";
  card.innerHTML = `
    <div class="card-hd" role="button" aria-expanded="false">
      <div class="loc">
        <span>Laatste bericht</span>
        <span class="dt">• ${timestamp ? new Date(timestamp).toLocaleString() : "onbekend"}</span>
      </div>
      <div class="score">—/10</div>
      <div class="height">—</div>
      <div class="period">—</div>
      <div class="wind"><span class="chip">—</span></div>
    </div>
    <div class="card-bd"><pre>${(body_processed ?? "").trim() || "(leeg)"}</pre></div>
  `;

  // accordion gedrag
  const hd = card.querySelector(".card-hd");
  hd.addEventListener("click", () => {
    const isOpen = card.classList.toggle("open");
    hd.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  return card;
}

async function loadLatest(){
  try{
    setStatus("Laden…");
    const { data, error } = await supabase.rpc("get_latest_sms"); // returns 1 row
    if (error) throw error;

    const row = Array.isArray(data) && data.length ? data[0] : null;

    $cards.innerHTML = "";
    $cards.appendChild(makeCard({
      timestamp: row?.timestamp ?? null,
      body_processed: row?.body_processed ?? ""
    }));

    setStatus(`Laatste update: ${row?.timestamp ? new Date(row.timestamp).toLocaleTimeString() : "onbekend"}`);
  }catch(e){
    console.error(e);
    const hint = (e?.message || "").toLowerCase().includes("get_latest_sms")
      ? " (Bestaat de functie en heeft 'anon' EXECUTE?)"
      : "";
    setStatus(`Fout: ${e.message}${hint}`, true);
  }
}

$refresh.addEventListener("click", loadLatest);
loadLatest();

if (AUTO_REFRESH_MINUTES && Number(AUTO_REFRESH_MINUTES) > 0){
  setInterval(loadLatest, Number(AUTO_REFRESH_MINUTES) * 60 * 1000);
}
