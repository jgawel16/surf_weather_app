# helper_functions.py
import re
import pandas as pd
import numpy as np


def _series_mean(series: pd.Series | None) -> float | None:
    if series is None:
        return None
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if numeric.empty:
        return None
    return float(numeric.mean())


def _circular_mean_deg(series: pd.Series | None) -> float | None:
    if series is None:
        return None
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if numeric.empty:
        return None
    radians = np.deg2rad(numeric % 360)
    sin_mean = np.sin(radians).mean()
    cos_mean = np.cos(radians).mean()
    if np.isclose([sin_mean, cos_mean], 0).all():
        return None
    angle = np.rad2deg(np.arctan2(sin_mean, cos_mean))
    if angle < 0:
        angle += 360
    return float(angle)


def _ms_to_beaufort(ms: float | None) -> int | None:
    if ms is None or pd.isna(ms):
        return None
    thresholds = [
        0.5,
        1.5,
        3.3,
        5.5,
        7.9,
        10.7,
        13.8,
        17.1,
        20.7,
        24.4,
        28.4,
        32.6,
    ]
    for idx, limit in enumerate(thresholds):
        if ms < limit:
            return idx
    return 12


def _deg_to_compass(deg: float | None) -> str | None:
    if deg is None or pd.isna(deg):
        return None
    directions = [
        "N",
        "NNO",
        "NO",
        "ONO",
        "O",
        "OZO",
        "ZO",
        "ZZO",
        "Z",
        "ZZW",
        "ZW",
        "WZW",
        "W",
        "WNW",
        "NW",
        "NNW",
    ]
    idx = int(((deg % 360) / 22.5) + 0.5) % len(directions)
    return directions[idx]


def _hour_to_daypart(hour: float | int | None) -> str | None:
    if hour is None or pd.isna(hour):
        return None
    if hour < 12:
        return "ochtend"
    if hour < 18:
        return "middag"
    if hour < 24:
        return "avond"
    return None


_LOCATION_ALIASES = {
    "wijkenzeenoordpier": "wijk aan zee",
    "wijkaanzeenoordpier": "wijk aan zee",
    "wijkenzee": "wijk aan zee",
    "wijkaanzee": "wijk aan zee",
    "scheveningen": "scheveningen",
}


def _canonicalize_location(raw: str | None) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    cleaned = re.sub(r"[^a-z0-9]", "", text.lower())
    if cleaned in _LOCATION_ALIASES:
        return _LOCATION_ALIASES[cleaned]
    # fallback: replace separators with spaces for readability
    return re.sub(r"[_-]+", " ", text).strip().lower() or None


def aggregate_openmeteo_dayparts(
    dfs: dict[str, pd.DataFrame],
    tz: str = "Europe/Amsterdam",
) -> dict[str, list[dict]]:
    """Aggregate hourly OpenMeteo data into dayparts per spot/day."""

    results: dict[str, list[dict]] = {}

    for location, df in dfs.items():
        df_local = df.copy()
        df_local["date"] = pd.to_datetime(df_local["date"], utc=True, errors="coerce")
        df_local = df_local.dropna(subset=["date"])
        if df_local.empty:
            continue

        df_local["date_local"] = df_local["date"].dt.tz_convert(tz)
        df_local["date_str"] = df_local["date_local"].dt.strftime("%Y-%m-%d")
        df_local["hour"] = df_local["date_local"].dt.hour
        df_local["daypart"] = df_local["hour"].apply(_hour_to_daypart)
        df_local = df_local.dropna(subset=["date_str", "daypart"])
        if df_local.empty:
            continue

        per_date: dict[str, dict] = {}
        grouped = df_local.groupby(["date_str", "daypart"], dropna=True)

        for (date, part), group in grouped:
            wave_height = _series_mean(group.get("wave_height"))
            swell_period = _series_mean(group.get("swell_wave_period"))
            wind_speed = _series_mean(group.get("wind_speed_10m"))
            wind_dir_deg = _circular_mean_deg(group.get("wind_direction_10m"))

            if all(
                value is None
                for value in (wave_height, swell_period, wind_speed, wind_dir_deg)
            ):
                continue

            entry = {
                "swell_m": round(wave_height, 1) if wave_height is not None else None,
                "period_s": int(round(swell_period)) if swell_period is not None else None,
                "wind_bft": _ms_to_beaufort(wind_speed),
                "wind_kmh": round(wind_speed * 3.6) if wind_speed is not None else None,
                "wind_dir": _deg_to_compass(wind_dir_deg),
                "wind_dir_deg": int(round(wind_dir_deg)) if wind_dir_deg is not None else None,
                "source": "openmeteo",
            }

            if all(
                entry.get(field) in (None, "")
                for field in ("swell_m", "period_s", "wind_bft", "wind_dir", "wind_kmh")
            ):
                continue

            parts = per_date.setdefault(date, {})
            parts[part] = entry

        if not per_date:
            continue

        spot_id = _canonicalize_location(location)
        if not spot_id:
            continue

        day_entries = [
            {"date": date, "parts": parts, "source": "openmeteo"}
            for date, parts in sorted(per_date.items())
        ]

        results[spot_id] = day_entries

    return results


def to_json_array(dfs: dict[str, pd.DataFrame], tz, dutch_days, field_order):
    out = []
    for location, df in dfs.items():
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"], utc=True, errors="coerce")
        df["date_local"] = df["date"].dt.tz_convert(tz)
        df["Datum"] = df["date_local"].dt.strftime("%Y-%m-%d")
        df["Dag"] = df["date_local"].dt.weekday.map(lambda i: dutch_days[i])
        df["Locatie"] = location
        df["Tijd"] = df["date_local"].dt.strftime("%H:00")
        df = df.replace({np.nan: None})

        for _, row in df.iterrows():
            record = {
                "Datum": row["Datum"],
                "Dag": row["Dag"],
                "Locatie": row["Locatie"],
                "Tijd": row["Tijd"],
                "wave_height": row.get("wave_height"),
                "wave_direction": row.get("wave_direction"),
                "wave_period": row.get("wave_period"),
                "wind_wave_peak_period": row.get("wind_wave_peak_period"),
                "wind_wave_height": row.get("wind_wave_height"),
                "wind_wave_direction": row.get("wind_wave_direction"),
                "wind_wave_period": row.get("wind_wave_period"),
                "swell_wave_height": row.get("swell_wave_height"),
                "swell_wave_period": row.get("swell_wave_period"),
                "swell_wave_direction": row.get("swell_wave_direction"),
                "swell_wave_peak_period": row.get("swell_wave_peak_period"),
                "secondary_swell_wave_height": row.get("secondary_swell_wave_height"),
                "secondary_swell_wave_period": row.get("secondary_swell_wave_period"),
                "secondary_swell_wave_direction": row.get("secondary_swell_wave_direction"),
                "sea_surface_temperature": row.get("sea_surface_temperature"),
            }
            record = {k: record[k] for k in field_order}
            out.append(record)

    # Belangrijk: GEEN json.dumps hier!
    return out
