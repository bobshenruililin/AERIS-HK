from fastapi.testclient import TestClient

from aeris_hk.api import create_app

client = TestClient(create_app())


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_districts():
    r = client.get("/api/districts")
    assert r.status_code == 200
    body = r.json()
    assert body["count"] == 18
    assert len(body["districts"]) == 18


def test_risk_snapshot_sorted_desc():
    r = client.get("/api/risk?date=2025-01-15")
    assert r.status_code == 200
    results = r.json()["results"]
    assert len(results) == 18
    indices = [x["risk_index"] for x in results]
    assert indices == sorted(indices, reverse=True)


def test_summary_fields():
    r = client.get("/api/summary?date=2025-01-15")
    assert r.status_code == 200
    body = r.json()
    for key in ("mean_risk_index", "population_weighted_risk_index", "band_counts", "highest_risk_district"):
        assert key in body
    assert sum(body["band_counts"].values()) == 18


def test_district_detail():
    r = client.get("/api/risk/sha_tin?date=2025-01-15&days=14")
    assert r.status_code == 200
    body = r.json()
    assert body["district"]["id"] == "sha_tin"
    assert body["days"] == 14
    assert len(body["history"]) == 14
    assert body["current"] == body["history"][-1]


def test_unknown_district_404():
    r = client.get("/api/risk/atlantis")
    assert r.status_code == 404


def test_bad_date_400():
    r = client.get("/api/risk?date=not-a-date")
    assert r.status_code == 400


def test_dashboard_served():
    r = client.get("/")
    assert r.status_code == 200
    assert "AERIS" in r.text
