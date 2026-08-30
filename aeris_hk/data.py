"""Reference geography and deterministic synthetic observation data for Hong Kong.

No live external feeds are wired up yet, so observations are generated from a
seed derived from ``(district, date)``. This keeps the whole system reproducible
and testable offline while producing plausible, spatially/temporally coherent
values. Swapping in real feeds (e.g. HK EPD air quality, CHP surveillance) only
requires replacing :func:`observe`.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import math
from dataclasses import dataclass, asdict
from typing import Dict, List


@dataclass(frozen=True)
class District:
    """Static reference information for one of Hong Kong's 18 districts."""

    id: str
    name: str
    region: str
    population: int
    area_km2: float
    lat: float
    lon: float

    @property
    def population_density(self) -> float:
        """People per square kilometre."""
        return self.population / self.area_km2

    def to_dict(self) -> Dict[str, object]:
        d = asdict(self)
        d["population_density"] = round(self.population_density, 1)
        return d


# Approximate 2021 census population, land area, and centroid coordinates.
DISTRICTS: List[District] = [
    District("central_western", "Central and Western", "Hong Kong Island", 235953, 12.50, 22.2820, 114.1548),
    District("wan_chai", "Wan Chai", "Hong Kong Island", 166695, 9.83, 22.2793, 114.1747),
    District("eastern", "Eastern", "Hong Kong Island", 529603, 18.56, 22.2833, 114.2233),
    District("southern", "Southern", "Hong Kong Island", 263278, 38.85, 22.2470, 114.1600),
    District("yau_tsim_mong", "Yau Tsim Mong", "Kowloon", 310647, 6.99, 22.3130, 114.1720),
    District("sham_shui_po", "Sham Shui Po", "Kowloon", 431090, 9.35, 22.3300, 114.1620),
    District("kowloon_city", "Kowloon City", "Kowloon", 410634, 10.02, 22.3280, 114.1910),
    District("wong_tai_sin", "Wong Tai Sin", "Kowloon", 406802, 9.30, 22.3420, 114.1940),
    District("kwun_tong", "Kwun Tong", "Kowloon", 673166, 11.27, 22.3130, 114.2260),
    District("kwai_tsing", "Kwai Tsing", "New Territories", 480560, 23.34, 22.3570, 114.1300),
    District("tsuen_wan", "Tsuen Wan", "New Territories", 320094, 61.71, 22.3710, 114.1140),
    District("tuen_mun", "Tuen Mun", "New Territories", 506879, 84.53, 22.3910, 113.9770),
    District("yuen_long", "Yuen Long", "New Territories", 668080, 138.46, 22.4450, 114.0220),
    District("north", "North", "New Territories", 309631, 136.61, 22.4940, 114.1380),
    District("tai_po", "Tai Po", "New Territories", 316470, 136.15, 22.4510, 114.1640),
    District("sha_tin", "Sha Tin", "New Territories", 692806, 68.71, 22.3820, 114.1890),
    District("sai_kung", "Sai Kung", "New Territories", 489037, 129.65, 22.3810, 114.2710),
    District("islands", "Islands", "New Territories", 185282, 175.12, 22.2610, 113.9460),
]

DISTRICTS_BY_ID: Dict[str, District] = {d.id: d for d in DISTRICTS}

# Maximum population density across districts, used to normalise susceptibility.
_MAX_DENSITY = max(d.population_density for d in DISTRICTS)


def get_district(district_id: str) -> District:
    try:
        return DISTRICTS_BY_ID[district_id]
    except KeyError as exc:  # pragma: no cover - trivial
        raise KeyError(f"Unknown district id: {district_id!r}") from exc


@dataclass(frozen=True)
class Observation:
    """A day's environmental + epidemiological observation for one district."""

    district_id: str
    date: str  # ISO date (YYYY-MM-DD)
    pm25: float  # PM2.5, ug/m^3
    no2: float  # NO2, ug/m^3
    o3: float  # O3, ug/m^3
    temperature_c: float
    humidity_pct: float
    ili_rate: float  # influenza-like illness consultations per 1,000
    resp_admissions: float  # respiratory hospital admissions per 100,000

    def to_dict(self) -> Dict[str, object]:
        return {
            "district_id": self.district_id,
            "date": self.date,
            "pm25": round(self.pm25, 1),
            "no2": round(self.no2, 1),
            "o3": round(self.o3, 1),
            "temperature_c": round(self.temperature_c, 1),
            "humidity_pct": round(self.humidity_pct, 1),
            "ili_rate": round(self.ili_rate, 2),
            "resp_admissions": round(self.resp_admissions, 2),
        }


def _unit_seed(district_id: str, date: _dt.date) -> float:
    """Return a deterministic pseudo-random value in [0, 1) for a district/date."""
    key = f"{district_id}:{date.isoformat()}".encode("utf-8")
    digest = hashlib.sha256(key).hexdigest()
    # Use the first 8 hex chars as an integer, scaled to [0, 1).
    return int(digest[:8], 16) / 0xFFFFFFFF


def observe(district_id: str, date: _dt.date) -> Observation:
    """Generate a deterministic synthetic observation for a district and date.

    The value blends three coherent signals:
      * a per-district baseline driven by population density (a proxy for
        traffic and combustion sources),
      * a smooth seasonal term keyed on day-of-year, and
      * a bounded deterministic perturbation seeded on ``(district, date)``.
    """
    district = get_district(district_id)

    density_factor = district.population_density / _MAX_DENSITY  # 0..1
    doy = date.timetuple().tm_yday
    # Winter (northern-hemisphere) tends to have worse air + more respiratory illness.
    season = math.cos(2 * math.pi * (doy - 15) / 365.0)  # peaks ~mid-January
    noise = _unit_seed(district_id, date)  # 0..1
    noise2 = _unit_seed(district_id + "#b", date)  # independent stream

    pm25 = 8 + 34 * density_factor + 12 * max(season, 0) + 10 * noise
    no2 = 20 + 70 * density_factor + 15 * max(season, 0) + 18 * noise2
    o3 = 25 + 45 * (1 - density_factor) + 20 * max(-season, 0) + 12 * (1 - noise)

    temperature_c = 23 - 8 * season + 4 * (noise - 0.5)
    humidity_pct = 70 + 12 * math.sin(2 * math.pi * doy / 365.0) + 10 * (noise2 - 0.5)
    humidity_pct = min(99.0, max(35.0, humidity_pct))

    ili_rate = 3 + 6 * max(season, 0) + 3 * density_factor + 2.5 * noise
    resp_admissions = 1.5 + 5 * max(season, 0) + 3 * density_factor + 2 * noise2

    return Observation(
        district_id=district_id,
        date=date.isoformat(),
        pm25=pm25,
        no2=no2,
        o3=o3,
        temperature_c=temperature_c,
        humidity_pct=humidity_pct,
        ili_rate=ili_rate,
        resp_admissions=resp_admissions,
    )


def observe_series(district_id: str, end_date: _dt.date, days: int = 30) -> List[Observation]:
    """Return ``days`` consecutive observations ending on ``end_date`` (inclusive)."""
    if days < 1:
        raise ValueError("days must be >= 1")
    start = end_date - _dt.timedelta(days=days - 1)
    return [observe(district_id, start + _dt.timedelta(days=i)) for i in range(days)]
