"""Composite atmospheric & epidemiological risk inference model.

The model turns a single :class:`~aeris_hk.data.Observation` into an interpretable
0-100 risk index. It is intentionally transparent (a documented weighted blend of
normalised sub-indices) rather than an opaque black box, so results are auditable
and unit-testable. The reference thresholds are loosely based on WHO air-quality
guideline values; they are not clinical advice.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict

from .data import District, Observation, get_district

# Reference concentrations (ug/m^3) at which a pollutant contributes ~"1 unit"
# of hazard. Loosely aligned with WHO 24-hour guideline magnitudes.
_PM25_REF = 25.0
_NO2_REF = 40.0
_O3_REF = 60.0

# Reference epidemiological burdens contributing ~"1 unit" of hazard.
_ILI_REF = 9.0  # consultations per 1,000
_RESP_REF = 6.0  # admissions per 100,000

# Blend weights for the final composite index (must sum to 1.0).
_W_AIR = 0.5
_W_EPI = 0.35
_W_SUSCEPT = 0.15

RISK_BANDS = [
    (0, 25, "Low"),
    (25, 50, "Moderate"),
    (50, 75, "High"),
    (75, 101, "Very High"),
]


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, value))


def air_quality_subindex(obs: Observation) -> float:
    """Return a 0-1 air-quality hazard sub-index for an observation.

    PM2.5 is weighted most heavily, consistent with its dominant role in the
    health burden literature.
    """
    pm = _clamp(obs.pm25 / (2 * _PM25_REF))
    no2 = _clamp(obs.no2 / (2 * _NO2_REF))
    o3 = _clamp(obs.o3 / (2 * _O3_REF))
    return _clamp(0.55 * pm + 0.25 * no2 + 0.20 * o3)


def epidemiological_subindex(obs: Observation) -> float:
    """Return a 0-1 epidemiological burden sub-index for an observation."""
    ili = _clamp(obs.ili_rate / (2 * _ILI_REF))
    resp = _clamp(obs.resp_admissions / (2 * _RESP_REF))
    return _clamp(0.6 * ili + 0.4 * resp)


def susceptibility_subindex(district: District) -> float:
    """Return a 0-1 structural-susceptibility sub-index for a district.

    Uses population density (log-scaled) as a proxy for exposure concentration
    and contact intensity.
    """
    import math

    # Log-scale density between ~1k and ~60k people/km^2.
    density = district.population_density
    scaled = (math.log10(max(density, 1.0)) - 3.0) / (math.log10(60000.0) - 3.0)
    return _clamp(scaled)


def band_for(index: float) -> str:
    for low, high, label in RISK_BANDS:
        if low <= index < high:
            return label
    return RISK_BANDS[-1][2]


@dataclass(frozen=True)
class RiskResult:
    district_id: str
    date: str
    risk_index: float  # 0-100
    band: str
    air_subindex: float  # 0-100
    epi_subindex: float  # 0-100
    susceptibility_subindex: float  # 0-100

    def to_dict(self) -> Dict[str, object]:
        return {
            "district_id": self.district_id,
            "date": self.date,
            "risk_index": round(self.risk_index, 1),
            "band": self.band,
            "air_subindex": round(self.air_subindex, 1),
            "epi_subindex": round(self.epi_subindex, 1),
            "susceptibility_subindex": round(self.susceptibility_subindex, 1),
        }


def infer_risk(obs: Observation, district: District | None = None) -> RiskResult:
    """Infer the composite risk for an observation.

    The atmospheric and epidemiological hazards are amplified by structural
    susceptibility (crowding), reflecting that the same pollution/illness load
    translates to greater population risk in denser districts.
    """
    district = district or get_district(obs.district_id)

    air = air_quality_subindex(obs)
    epi = epidemiological_subindex(obs)
    suscept = susceptibility_subindex(district)

    # Susceptibility acts both as its own term and as a mild amplifier (up to 20%).
    amplifier = 1.0 + 0.2 * suscept
    composite = amplifier * (_W_AIR * air + _W_EPI * epi + _W_SUSCEPT * suscept)
    risk_index = _clamp(composite) * 100.0

    return RiskResult(
        district_id=obs.district_id,
        date=obs.date,
        risk_index=risk_index,
        band=band_for(risk_index),
        air_subindex=air * 100.0,
        epi_subindex=epi * 100.0,
        susceptibility_subindex=suscept * 100.0,
    )
