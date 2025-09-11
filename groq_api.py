import os
import json
from groq import Groq
from dotenv import load_dotenv

load_dotenv()

# === Groq ===========================================================
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
client = Groq(api_key=GROQ_API_KEY)

def groq_process_text(text):
    prompt = f"""Je krijgt hieronder een informeel geschreven surfweerbericht in het Nederlands.
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
    
    Stap 4 — Datum bepalen
    - Normaal gebruik je uitsluitend informatie die letterlijk in de tekst staat.
    - ENIGE UITZONDERING: als er géén expliciete datum wordt genoemd maar wél een dag (bijv. "maandag"),
      bepaal dan de datum als de eerstvolgende kalenderdatum met die dag, relatief ten opzichte van
      vandaag (op uitvoeringstijdstip) in tijdzone Europe/Amsterdam.
      - Voorbeeld (gegeven dat vandaag 2025-08-14 is): "maandag" ⇒ 2025-08-18.
      - Dagnamen (NL): maandag, dinsdag, woensdag, donderdag, vrijdag, zaterdag, zondag.
    - Noteer de datum in ISO-formaat YYYY-MM-DD.
    
    Stap 5 — Vul de JSON-array
    Maak voor elke unieke combinatie van Datum + Locatie + Dagdeel een JSON-object met exact deze velden, en in exact deze volgorde:
    1. "Datum" — ISO-formaat YYYY-MM-DD (expliciet genoemd of afgeleid via Stap 4)
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
    - Gebruik uitsluitend informatie die letterlijk in de tekst staat, met uitzondering van de datum-afleiding in Stap 4.
    - Geen verdere aannames of interpretaties toevoegen.
    - Als een veld niet wordt genoemd: waarde = null.
    - Splits records per locatie én per dagdeel.
    - Neem tekstwaarden exact over, inclusief afkortingen, spaties en leestekens.
    - Voeg geen extra context, uitleg of mening toe.
    - Output moet uitsluitend een JSON-array zijn met bovenstaande velden in exact deze volgorde.

    **Stap 6 — Validatie en correctie**
    - Controleer vóór het teruggeven van de output of:
      1. Alle vereiste velden aanwezig zijn in elk object.
      2. De volgorde van de velden exact gelijk is aan de volgorde die vermeld staat in Stap 5.
      3. Er geen extra velden aanwezig zijn.
      4. De output een geldige JSON-array is.
    - Indien één van deze checks faalt, corrigeer dan de output automatisch zodat deze volledig voldoet.
    
    Uitvoervereiste:
    - Geef uitsluitend de JSON-array terug.
    - Voeg geen inleidende tekst, verklaringen, tussenstappen of extra output toe. Alleen de array.
    
    Uitvoer:
    [JSON-array met gestructureerde gegevens]

    Invoer:
    <{text}>
    """
    
    chat_completion = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.3-70b-versatile",
        stream=False,
        temperature=0.5,
    )
    # verwacht JSON-array in tekst; parse naar Python object:
    content = chat_completion.choices[0].message.content
    try:
        return json.loads(content)  # -> JSON (geschikt voor jsonb-kolom)
    except json.JSONDecodeError:
        # fallback: sla als text-string op, of raise
        return content
