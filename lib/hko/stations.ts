export const HKO_WEATHER_API =
  "https://data.weather.gov.hk/weatherAPI/opendata/weather.php";
export const HKO_TEMP_CSV =
  "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_temperature.csv";
export const HKO_RH_CSV =
  "https://data.weather.gov.hk/weatherAPI/hko_data/regional-weather/latest_1min_humidity.csv";

export const KOWLOON_TEMP_STATIONS = [
  "Sham Shui Po",
  "King's Park",
  "Kowloon City",
  "Wong Tai Sin",
  "Kai Tak Runway Park",
] as const;

export const KOWLOON_RH_STATIONS = ["King's Park", "HK Observatory", "Hong Kong Observatory", "Kowloon City"] as const;

export function isKowloonTempStation(name: string): boolean {
  return (KOWLOON_TEMP_STATIONS as readonly string[]).includes(name);
}

export function isKowloonRhStation(name: string): boolean {
  return (KOWLOON_RH_STATIONS as readonly string[]).includes(name);
}
