# groq_api.py
import os
import re
import json
from typing import Any, Dict, Tuple, Optional, Union
from groq import Groq

PROMPT1_TEMPLATE = """Je krijgt hieronder een informeel surfweerbericht in het Nederlands. De tekst bevat essentiële informatie over surfcondities op specifieke locaties, dagen en dagdelen in Nederland en België. De tekst is slordig geschreven en bevat afkortingen, cryptische omschrijvingen en soms halve zinnen.

Doel: knip het bericht op in losse stukken informatie per locatie en datum.

Regels:

1) Tekstbehoud
- De inhoud van elk los stuk blijft EXACT zoals in de bron (inclusief hashtags, haakjes, interpunctie). Verander niets en maak geen interpretaties.
- Alleen spaties aan het begin/einde van "informatie" mogen worden getrimd.
- Normaliseren is uitsluitend toegestaan voor LOCATIENAMEN (zie regel 2).

2) Normaliseren van locaties
- Normaliseer varianten en schrijfwijzen van locaties naar standaardnamen. Voorbeelden:
  - "HvH", "hvh", "hoek vh" → "Hoek van Holland"
  - "Schev", "schev n", "scheveningen noord" → "Scheveningen"
  - "wijk", "wijk aan" → "Wijk aan Zee"
  - "zvoort" → "Zandvoort"
  - "Z-H" of "ZH" → "Zuid-Holland"
  - "BE" → "België"

3) Toegestane locaties (en alleen deze)
[Nederland, Nederland&België, Zeeland, Domburg, Cadzand, Zuid-Holland, Hoek van Holland, Kijkduin, Ter Heijde, Scheveningen, Katwijk, Wassenaar, Ouddorp, Maasvlakte, Zandmotor zuid, Noord-Holland, Wijk aan Zee, IJmuiden, Egmond, Bergen, Petten, Noordwijk, Zandvoort, Wadden, Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog, België, De Panne, Middelkerke, Oostende, Zeebrugge, Knokke-Heist]

4) Locatie-koppeling
- Als een los stuk 1 locatie aanduidt → koppel aan die ene locatie (na normalisatie) uit de lijst van regel 3.
- Als een los stuk meerdere locaties aanduidt (bv. “Texel en De Koog”) → maak voor elke corresponderende locatie een afzonderlijk record met dezelfde "informatie".
- Als er GEEN locatie wordt genoemd → gebruik "Nederland&België" als locatie.

5) Volledige dekking
- Het volledige bericht moet terugkomen in de output: laat geen uitspraken achterwege. Indien een zin meerdere onafhankelijke informatie-eenheden bevat (bv. verschillende tijden of waarschuwingen), splits deze dan in meerdere records (met dezelfde locatie(s) waar van toepassing).

6) Datum
- Als expliciete kalenderdatum genoemd is → gebruik die datum 
- Als alleen een weekdag genoemd is → gebruik de eerstvolgende kalenderdatum met die dag als datum, relatief t.o.v. vandaag (uitvoeringstijdstip) in tijdzone Europe/Amsterdam.
- Noteer de datum als ISO: YYYY-MM-DD.
- Als geen datum te bepalen is → zet "datum" = null.

7) Dagdeel
- Als er een tijdstip is genoemd, map naar:
  - "ochtend" (06:00–11:59), "middag" (12:00–17:59), "avond" (18:00–23:59).
- Als alleen een dag is genoemd zonder tijd → gebruik "hele dag".
- Als meerdere tijden/dagdelen in één stuk voorkomen → splits in aparte records.
- Als geen dagdeel te herleiden is → "dagdeel" = null.

8) Output
- Geef één JSON-object terug met locaties als keys (alleen waarden uit regel 3).
- De value per locatie is een array van records. Voor elk record gebruik je exact deze structuur en sleutelvolgorde:

{{
  "<locatie>": [
    {{
      "datum": "YYYY-MM-DD of null",
      "dagdeel": "ochtend|middag|avond|hele dag|null",
      "informatie": "<exact tekstfragment uit bron>"
    }}
  ]
}}

Invoer:
<<<{payload}>>>
"""

