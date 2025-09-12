# groq_api.py
import os
import re
import json
from groq import Groq

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
client = Groq(api_key=GROQ_API_KEY)

def _extract_json_object(text: str) -> str:
    """
    Verwijdert eventuele ```json ... ``` fences en knipt substring van eerste '{' tot laatste '}'.
    """
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.IGNORECASE | re.DOTALL).strip()
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Kon geen JSON-object vinden in modeloutput.")
    return s[start:end+1]

def groq_process_text(text):
    # BELANGRIJK: alle letterlijke accolades in het voorbeeld hieronder zijn gedubbeld {{ }}
    
    prompt="""Je krijgt hieronder een informeel geschreven surfweerbericht in het Nederlands. 
    De tekst bevat afkortingen, spreektaal en losse zinnen, maar bevat belangrijke informatie
    over surfcondities op specifieke locaties, dagen en dagdelen in Nederland en België.
    
    Je taak: Zet deze informatie om naar een gestructureerd JSON-object met de opgegeven velden,
    maar voordat je de JSON maakt, doorloop je eerst bundelstappen zodat informatie
    op verschillende niveaus (regio ↔ specifieke spot, hele dag ↔ dagdelen) correct wordt gecombineerd.
    
    Stap 1 — Uitspraken identificeren
    - Splits de tekst in losse uitspraken die concrete gegevens bevatten over surfcondities
      (wind, tij, golfhoogte, clean, tijden, swell, etc.).
    - Noteer bij elke uitspraak: Locatie(s), Dag, Dagdeel (indien genoemd), en de exacte parameters
      zoals in de tekst.
    - Behoud de tekst exact zoals vermeld; maak geen interpretaties.
    
    Stap 2 — Locatie-bepaling
    2.1 Gebruik uitsluitend deze lijst met plaatsnamen als eindpunten:
    Domburg, Cadzand, Hoek van Holland, Kijkduin, Ter Heijde, Scheveningen, Katwijk, Wassenaar, Ouddorp, Maasvlakte, Zandmotor zuid, Wijk aan Zee, IJmuiden, Egmond, Bergen, Petten, Noordwijk, Zandvoort, Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog, De Panne, Middelkerke, Oostende, Zeebrugge, Knokke-Heist.
    
    → Elke uitspraak uit de tekst moet uiteindelijk aan minstens één van deze plaatsnamen gekoppeld worden.  
    → Alle 27 plaatsnamen MOETEN voorkomen in de output. Als een plaatsnaam nergens voorkomt en ook niet via hiërarchie gekoppeld kan worden, vul daar een record met `null` waarden in.
    
    2.2 Normaliseer varianten en schrijfwijzen naar de juiste plaatsnaam:
    - “HvH”, “hvh”, “hoek vh” → “Hoek van Holland”
    - “Schev”, “schev n”, “scheveningen noord” → “Scheveningen”
    - “wijk”, “wijk aan” → “Wijk aan Zee”
    - “zvoort” → “Zandvoort”
    - “nwijk” → “Noordwijk”
    - “oudorp” → “Ouddorp”
    - “zandmotor” (zonder toevoeging) → “Zandmotor zuid”
    Enz. (altijd naar de exacte schrijfwijze uit de lijst).
    
    2.3 Hiërarchie voor mapping:
    Als een uitspraak een hoger niveau noemt (bijv. “Zeeland”, “Z-H”, “Noord-Holland”, “België”, “Wadden”, of “Nederland algemeen”), dan koppel die info automatisch aan alle bijbehorende plaatsnamen:
    - Zeeland → Domburg, Cadzand
    - Zuid-Holland / Z-H → Hoek van Holland, Kijkduin, Ter Heijde, Scheveningen, Katwijk, Wassenaar, Ouddorp, Maasvlakte, Zandmotor zuid
    - Noord-Holland / N-H → Wijk aan Zee, IJmuiden, Egmond, Bergen, Petten, Noordwijk, Zandvoort
    - Wadden → Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog
    - België / BE → De Panne, Middelkerke, Oostende, Zeebrugge, Knokke-Heist
    
    Algemene uitspraken gelden voor al deze plaatsnamen, tenzij de tekst expliciet zegt dat een bepaalde spot afwijkt.
    
    2.4 Bundeling en conflicten:
    - Algemene uitspraken vormen de basis (bv. “in Z-H veel wind”).
    - Specifieke uitspraken overschrijven of vullen aan.
    - Tegenstrijdige uitspraken splits je in aparte records (bv. ochtend slecht, middag goed).
    
    Stap 3 — Dagdeel-bepaling
    3.1 Gebruik uitsluitend deze dagdelen als eindpunten: morning, midday, evening.  
    
    3.2 Mapping van tijd naar dagdeel:
    - morning: 06:00–11:59
    - midday: 12:00–17:59
    - evening: 18:00–23:59
    
    3.3 Hiërarchie voor mapping:
    - Als een uitspraak expliciet een dagdeel noemt (ochtend, middag, avond) → koppel daar direct aan.
    - Als alleen een tijdstip genoemd wordt (bijv. “14:30u”) → vertaal dit naar het juiste dagdeel volgens bovenstaande tijdsindeling.
    - Als alleen een dag genoemd wordt, zonder dagdeel of tijd → geldt dit voor ALLE dagdelen van die dag.
    - Als meerdere dagdelen/tijden worden genoemd, splits deze in aparte records.
    
    Stap 4 — Datum bepalen
    - Normaal gebruik je uitsluitend informatie die letterlijk in de tekst staat.
    - ENIGE UITZONDERING: als er géén expliciete datum wordt genoemd maar wél een dag (bijv. "maandag"),
      bepaal dan de datum als de eerstvolgende kalenderdatum met die dag, relatief ten opzichte van
      vandaag (op uitvoeringstijdstip) in tijdzone Europe/Amsterdam.
    - Dagnamen (NL): maandag, dinsdag, woensdag, donderdag, vrijdag, zaterdag, zondag.
    - Noteer de datum in ISO-formaat YYYY-MM-DD.
    
    Stap 5 — Bouw de outputstructuur
    Produceer één JSON-object met locaties als keys (lowercase, spaties behouden; alleen sublocaties als key).
    De value per locatie is een array van dag-objecten met exact deze structuur en key-volgorde:
    
    {{
      "<locatie in lowercase>": [
        {{
          "date": "YYYY-MM-DD",
          "alert": <boolean>,
          "parts": {{
            "morning": {{ "swell_m": <number>, "period_s": <number>, "wind_bft": <integer>, "wind_kmh": <integer>, "wind_dir": "<string>", "tide": "<string>", "tide_score": "<string>", "clean": "<string>", "wave_height": "<string>", "go_beginner": "<string>", "go_advanced": "<string>" }}, 
            "midday":   {{ "swell_m": <number>, "period_s": <number>, "wind_bft": <integer>, "wind_kmh": <integer>, "wind_dir": "<string>", "tide": "<string>", "tide_score": "<string>", "clean": "<string>", "wave_height": "<string>", "go_beginner": "<string>", "go_advanced": "<string>" }},
            "evening":  {{ "swell_m": <number>, "period_s": <number>, "wind_bft": <integer>, "wind_kmh": <integer>, "wind_dir": "<string>", "tide": "<string>", "tide_score": "<string>", "clean": "<string>", "wave_height": "<string>", "go_beginner": "<string>", "go_advanced": "<string>" }}
          }}
        }}
      ]
    }}
    
    Stap 6 — Normalisatie & conversies
    - Locatie-keys: exacte plaatsnaam → lowercase; spaties behouden en normaliseer bekende varianten/typo’s.
    - Dagdelen → parts: Ochtend → "morning", Middag → "midday", Avond → "evening".
    - Waarden:
      - swell_m: converteer cm naar meter (50cm → 0.5). Bij ranges neem gemiddelde en rond af op 1 decimaal.  Bij vage termen ("klein", "flat"), of niet benoemd, het veld `null` maken. 
      - period_s: parse numeriek in seconden; bij range → gemiddelde, afronden op geheel getal. Veld null maken als dit niet benoemd wordt. 
      - wind_bft: integer uit tekst. Veld null maken als dit niet benoemd wordt. 
      - wind_kmh: veld null maken als dit niet benoemd wordt.
      - wind_dir: windrichting uit tekst vertalen naar een officiële windrichting uit de lijst: NNO, ONO, OZO, ZZO, ZZW, WZW, WNW, NWN. Altijd converteren naar UPPERCASE (bijv. "z", "zzo", "wzw" → "Z", "ZZO", "WZW"). Veld null maken als dit niet benoemd wordt. 
      - tide: exacte term zoals in de tekst.
      - tide_score: alleen één van deze waarden: "slecht", "medium", "goed". Mapping: bv. "pas goed na 9u" → "goed".
      - wave_height: exact zoals vermeld in de tekst (bijv. "1-1,5m", "flat", "weinig", "heuphoogte").
      - clean: "ja", "nee", of `null`. Voorbeelden: "clean kansen" → "ja", "niet zeker clean" → "nee".
      - go_advanced: exacte tekstfragmenten die advies bevatten voor ervaren surfers. Indien meerdere, combineer als string of array.
      - go_beginner: exacte tekstfragmenten die advies bevatten voor beginners. Indien meerdere, combineer als string of array.
    - alert: true bij expliciete waarschuwingen ("gevaarlijk", "geen beginners", "niet te doen", "stroomt hard", "af te raden").
      Anders false.
    - Als een waarde niet genoemd is én geen afleidingsregel geldt → maak het veld `null`.
    - Neem alleen parts op die expliciet genoemd zijn.
    
    Stap 7 — Validatie en correctie
    Controleer vóór het teruggeven van de output of:
    1. Top-level een JSON-object is met locatie-keys (alle 27 moeten aanwezig zijn).
    2. Elke value een array is van dag-objecten met exact de keys "date", "alert", "parts".
    3. "date" een geldige ISO-datum is.
    4. "alert" een boolean is.
    5. "parts" bevat alleen de keys "morning", "midday", "evening" (indien aanwezig).
    6. Binnen elk part komen alleen de volgende velden voor: "swell_m", "period_s", "wind_bft", "wind_kmh", "wind_dir", "tide", "tide_score", "wave_height", "clean", "go_advanced", "go_beginner". 
    Corrigeer automatisch als dit niet klopt.
    
    Uitvoervereiste:
    - Geef uitsluitend één geldig JSON-object terug, zonder markdown-codeblokken, zonder comments, en zonder extra tekst. 
    - Geen inleidende tekst, geen tussenstappen, geen extra uitleg. Alleen het JSON-object.
    
    Uitvoer:
    JSON-object
    
    Invoer:
    <{text}>
    """.format(text=text)

    chat_completion = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.3-70b-versatile",
        stream=False,
        temperature=0.2,
    )
    content = chat_completion.choices[0].message.content
    raw = _extract_json_object(content)
    return json.loads(raw)
