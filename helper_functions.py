# helper_functions.py
import pandas as pd
import numpy as np

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