PROMPT2_TEMPLATE = """Doel:
Neem de JSON-output van stap 1 (met locaties en regio’s) en produceer één JSON-object waarin alleen plaatsnamen als keys voorkomen. Alle informatie die indirect via regio’s/provincies/“Nederland&België” is genoemd, moet worden toegeschreven aan de bijbehorende plaatsnamen.

Toegestane plaatsnamen (en alleen deze als keys in de output):
[Domburg, Cadzand, Hoek van Holland, Kijkduin, Ter Heijde, Scheveningen, Katwijk, Wassenaar, Ouddorp, Maasvlakte, Zandmotor zuid, Wijk aan Zee, IJmuiden, Egmond, Bergen, Petten, Noordwijk, Zandvoort, Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog, De Panne, Middelkerke, Oostende, Zeebrugge, Knokke-Heist]

Regio → plaatsnaam mapping:
- Zeeland → Domburg, Cadzand
- Zuid-Holland (of Z-H) → Hoek van Holland, Kijkduin, Ter Heijde, Scheveningen, Katwijk, Wassenaar, Ouddorp, Maasvlakte, Zandmotor zuid
- Noord-Holland (of N-H) → Wijk aan Zee, IJmuiden, Egmond, Bergen, Petten, Noordwijk, Zandvoort
- Wadden → Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog
- Nederland → Domburg, Cadzand, Hoek van Holland, Kijkduin, Ter Heijde, Scheveningen, Katwijk, Wassenaar, Ouddorp, Maasvlakte, Zandmotor zuid, Wijk aan Zee, IJmuiden, Egmond, Bergen, Petten, Noordwijk, Zandvoort, Texel, Vlieland, Terschelling, Ameland, Schiermonnikoog
- België → De Panne, Middelkerke, Oostende, Zeebrugge, Knokke-Heist
- Nederland&België → alle bovenstaande 27 plaatsnamen

Belangrijke regels:
- Geen tekstwijziging: de velden datum, dagdeel, en vooral informatie worden niet aangepast. Kopieer ze 1-op-1. Geen herformulering, vertaling, interpretatie of normalisatie buiten locatie-distributie.
- Distributie: voor elke key in data
  - Als het al een plaatsnaam is (uit de lijst hierboven): kopieer alle records naar dezelfde plaatskey in de output.
  - Als het een regio/provincie/verenigde key is (zoals Zeeland, Zuid-Holland, Noord-Holland, Wadden, België, Nederland, Nederland&België): dupliceer elk record naar alle bijbehorende plaatsnamen volgens de mapping hierboven.
- Samenvoegen: de output per plaatsnaam bevat alle records die rechtstreeks aan die plaats waren gekoppeld plus alle gedistribueerde records vanuit regio’s/verenigde keys.
- Deduplicatie: verwijder exacte duplicaten binnen een plaatsnaam (een duplicaat is een record met exact gelijke waarden voor datum, dagdeel, informatie).
- Volledigheid: alle 27 plaatsnamen moeten altijd als key aanwezig zijn in de output. Als er geen records voor een plaatsnaam zijn, gebruik dan een lege array [].
- Volgorde (optioneel maar gewenst): sorteer per plaatsnaam de records primair op datum (oplopend; null laatst), secundair op dagdeel met volgorde ochtend < middag < avond < hele dag < null.

Outputformaat: geef uitsluitend één JSON-object terug met precies de 27 plaatsnaamkeys, en per key een array van objecten met exact de velden (en sleutelvolgorde):
{{
  "<plaatsnaam>": [
    {{
      "datum": "<YYYY-MM-DD of null>",
      "dagdeel": "<ochtend|middag|avond|hele dag|null>",
      "informatie": "<exacte ongewijzigde tekst>"
    }}
  ],
  ...
}}

Input:
<<<{payload}>>>
"""

