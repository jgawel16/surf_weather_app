import pandas as pd
import requests_cache
from retry_requests import retry
import openmeteo_requests
from helper_functions import aggregate_openmeteo_dayparts

# === Open-meteo =====================================================

def get_openmeteo_data():
    # Setup the Open-Meteo API client with cache and retry on error
    cache_session = requests_cache.CachedSession('.cache', expire_after = 3600)
    retry_session = retry(cache_session, retries = 5, backoff_factor = 0.2)
    openmeteo = openmeteo_requests.Client(session = retry_session)

    # Make sure all required weather variables are listed here
    # The order of variables in hourly or daily is important to assign them correctly below
    url = "https://marine-api.open-meteo.com/v1/marine"
    params = {
        "latitude": [52.4693, 52.1066],
        "longitude": [4.556, 4.2654],
        "hourly": [
            "wave_height",
            "wave_direction",
            "wave_period",
            "wind_wave_peak_period",
            "wind_wave_height",
            "wind_wave_direction",
            "wind_wave_period",
            "swell_wave_height",
            "swell_wave_period",
            "swell_wave_direction",
            "swell_wave_peak_period",
            "secondary_swell_wave_height",
            "secondary_swell_wave_period",
            "secondary_swell_wave_direction",
            "sea_surface_temperature",
            "wind_speed_10m",
            "wind_direction_10m",
        ],
        "forecast_days": 3,
    }
    responses = openmeteo.weather_api(url, params=params)

    locations = ["wijk_aan_zee_noordpier", "scheveningen"]

    # empty dict for dataframes
    dfs = {}

    # Process locations
    for response, location in zip(responses, locations):

        # Process hourly data. The order of variables needs to be the same as requested.
        hourly = response.Hourly()
        hourly_wave_height = hourly.Variables(0).ValuesAsNumpy()
        hourly_wave_direction = hourly.Variables(1).ValuesAsNumpy()
        hourly_wave_period = hourly.Variables(2).ValuesAsNumpy()
        hourly_wind_wave_peak_period = hourly.Variables(3).ValuesAsNumpy()
        hourly_wind_wave_height = hourly.Variables(4).ValuesAsNumpy()
        hourly_wind_wave_direction = hourly.Variables(5).ValuesAsNumpy()
        hourly_wind_wave_period = hourly.Variables(6).ValuesAsNumpy()
        hourly_swell_wave_height = hourly.Variables(7).ValuesAsNumpy()
        hourly_swell_wave_period = hourly.Variables(8).ValuesAsNumpy()
        hourly_swell_wave_direction = hourly.Variables(9).ValuesAsNumpy()
        hourly_swell_wave_peak_period = hourly.Variables(10).ValuesAsNumpy()
        hourly_secondary_swell_wave_height = hourly.Variables(11).ValuesAsNumpy()
        hourly_secondary_swell_wave_period = hourly.Variables(12).ValuesAsNumpy()
        hourly_secondary_swell_wave_direction = hourly.Variables(13).ValuesAsNumpy()
        hourly_sea_surface_temperature = hourly.Variables(14).ValuesAsNumpy()
        hourly_wind_speed_10m = hourly.Variables(15).ValuesAsNumpy()
        hourly_wind_direction_10m = hourly.Variables(16).ValuesAsNumpy()
        
        hourly_data = {"date": pd.date_range(
            start = pd.to_datetime(hourly.Time(), unit = "s", utc = True),
            end = pd.to_datetime(hourly.TimeEnd(), unit = "s", utc = True),
            freq = pd.Timedelta(seconds = hourly.Interval()),
            inclusive = "left"
        )}
        
        hourly_data["wave_height"] = hourly_wave_height
        hourly_data["wave_direction"] = hourly_wave_direction
        hourly_data["wave_period"] = hourly_wave_period
        hourly_data["wind_wave_peak_period"] = hourly_wind_wave_peak_period
        hourly_data["wind_wave_height"] = hourly_wind_wave_height
        hourly_data["wind_wave_direction"] = hourly_wind_wave_direction
        hourly_data["wind_wave_period"] = hourly_wind_wave_period
        hourly_data["swell_wave_height"] = hourly_swell_wave_height
        hourly_data["swell_wave_period"] = hourly_swell_wave_period
        hourly_data["swell_wave_direction"] = hourly_swell_wave_direction
        hourly_data["swell_wave_peak_period"] = hourly_swell_wave_peak_period
        hourly_data["secondary_swell_wave_height"] = hourly_secondary_swell_wave_height
        hourly_data["secondary_swell_wave_period"] = hourly_secondary_swell_wave_period
        hourly_data["secondary_swell_wave_direction"] = hourly_secondary_swell_wave_direction
        hourly_data["sea_surface_temperature"] = hourly_sea_surface_temperature
        hourly_data["wind_speed_10m"] = hourly_wind_speed_10m
        hourly_data["wind_direction_10m"] = hourly_wind_direction_10m
        
        hourly_dataframe = pd.DataFrame(data = hourly_data)
        dfs[location] = hourly_dataframe

    aggregated = aggregate_openmeteo_dayparts(dfs)

    return aggregated



