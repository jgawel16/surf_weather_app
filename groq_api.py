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
    
    prompt="""Je krijgt hieronder een informeel surfweerbericht in het Nederlands. De tekst bevat essentiële informatie over surfcondities op specifieke locaties, dagen en dagdelen in Nederland en België. De tekst is echter slordig geschreven en bevat afkortingen, cryptische omschrijvingen en soms halve zinnen.
    
    Doel: zet deze informatie om naar één gestructureerd JSON-object volgens de regels hieronder.
    
    1. **Normalisatie & hiërarchie**  
       - Normaliseer varianten en schrijfwijzen naar de juiste plaatsnaam. Bijvoorbeeld:
        - “HvH”, “hvh”, “hoek vh” → “Hoek van Holland”
        - “Schev”, “schev n”, “scheveningen noord” → “Scheveningen”
        - “wijk”, “wijk aan” → “Wijk aan Zee”
        - “zvoort” → “Zandvoort”
       - Hiërarchie:  koppel uitspraken over locaties op het niveau van landen, provincies, en regio's aan de corresponderende plaatsnamen:
        - Zeeland → Domburg, Cadzand
        - Zuid-Holland of Z-H → Hoek van Holland, Kijkduin, Ter Heijde, Scheveningen, Katwijk, Wassenaar, Ouddorp, Maasvlakte, Zandmotor zuid
        - Noord-Holland of N-H → Wijk aan Zee, IJmuiden, Egmond, Bergen, Petten, Noordwijk, Zandvoort
        - Wadden → Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog
        - België of BE → De Panne, Middelkerke, Oostende, Zeebrugge, Knokke-Heist
       - Algemene uitspraken waar geen locatie wordt genoemd, gelden voor alle locaties, tenzij een specifieke uitspraak deze overschrijft.
    
    2. **Locaties**  
        Gebruik uitsluitend en exact deze lijst als keys (lowercase, spaties behouden): domburg, cadzand, hoek van holland, kijkduin, ter heijde, scheveningen, katwijk, wassenaar, ouddorp, maasvlakte, zandmotor zuid, wijk aan zee, ijmuiden, egmond, bergen, petten, noordwijk, zandvoort, texel, vlieland, terschelling, ameland, schiermonnikoog, de panne, middelkerke, oostende, zeebrugge, knokke-heist.
        → Alle 27 moeten in de output voorkomen. Als er geen info over een locatie is: array met één object waarin date=null, alert=false, en elke waarde binnen parts = null.
    
    3. **Datum**  
        - Als expliciete datum genoemd is → gebruik die.  
        - Als alleen weekdag genoemd is → pak de eerstvolgende kalenderdatum met die dag, relatief ten opzichte van vandaag (op uitvoeringstijdstip) in tijdzone Europe/Amsterdam.
        - Notatie: ISO (YYYY-MM-DD).
    
    4. **Alert**
        Alert: true bij expliciete waarschuwingen ("gevaarlijk", "geen beginners", "niet te doen", "stroomt hard", "af te raden"). Als er geen info is → alert=false.
    
    5. **Dagdelen & tijden**
        Gebruik exact: morning (06:00–11:59), midday (12:00–17:59), evening (18:00–23:59).
        - Als alleen dag genoemd is → geldt voor alle dagdelen.  
        - Als tijd genoemd is → map naar bijbehorend dagdeel.
        - Meerdere tijden/dagdelen → splits in aparte records.
    
    6. **Parameters**
        De belangrijkste regel is dat er nergens interpretaties gemaakt mogen worden. Gebruik exact deze parameters:
        - swell_m: converteer cm naar meter (50cm → 0.5). Bij ranges neem gemiddelde en rond af op 1 decimaal.  Bij vage termen ("klein", "flat"), of geen data → null. 
        - period_s: parse numeriek in seconden; bij range → gemiddelde, afronden op geheel getal. Geen data → null.
        - wind_bft: integer uit tekst. Geen data → null.
        - wind_kmh: Geen data → null.
        - wind_dir: windrichting uit tekst vertalen naar een officiële windrichting uit de lijst: [N, NNO, NO, ONO, O, OZO, ZO, ZZO, Z, ZZW, ZW, WZW, W, WNW, NW, NNW]. Altijd converteren naar UPPERCASE (bijv. "z", "zzo", "wzw" → "Z", "ZZO", "WZW"). Geen data → null.
        - tide: exacte term zoals in de tekst. Geen data → null.
        - tide_score: alleen één van deze waarden: "slecht", "medium", "goed". Mapping: bv. "pas goed na 9u" → "goed". Geen data → null.
        - wave_height: exact zoals vermeld in de tekst (bijv. "1-1,5m", "flat", "weinig", "heuphoogte"). Geen data → null. 
        - clean: "ja", "nee", of `null`. Voorbeelden: "clean kansen" → "ja", "niet zeker clean" → "nee". Geen data → null.
        - go_advanced: exacte tekstfragmenten die advies bevatten voor ervaren surfers. Indien meerdere, combineer als string of array. Geen data → null.
        - go_beginner: exacte tekstfragmenten die advies bevatten voor beginners. Indien meerdere, combineer als string of array. Geen data → null.
    
    7. **Outputstructuur**  
       Waarde = JSON-object met locaties als keys. De value per locatie is een array van dag-objecten. Alle 27 locaties uit de lijst in punt 2 moeten altijd aanwezig zijn als key in het JSON-object, ook als er geen informatie voor die locatie in de tekst staat. In dat geval moet de value een array zijn met één object waarin "date"=null, "alert"=false, en alle velden binnen "parts"=null. Gebruik exact deze structuur, benaming, en key-volgorde: 
       {{
          "<locatie in lowercase>": [
            {{
              "date": "YYYY-MM-DD",
              "alert": <boolean>,
              "parts": {{
                "morning": {{ "swell_m": <number>, "period_s": <number>, "wind_bft": <integer>, "wind_kmh": <integer>, "wind_dir": "<string>", "tide": "<string>", "tide_score": "<string>", "clean": "<string>", "wave_height": "<string>", "go_beginner": "<string>", "go_advanced": "<string>" }}, 
                "midday": {{ "swell_m": <number>, "period_s": <number>, "wind_bft": <integer>, "wind_kmh": <integer>, "wind_dir": "<string>", "tide": "<string>", "tide_score": "<string>", "clean": "<string>", "wave_height": "<string>", "go_beginner": "<string>", "go_advanced": "<string>" }},
                "evening": {{ "swell_m": <number>, "period_s": <number>, "wind_bft": <integer>, "wind_kmh": <integer>, "wind_dir": "<string>", "tide": "<string>", "tide_score": "<string>", "clean": "<string>", "wave_height": "<string>", "go_beginner": "<string>", "go_advanced": "<string>" }}
              }}
            }}
          ]
        }}
    
    Invoer: 
    <<<{text}>>>
    """.format(text=text)

    chat_completion = client.chat.completions.create(
        messages=[{"role": "user", "content": prompt}],
        model="llama-3.3-70b-versatile",
        stream=False,
        response_format={"type": "json_object"},
        temperature=0.2,
    )
    content = chat_completion.choices[0].message.content
    raw = _extract_json_object(content)
    return json.loads(raw)