PROMPT3_TEMPLATE = """Doel: Neem de input die onderaan vermeldt staat en produceer één JSON-object. Bundel per plaatsnaam + datum + dagdeel alle records tot maximaal één entry per dagdeel (ochtend, middag, avond, hele dag). De inhoud van "informatie" blijft exact zoals in de input; er worden geen woorden gewijzigd of toegevoegd, behalve een vaste scheiding tussen samengevoegde fragmenten.

Regels:
1. Scope & behoud
    - Werk per plaatsnaam (top-level key).
    - Binnen een plaatsnaam werk je per datum (YYYY-MM-DD of null).
    - Binnen een datum bundel je per dagdeel tot maximaal één record voor elk van: "ochtend", "middag", "avond", "hele dag".
    - De tekst in "informatie" blijft exact; niet herschrijven of interpreteren.
2. Samenvoegen "informatie"
    - Verzamel alle records met dezelfde (plaatsnaam, datum, dagdeel).
    - Behoud de volgorde van de fragmenten zoals ze in de input-array voorkomen.
    - Plak alle "informatie"-fragmenten achter elkaar met exact deze scheiding tussen fragmenten: "\n" (één newline-karakter).
    - Verwijder exacte duplicaten van fragmenten binnen dezelfde combinatie (stringvergelijking 1-op-1).
4. Waarden voor "dagdeel"
    - Gebruik exact één van: "ochtend", "middag", "avond", "hele dag".
    - Maak nooit extra varianten aan.
5. Outputstructuur per plaatsnaam
    - De value is een array met records. Per record exact deze sleutels en volgorde: 
    {{
    "datum": "<YYYY-MM-DD of null>",
    "dagdeel": "<ochtend|middag|avond|hele dag>",
    "informatie": "<samengevoegde tekst, fragmenten gescheiden door één newline-karakter>"
    }}
    - Per (plaatsnaam, datum) mogen maximaal 4 records bestaan (één per dagdeel dat voorkomt). Dagdelen die niet voorkomen laat je weg.
    - Sorteer binnen elke plaatsnaam: primair op "datum" oplopend (null laatst), secundair op dagdeel met volgorde: ochtend < middag < avond < hele dag.

Output:
Geef uitsluitend één JSON-object terug met plaatsnamen als keys en per key een array van records volgens de structuur in regel 5.

Input:
<<<{payload}>>>
"""

PROMPT4_TEMPLATE = """Doel
Neem de input (onderaan) en produceer één JSON-object in de exacte structuur zoals hieronder gedefinieerd. Zet de bestaande records om naar een genormaliseerd schema met "alert" en parameters. Er mag geen enkele interpretatie of toevoeging plaatsvinden buiten de regels hieronder.

Regels

1) Scope
- Input is een JSON-object met plaatsnamen als keys. Elke plaatsnaam bevat een array van records met sleutels "datum", "alert", "dagdeel", "informatie".
- Output moet een JSON-object zijn met dezelfde plaatsnamen (alle 27 locaties, zie lijst hieronder). Voor locaties die in de input ontbreken → geef een array met één default record (zie regel 6).

2) Alerts
- Zoek in elk "informatie"-veld naar expliciete waarschuwingen.
- Als er een van deze woorden/uitdrukkingen voorkomt (hoofdletterongevoelig): ["gevaarlijk", "geen beginners", "niet te doen", "stroomt hard", "af te raden"] → zet `"alert": true`.
- Anders altijd `"alert": false`.

3) Parameters
Uit elk "informatie"-veld haal je, exact en zonder interpretatie, de volgende parameters. Als iets niet letterlijk aanwezig of ondubbelzinnig is → null.
- `swell_m`: als hoogte in cm → omrekenen naar meter (50cm → 0.5). Als range (bijv. "40-60cm") → gemiddelde, afgerond op 1 decimaal (50cm → 0.5). In meters ("1-1.5m") idem. Vage termen ("klein", "flat") → null.
- `wave_height`: exacte omschrijving van golf hoogte uit tekst ("1-1,5m", "flat", "weinig", "heuphoog"). Geen data → null.
- `period_s`: periode, numeriek in seconden. Bij range → gemiddelde, afgerond op geheel getal. Geen data → null.
- `wind_bft`: integer uit tekst ("3 bft"). Geen data → null.
- `wind_kmh`: alleen als letterlijk vermeld. Geen data → null.
- `wind_dir`: windrichting uit tekst mappen naar officiële lijst: [N, NNO, NO, ONO, O, OZO, ZO, ZZO, Z, ZZW, ZW, WZW, W, WNW, NW, NNW]. Altijd UPPERCASE. Geen data → null.
- `tide`: exacte term uit tekst over getij ("laag", "opkomend tij", "mid-tij"). Geen data → null.
- `tide_score`: alleen een van ["slecht", "medium", "goed"]. Mapping: als de tekst een kwalificatie geeft ("pas goed na 9u" → "goed"). Geen data → null.
- `clean`: "ja", "nee", of null. Voorbeeld: "clean kansen" → "ja", "niet zeker clean" → "nee". Geen data → null.
- `go_advanced`: exacte tekstfragmenten met adviezen voor ervaren surfers. Als meerdere → combineer met "\n". Geen data → null.
- `go_beginner`: exacte tekstfragmenten met adviezen voor beginnende surfers. Als meerdere → combineer met "\n". Geen data → null.

4) Dagdelen
- Elk record moet in "parts" verdeeld worden naar vier dagdelen: "ochtend", "middag", "avond", "hele dag".
- Voor dagdelen zonder data → alle parameters = null.

5) Outputstructuur
Per locatie is de value een array van dagrecords. Elk dagrecord:
{{
  "date": "YYYY-MM-DD" of null,
  "alert": <boolean>,
  "parts": {{
    "ochtend": {{ "swell_m": <number or null>, "wave_height": "<string or null>", "period_s": <number or null>, "wind_bft": <integer or null>, "wind_kmh": <integer or null>, "wind_dir": "<string or null>", "tide": "<string or null>", "tide_score": "<string or null>", "clean": "<string or null>", "go_beginner": "<string or null>", "go_advanced": "<string or null>" }},
    "middag": {{ ...zelfde structuur... }},
    "avond": {{ ...zelfde structuur... }},
    "hele dag": {{ ...zelfde structuur... }}
  }}
}}

6) Compleetheid
- Alle 27 locaties moeten als key aanwezig zijn (lowercase). Voor locaties die niet in de input zaten → array met één record:
  {{
    "date": null,
    "alert": false,
    "parts": {{
      "ochtend": {{...alle velden null...}}, 
      "middag": {{...alle velden null...}}, 
      "avond": {{...alle velden null...}},
      "hele dag": {{...alle velden null...}}
    }}
  }}

Output
Geef uitsluitend het JSON-object terug in exact deze structuur en sleutelvolgorde. Geen tekst erbuiten.

Locatielijst (27)
["texel", "vlieland", "terschelling", "ameland", "schiermonnikoog", "wijk aan zee", "ijmuiden", "egmond", "bergen", "petten", "zandvoort", "noordwijk", "katwijk", "wassenaar", "scheveningen", "ter heijde", "zandmotor zuid", "hoek van holland", "kijkduin", "ouddorp", "maasvlakte", "domburg", "cadzand", "de panne", "middelkerke", "oostende", "zeebrugge", "knokke-heist"]

Input:
<<<{payload}>>>
"""

