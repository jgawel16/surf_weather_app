import os
from dotenv import load_dotenv
import requests
from groq import Groq


# Load environment variables
load_dotenv()

# Supabase config
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_API_KEY = os.getenv("SUPABASE_API_KEY")
SUPABASE_API_KEY_SERVICE_ROLE = os.getenv("SUPABASE_API_KEY_SERVICE_ROLE")

TABLE_NAME = "sms_messages"

headers = {
    "apikey": SUPABASE_API_KEY_SERVICE_ROLE,
    "Authorization": f"Bearer {SUPABASE_API_KEY_SERVICE_ROLE}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

params = {
        "select": "id,body,body_processed",
        "body_processed": "is.null"
    }

# Groq config
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
client = Groq(
    api_key=os.environ.get("GROQ_API_KEY"),
)


# Import data from Supabase
def get_rows():
    url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}"
    response = requests.get(url, headers=headers, params=params)
    response.raise_for_status()
    
    if response.status_code != 200:
        raise Exception(f"Failed to fetch rows: {response.status_code} - {response.text}")

    return response.json()

# Process sms text
def groq_process_text(text):
    prompt=f"Hieronder staat een ietswat cryptisch geschreven bericht over de voorspelling van de condities voor golfsurfen in Nederland. Vat dit bericht samen in duidelijk Nederlands waarbij je een beknopte voorspelling geeft. Houd je hierbij strict aan de volgende structuur: zet de locaties onder elkaar, en maak een voorspelling per dag, en per tijdstip. Gebruik hiervoor alleen de informatie in het bericht, vul niets  of aan, en doe absoluut geen aannames. Hier is het bericht: <{text}>"
    chat_completion = client.chat.completions.create(
    messages=[
        {
            "role": "user",
            "content": prompt,
        }
    ],
    model="llama-3.3-70b-versatile",
    stream=False,
    temperature=0.5,
    )

    return chat_completion.choices[0].message.content

# Update body_processed in Supabase table 
def update_row(row_id, new_value):
    url = f"{SUPABASE_URL}/rest/v1/{TABLE_NAME}?id=eq.{row_id}"
    payload = {'body_processed': new_value}
    r = requests.patch(url, json=payload, headers=headers)
    r.raise_for_status()
    return r.json()

# Pipeline
def create_body_processed():
    new_records = get_rows()
    
    for row in new_records:
        row["body_processed"] = groq_process_text(row["body"])
        update_row(row["id"], row["body_processed"])
        print(f"Updated row {row['id']}: {row['body_processed']}")
