import os
import json
import requests
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL").rstrip("/")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_EMAIL = os.getenv("SUPABASE_EMAIL")
SUPABASE_PASSWORD = os.getenv("SUPABASE_PASSWORD")

# === Auth: access token ophalen (machine user) =====================
def get_access_token():
    url = f"{SUPABASE_URL}/auth/v1/token?grant_type=password"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
    }
    payload = {"email": SUPABASE_EMAIL, "password": SUPABASE_PASSWORD}
    r = requests.post(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()["access_token"]

# === RPC wrappers ===================================================
def rpc_get_unprocessed(limit=10, access_token=None):
    url = f"{SUPABASE_URL}/rest/v1/rpc/get_unprocessed_sms"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    payload = {"p_limit": limit}
    r = requests.post(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()  # [{id, body}, ...]

def rpc_set_body_processed(row_id, value, access_token=None, as_text=False):
    fn = "set_body_processed_text" if as_text else "set_body_processed"
    url = f"{SUPABASE_URL}/rest/v1/rpc/{fn}"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    # jsonb: p_value = JSON; text: p_value = string
    payload = {"p_id": row_id, "p_value": value if not as_text else json.dumps(value, ensure_ascii=False)}
    r = requests.post(url, headers=headers, json=payload, timeout=60)
    r.raise_for_status()
    # RPC returns no body (void)
    return True

def rpc_get_empty_meteo(limit=10, access_token=None):
    url = f"{SUPABASE_URL}/rest/v1/rpc/get_empty_meteo"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    payload = {"p_limit": limit}
    r = requests.post(url, headers=headers, json=payload, timeout=30)
    r.raise_for_status()
    return r.json()  # [{id, body}, ...]

def rpc_set_openmeteo(row_id, value, access_token=None):
    url = f"{SUPABASE_URL}/rest/v1/rpc/set_openmeteo"
    headers = {
        "apikey": SUPABASE_ANON_KEY,
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
    }
    # jsonb: p_value = JSON; text: p_value = string
    payload = {"p_id": row_id, "p_value": value}
    r = requests.post(url, headers=headers, json=payload, timeout=60)
    r.raise_for_status()
    # RPC returns no body (void)
    return True