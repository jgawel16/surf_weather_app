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
    prompt = f"""
    Je krijgt hieronder een informeel geschreven surfweerbericht in het Nederlands. 
    De tekst bevat afkortingen, spreektaal en losse zinnen, maar bevat belangrijke informatie 
    over surfcondities op specifieke locaties, dagen en dagdelen in Nederland en België.
    
    Je taak: Zet deze informatie om naar een gestructureerde JSON-array met de opgegeven velden, 
    maar voordat je de JSON maakt, doorloop je eerst een bundelstap per locatie zodat informatie 
    op verschillende niveaus (regio ↔ specifieke spot) correct wordt gecombineerd.
    
    Stap 1 — Uitspraken identificeren
    - Splits de tekst in losse uitspraken die concrete gegevens bevatten over surfcondities 
      (wind, tij, golfhoogte, clean, tijden, swell, etc.).
    - Noteer bij elke uitspraak: Locatie(s), Dag, Dagdeel (indien genoemd), en de exacte parameters 
      zoals in de tekst.
    - Behoud de tekst exact zoals vermeld; maak geen interpretaties.
    
    Stap 2 — Locatie-hiërarchie toepassen
    - Gebruik een vooraf bekende lijst met hoofdlocaties en hun sublocaties. Bijvoorbeeld:
      - Noord-Holland: Wijk aan Zee, IJmuiden, Zandvoort, Noordwijk, Wassenaar
      - Zuid-Holland: Hoek van Holland, Scheveningen, Kijkduin, Ouddorp, Maasvlakte, Zandmotor zuid
      - Zeeland: Domburg, Cadzand
      - Wadden: Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog
      - België: Belgische spots
    - Als een uitspraak over een hoofdlocatie gaat, koppel deze ook aan alle sublocaties, tenzij de 
      tekst expliciet zegt dat de uitspraak niet voor een sublocatie geldt.
    
    Stap 3 — Bundelen per locatie
    - Combineer alle uitspraken die bij dezelfde locatie horen.
    - Algemene uitspraken gelden als basis; specifieke (dagdeel/tijd) uitspraken vullen deze aan.
    - Tegenstrijdige uitspraken noteer je in aparte records (met verschillend dagdeel of tijd).
    
    Stap 4 — Vul de JSON-array
    Maak voor elke unieke combinatie van Datum + Locatie + Dagdeel een JSON-object met exact deze velden in deze volgorde:
    1. "Datum" — ISO-formaat YYYY-MM-DD (alleen invullen als expliciet genoemd of ondubbelzinnig af te leiden)
    2. "Dag" — bijvoorbeeld "Dinsdag", "Woensdag"
    3. "Locatie" — exacte naam uit de tekst (of sublocatie volgens hiërarchie)
    4. "Dagdeel" — bijvoorbeeld "Ochtend", "Middag", "Avond" (alleen als expliciet genoemd)
    5. "Wind" — exacte waarde zoals in de tekst, inclusief bft en tekens
    6. "Wind richting" — exacte richting zoals in de tekst
    7. "Getij " — exacte term zoals in de tekst
    8. "Getij score" — bijvoorbeeld "Goed", "Medium"
    9. "Golf hoogte" — exact zoals vermeld, bijv. "1-1,5m", "flat", "weinig", "heuphoogte"
    10. "Clean" — "Ja", "Nee", of leeg als niet expliciet benoemd
    11. "Swell" — exact zoals vermeld, bijv. "2m"
    12. "Periode" — exact zoals vermeld
    13. "Gaan Pro" — exacte tekst over aanbevolen tijden/condities voor ervaren surfers
    14. "Gaan beginner" — idem voor beginners
    
    Regels:
    - Gebruik uitsluitend informatie die letterlijk in de tekst staat.
    - Geen aannames of interpretaties toevoegen.
    - Als een veld niet wordt genoemd: waarde = null.
    - Splits records per locatie én per dagdeel.
    - Neem tekstwaarden exact over, inclusief afkortingen, spaties en leestekens.
    - Voeg geen extra context, uitleg of mening toe.
    - Output moet uitsluitend een JSON-array zijn met bovenstaande velden in exact deze volgorde.
    
    Invoer:
    <{text}>
    
    Uitvoer:
    [JSON-array met gestructureerde gegevens]
    """
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
def main():
    new_records = get_rows()
    
    for row in new_records:
        row["body_processed"] = groq_process_text(row["body"])
        update_row(row["id"], row["body_processed"])
        print(f"Updated row {row['id']}: {row['body_processed']}")

if __name__ == "__main__":
    main()
