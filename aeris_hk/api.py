"""FastAPI application exposing AERIS-HK data, risk inference, and the dashboard."""

from __future__ import annotations

import datetime as _dt
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import __version__, data, model

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


def _parse_date(value: Optional[str]) -> _dt.date:
    if value is None:
        return _dt.date.today()
    try:
        return _dt.date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid date: {value!r} (expected YYYY-MM-DD)") from exc


def create_app() -> FastAPI:
    app = FastAPI(
        title="AERIS-HK",
        description="Atmospheric & Epidemiological Risk Inference System — Hong Kong",
        version=__version__,
    )

    @app.get("/api/health")
    def health() -> dict:
        return {"status": "ok", "service": "aeris-hk", "version": __version__}

    @app.get("/api/districts")
    def list_districts() -> dict:
        return {"count": len(data.DISTRICTS), "districts": [d.to_dict() for d in data.DISTRICTS]}

    @app.get("/api/risk")
    def risk_snapshot(date: Optional[str] = Query(default=None, description="ISO date, defaults to today")) -> dict:
        """Territory-wide risk snapshot: one risk result per district for a date."""
        target = _parse_date(date)
        results = []
        for district in data.DISTRICTS:
            obs = data.observe(district.id, target)
            results.append(model.infer_risk(obs, district).to_dict())
        results.sort(key=lambda r: r["risk_index"], reverse=True)
        return {"date": target.isoformat(), "count": len(results), "results": results}

    @app.get("/api/summary")
    def summary(date: Optional[str] = Query(default=None)) -> dict:
        """Aggregate, population-weighted risk summary for the territory."""
        target = _parse_date(date)
        indices: List[float] = []
        weighted_num = 0.0
        weighted_den = 0.0
        band_counts = {label: 0 for _, _, label in model.RISK_BANDS}
        worst = None
        for district in data.DISTRICTS:
            obs = data.observe(district.id, target)
            res = model.infer_risk(obs, district)
            indices.append(res.risk_index)
            weighted_num += res.risk_index * district.population
            weighted_den += district.population
            band_counts[res.band] += 1
            if worst is None or res.risk_index > worst["risk_index"]:
                worst = {"district_id": district.id, "name": district.name, "risk_index": round(res.risk_index, 1), "band": res.band}
        return {
            "date": target.isoformat(),
            "mean_risk_index": round(sum(indices) / len(indices), 1),
            "population_weighted_risk_index": round(weighted_num / weighted_den, 1),
            "max_risk_index": round(max(indices), 1),
            "min_risk_index": round(min(indices), 1),
            "band_counts": band_counts,
            "highest_risk_district": worst,
        }

    @app.get("/api/risk/{district_id}")
    def district_detail(
        district_id: str,
        date: Optional[str] = Query(default=None),
        days: int = Query(default=30, ge=1, le=120),
    ) -> dict:
        """Detailed time series (observations + inferred risk) for one district."""
        try:
            district = data.get_district(district_id)
        except KeyError:
            raise HTTPException(status_code=404, detail=f"Unknown district: {district_id!r}")
        target = _parse_date(date)
        series = data.observe_series(district_id, target, days=days)
        history = []
        for obs in series:
            res = model.infer_risk(obs, district)
            history.append({"observation": obs.to_dict(), "risk": res.to_dict()})
        return {
            "district": district.to_dict(),
            "date": target.isoformat(),
            "days": days,
            "current": history[-1],
            "history": history,
        }

    if _STATIC_DIR.is_dir():
        @app.get("/")
        def index() -> FileResponse:
            return FileResponse(_STATIC_DIR / "index.html")

        app.mount("/static", StaticFiles(directory=str(_STATIC_DIR)), name="static")

    return app


app = create_app()