# ------------------------
# Client
# ------------------------
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
client = Groq(api_key=GROQ_API_KEY)

# ------------------------
# Helpers
# ------------------------
_SYSTEM_JSON_ONLY = (
    "Je bent een strikte JSON-transformatie-engine. "
    "Antwoord ALLEEN met één geldig JSON-object. "
    "Geen uitleg, geen backticks, geen extra tekst."
)

def _extract_json_object(text: str) -> str:
    s = text.strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*|\s*```$", "", s, flags=re.IGNORECASE | re.DOTALL).strip()
    start = s.find("{")
    end = s.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise ValueError("Kon geen JSON-object vinden in modeloutput.")
    return s[start:end + 1]

def _ensure_json_obj(obj: Union[str, Dict[str, Any]]) -> Dict[str, Any]:
    if isinstance(obj, dict):
        return obj
    return json.loads(obj)

def _render_prompt(template: str, payload: Union[str, Dict[str, Any]]) -> str:
    if isinstance(payload, dict):
        payload_str = json.dumps(payload, ensure_ascii=False)
    else:
        payload_str = str(payload)
    return template.format(payload=payload_str)

def _run(template: str, payload: Union[str, Dict[str, Any]]) -> Dict[str, Any]:
    prompt = _render_prompt(template, payload)
    resp = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        temperature=0.2,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": _SYSTEM_JSON_ONLY},
            {"role": "user", "content": prompt},
        ],
    )
    raw = resp.choices[0].message.content
    return json.loads(_extract_json_object(raw))

# ------------------------
# Orchestratie (type-veilig)
# ------------------------
def groq_process_text(text: str, *, return_intermediate: bool = False):
    """
    Stap 1: input = vrije tekst (str)
    Stap 2: input = JSON (dict)    <- output Stap 1
    Stap 3: input = JSON (dict)    <- output Stap 2
    Stap 4: input = JSON (dict)    <- output Stap 3
    """
    if not isinstance(text, str):
        raise TypeError("Stap 1 verwacht een str als input.")

    # 1) tekst -> locaties/regio's (JSON)
    step1 = _run(PROMPT1_TEMPLATE, text)              # text in {payload}

    # 2) regio's -> plaatsnamen (JSON)
    step2 = _run(PROMPT2_TEMPLATE, _ensure_json_obj(step1))

    # 3) bundelen per (plaats, datum, dagdeel) (JSON)
    step3 = _run(PROMPT3_TEMPLATE, _ensure_json_obj(step2))

    # 4) normaliseren naar schema met alert/parameters (JSON)
    step4 = _run(PROMPT4_TEMPLATE, _ensure_json_obj(step3))

    return (step1, step2, step3, step4) if return_intermediate else step4
