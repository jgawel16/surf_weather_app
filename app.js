import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY, AUTO_REFRESH_MINUTES } from "./config.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: false },
});

const $out = document.querySelector("#out");
const $status = document.querySelector("#status");
const $refresh = document.querySelector("#refresh");

function setStatus(msg, isError = false) {
  $status.textContent = msg;
  $status.className = "status" + (isError ? " error" : "");
}

async function loadLatest() {
  try {
    setStatus("Laden…");
    const { data, error } = await supabase.rpc("get_latest_sms");
    if (error) throw error;

    const row = Array.isArray(data) && data.length ? data[0] : null;
    $out.value = row?.body_processed ?? "(leeg)";
    const ts = row?.timestamp ? new Date(row.timestamp).toLocaleString() : "onbekend";
    setStatus(`Laatste update: ${ts}`);
  } catch (e) {
    console.error(e);
    // Hint geven als RPC nog niet bestaat of privileges ontbreken
    const hint = e?.message?.toLowerCase().includes("function get_latest_sms")
      ? " (Bestaat de functie en heeft 'anon' EXECUTE?)"
      : "";
    setStatus(`Fout: ${e.message}${hint}`, true);
  }
}

$refresh.addEventListener("click", loadLatest);
loadLatest();

if (AUTO_REFRESH_MINUTES && Number(AUTO_REFRESH_MINUTES) > 0) {
  setInterval(loadLatest, Number(AUTO_REFRESH_MINUTES) * 60 * 1000);
}
