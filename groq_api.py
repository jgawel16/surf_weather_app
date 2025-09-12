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
    prompt = """Je krijgt hieronder een informeel geschreven surfweerbericht in het Nederlands.
De tekst bevat afkortingen, spreektaal en losse zinnen, maar bevat belangrijke informatie
over surfcondities op specifieke locaties, dagen en dagdelen in Nederland en België.

Je taak: Zet deze informatie om naar een gestructureerd JSON-object met de opgegeven velden,
maar voordat je de JSON maakt, doorloop je eerst een bundelstap per locatie zodat informatie
op verschillende niveaus (regio ↔ specifieke spot) correct wordt gecombineerd.

Stap 1 — Uitspraken identificeren
- Splits de tekst in losse uitspraken die concrete gegevens bevatten over surfcondities
  (wind, tij, golfhoogte, clean, tijden, swell, etc.).
- Noteer bij elke uitspraak: Locatie(s), Dag, Dagdeel (indien genoemd), en de exacte parameters
  zoals in de tekst.
- Behoud de tekst exact zoals vermeld; maak geen interpretaties.

Stap 2 — Locatie-hiërarchie toepassen
- Gebruik een vooraf bekende lijst met hoofdlocaties en hun sublocaties:
  - Zeeland: Domburg, Cadzand
  - Zuid-Holland (Z-H): Hoek van Holland (HvH), Kijkduin, Ter Heijde, Scheveningen (Schev), Katwijk, Wassenaar, Ouddorp, Maasvlakte, Zandmotor zuid
  - Noord-Holland (N-H): Wijk aan Zee, IJmuiden, Egmond, Bergen, Petten, Noordwijk (Nwijk), Zandvoort (Zvoort)
  - Wadden: Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog
  - België: De Panne, Middelkerke, Oostende, Zeebrugge, Knokke-Heist
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
        "morning": {{ "swell_m": <number>, "period_s": <number>, "wind_bft": <integer>, "wind_kmh": <integer>, "wind_dir": "<string>" }},
        "midday":  {{ "swell_m": <number>, "period_s": <number>, "wind_bft": <integer>, "wind_kmh": <integer>, "wind_dir": "<string>" }},
        "evening": {{ "swell_m": <number>, "period_s": <number>, "wind_bft": <integer>, "wind_kmh": <integer>, "wind_dir": "<string>" }}
      }}
    }}
  ]
}}

Stap 5.1 — Normalisatie & conversies
- Locatie-keys: exacte spotnaam → lowercase; spaties behouden en normaliseer bekende varianten/typo’s: "oudorp" → "ouddorp", "hv h"/"hvh" → "hoek van holland", "wijk" (alleen als spot bedoeld) → "wijk aan zee", "zandmotor" → "zandmotor zuid" (alleen als dat in de tekst zo bedoeld is).
- Dagdelen → parts: Ochtend → "morning", Middag → "midday", Avond → "evening".
- Waarden:
  - swell_m: converteer cm naar meter (50cm → 0.5). Bij ranges neem gemiddelde en rond af op 1 decimaal.
    Bij vage termen ("klein", "flat") het veld weglaten (niet null).
  - period_s: parse numeriek in seconden; bij range → gemiddelde, afronden op geheel getal.
  - wind_bft: integer uit tekst.
  - wind_kmh: als niet genoemd → afleiden uit Beaufort via het midpoint van het officiële km/h-bereik, afgerond naar integer.
  - wind_dir: exacte afkorting uit tekst; **converteer naar UPPERCASE** (bijv. "z", "zzo", "wzw" → "Z", "ZZO", "WZW").
- alert: true bij expliciete waarschuwingen ("gevaarlijk", "geen beginners", "niet te doen", "stroomt hard", "af te raden").
  Anders false.
- Als een waarde niet genoemd is én geen afleidingsregel geldt → laat het veld weg (niet null).
- Neem alleen parts op die expliciet genoemd zijn.

Stap 6 — Validatie en correctie
Controleer vóór het teruggeven van de output of:
1. Top-level een JSON-object is met locatie-keys.
2. Elke value een array is van dag-objecten met exact de keys "date", "alert", "parts".
3. "date" een geldige ISO-datum is.
4. "alert" een boolean is.
5. "parts" bevat alleen de keys "morning", "midday", "evening" (indien aanwezig).
6. Binnen elk part komen alleen de velden "swell_m", "period_s", "wind_bft", "wind_kmh", "wind_dir" voor, met juiste types.
Corrigeer automatisch als dit niet klopt.

Uitvoervereiste:
- Geef uitsluitend één geldig JSON-object terug, zonder markdown-codeblokken (```), zonder comments, en zonder extra tekst.
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
