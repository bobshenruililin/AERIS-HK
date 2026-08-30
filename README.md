# AERIS-HK

**Atmospheric & Epidemiological Risk Inference System — Hong Kong**

AERIS-HK combines atmospheric observations (PM2.5, NO₂, O₃) with epidemiological
signals (influenza-like-illness consultation rates and respiratory hospital
admissions) to infer a transparent, auditable **composite health-risk index**
for each of Hong Kong's 18 districts. It ships a FastAPI backend and a
self-contained web dashboard.

> Observations are currently generated deterministically from a `(district, date)`
> seed so the whole system is reproducible and runs fully offline. Swapping in
> live feeds (e.g. HK EPD air quality, CHP surveillance) only requires replacing
> `aeris_hk.data.observe`. Risk indices are model estimates, not clinical advice.

## Architecture

| Layer | Location | Responsibility |
| --- | --- | --- |
| Reference + data | `aeris_hk/data.py` | 18-district geography and deterministic synthetic observations |
| Risk model | `aeris_hk/model.py` | Transparent weighted blend of air, epidemiological, and susceptibility sub-indices |
| API | `aeris_hk/api.py` | FastAPI endpoints + serves the dashboard |
| Dashboard | `static/` | Vanilla-JS UI with SVG charts (no external CDNs) |
| Tests | `tests/` | `pytest` coverage for data, model, and API |

## Quick start

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/python -m aeris_hk.main          # serves on http://localhost:8000
```

Open <http://localhost:8000> for the dashboard.

### Run the tests

```bash
.venv/bin/python -m pytest
```

## API

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | Liveness/version probe |
| GET | `/api/districts` | 18 districts with population, area, density, centroid |
| GET | `/api/risk?date=YYYY-MM-DD` | Risk snapshot for all districts (sorted high→low) |
| GET | `/api/summary?date=YYYY-MM-DD` | Population-weighted territory summary |
| GET | `/api/risk/{district_id}?date=&days=` | District detail with an N-day time series |
| GET | `/` | Interactive dashboard |

## Risk model

The composite index (0–100) is:

```
amplifier = 1 + 0.2 · susceptibility
risk = 100 · clamp(amplifier · (0.50·air + 0.35·epi + 0.15·susceptibility))
```

Sub-indices are normalised against WHO-guideline-scale references
(`aeris_hk/model.py`). Bands: **Low** 0–25, **Moderate** 25–50, **High** 50–75,
**Very High** 75–100.

## Cloud Agent environment

`.cursor/environment.json` provisions a Python virtual environment during
`install` and runs the API in the `api` terminal on port `8000`.
