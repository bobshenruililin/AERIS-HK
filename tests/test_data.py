import datetime as dt

import pytest

from aeris_hk import data


def test_eighteen_districts_with_unique_ids():
    assert len(data.DISTRICTS) == 18
    ids = [d.id for d in data.DISTRICTS]
    assert len(set(ids)) == 18


def test_population_density_positive():
    for d in data.DISTRICTS:
        assert d.population_density > 0


def test_observation_is_deterministic():
    date = dt.date(2025, 1, 15)
    a = data.observe("kwun_tong", date)
    b = data.observe("kwun_tong", date)
    assert a == b


def test_observations_differ_across_districts():
    date = dt.date(2025, 1, 15)
    a = data.observe("islands", date)
    b = data.observe("kwun_tong", date)
    assert a.pm25 != b.pm25


def test_observation_values_are_plausible():
    obs = data.observe("sha_tin", dt.date(2025, 6, 1))
    assert 0 < obs.pm25 < 120
    assert 0 < obs.no2 < 200
    assert 0 < obs.o3 < 150
    assert 35 <= obs.humidity_pct <= 99
    assert obs.ili_rate >= 0
    assert obs.resp_admissions >= 0


def test_series_length_and_ordering():
    end = dt.date(2025, 3, 31)
    series = data.observe_series("eastern", end, days=30)
    assert len(series) == 30
    assert series[-1].date == end.isoformat()
    assert series[0].date == (end - dt.timedelta(days=29)).isoformat()


def test_unknown_district_raises():
    with pytest.raises(KeyError):
        data.get_district("atlantis")


def test_series_rejects_bad_days():
    with pytest.raises(ValueError):
        data.observe_series("eastern", dt.date(2025, 1, 1), days=0)
