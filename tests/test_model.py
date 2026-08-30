import datetime as dt

from aeris_hk import data, model


def test_subindices_are_bounded():
    obs = data.observe("kwun_tong", dt.date(2025, 1, 15))
    assert 0.0 <= model.air_quality_subindex(obs) <= 1.0
    assert 0.0 <= model.epidemiological_subindex(obs) <= 1.0
    d = data.get_district("kwun_tong")
    assert 0.0 <= model.susceptibility_subindex(d) <= 1.0


def test_risk_index_range_and_band():
    obs = data.observe("sha_tin", dt.date(2025, 1, 15))
    res = model.infer_risk(obs)
    assert 0.0 <= res.risk_index <= 100.0
    assert res.band in {"Low", "Moderate", "High", "Very High"}


def test_band_boundaries():
    assert model.band_for(0) == "Low"
    assert model.band_for(24.9) == "Low"
    assert model.band_for(25) == "Moderate"
    assert model.band_for(49.9) == "Moderate"
    assert model.band_for(50) == "High"
    assert model.band_for(74.9) == "High"
    assert model.band_for(75) == "Very High"
    assert model.band_for(100) == "Very High"


def test_higher_pollution_yields_higher_risk():
    d = data.get_district("central_western")
    base = data.observe("central_western", dt.date(2025, 6, 1))
    dirty = data.Observation(
        district_id=base.district_id,
        date=base.date,
        pm25=base.pm25 + 40,
        no2=base.no2 + 40,
        o3=base.o3 + 30,
        temperature_c=base.temperature_c,
        humidity_pct=base.humidity_pct,
        ili_rate=base.ili_rate,
        resp_admissions=base.resp_admissions,
    )
    assert model.infer_risk(dirty, d).risk_index > model.infer_risk(base, d).risk_index


def test_denser_district_more_susceptible():
    dense = data.get_district("kwun_tong")
    sparse = data.get_district("islands")
    assert model.susceptibility_subindex(dense) > model.susceptibility_subindex(sparse)


def test_result_serialisation():
    obs = data.observe("eastern", dt.date(2025, 1, 15))
    d = model.infer_risk(obs).to_dict()
    assert set(d) >= {"district_id", "risk_index", "band", "air_subindex", "epi_subindex", "susceptibility_subindex"}
