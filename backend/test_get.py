"""Tests for dbManagement.search().  Run from the folder that contains `app/`:

    pip install pytest
    pytest test_get.py -v

Uses an in-memory SQLite DB, seeded with known data, so every expected value
below can be checked by hand.
"""
from datetime import datetime

import pytest

from app import createApp, db
from app import tables as t
from app import dbManagement as manage


# ---------------------------------------------------------------- fixtures
@pytest.fixture()
def ctx():
    app = createApp({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})
    with app.app_context():
        seed()
        yield
        db.session.remove()


def seed():
    db.session.add_all([
        t.Facility(id=1, name="Alpha Plant", state="TX", county="Harris", category="Coal"),
        t.Facility(id=2, name="Beta Plant", state="TX", county="Dallas", category="Gas"),
        t.Facility(id=3, name="Gamma Plant", state="CA", county="Kern", category="Gas"),
    ])
    db.session.flush()
    d = datetime(2000, 1, 1)
    db.session.add_all([
        t.Unit(key=1, facilityId=1, id="1", type="Boiler", primaryFuel="Coal", operatingDate=d),
        t.Unit(key=2, facilityId=2, id="1", type="Turbine", primaryFuel="Gas", operatingDate=d),
        t.Unit(key=3, facilityId=3, id="1", type="Turbine", primaryFuel="Gas", operatingDate=d),
    ])
    db.session.flush()

    # (facility, unit, year, co2)
    rows = [
        (1, 1, 2020, 100), (1, 1, 2021, 300),
        (2, 2, 2020, 200), (2, 2, 2021, 50),
        (3, 3, 2020, 400), (3, 3, 2021, 10),
    ]
    for fac, unit, yr, co2 in rows:
        db.session.add(t.AnnualRecord(facilityID=fac, unitId=unit, reportingYear=yr,
                                      massCo2=co2, programCode="ARP"))
    db.session.commit()


def co2(rows):
    return [r["co2"] for r in rows]


# ------------------------------------------------------------ plain / where
def test_no_filters_returns_everything(ctx):
    assert len(manage.search()) == 6


def test_equals(ctx):
    rows = manage.search(filters={"args": [{"field": "year", "op": "=", "value": 2020}]})
    assert sorted(co2(rows)) == [100, 200, 400]


@pytest.mark.parametrize("op,val,expected", [
    (">", 200, [300, 400]),
    (">=", 200, [200, 300, 400]),
    ("<", 50, [10]),
    ("<=", 50, [10, 50]),
    ("!=", 100, [10, 50, 200, 300, 400]),
])
def test_comparison_operators(ctx, op, val, expected):
    rows = manage.search(filters={"args": [{"field": "co2", "op": op, "value": val}]})
    print(rows)
    assert sorted(co2(rows)) == expected


def test_unicode_operators(ctx):
    rows = manage.search(filters={"args": [{"field": "co2", "operator": "≥", "value": 300}]})
    assert sorted(co2(rows)) == [300, 400]


def test_in_and_not_in(ctx):
    a = manage.search(filters={"args": [{"field": "co2", "op": "in", "value": [10, 50]}]})
    b = manage.search(filters={"args": [{"field": "co2", "op": "not_in", "value": [10, 50]}]})
    assert sorted(co2(a)) == [10, 50]
    assert len(b) == 4


def test_multiple_args_are_anded(ctx):
    rows = manage.search(filters={"args": [
        {"field": "year", "op": "=", "value": 2021},
        {"field": "co2", "op": ">", "value": 20},
    ]})
    assert sorted(co2(rows)) == [50, 300]


def test_text_operators_on_another_model(ctx):
    f = lambda op, v: [r["Facility"].name for r in manage.search({"args": [{"field": "facility_name", "op": op, "value": v}]})]
    assert f("contains", "eta") == ["Beta Plant"]          # case-insensitive
    assert f("starts_with", "gam") == ["Gamma Plant"]
    assert sorted(f("ends_with", "plant")) == ["Alpha Plant", "Beta Plant", "Gamma Plant"]


def test_no_match_returns_empty(ctx):
    assert manage.search(filters={"args": [{"field": "co2", "op": ">", "value": 10**9}]}) == []


def test_bad_operator_raises(ctx):
    with pytest.raises(ValueError):
        manage.search(filters={"args": [{"field": "co2", "op": "~~", "value": 1}]})


def test_bad_field_raises(ctx):
    with pytest.raises(AttributeError):
        manage.search(filters={"args": [{"field": "nope", "op": "=", "value": 1}]})


# ------------------------------------------------------------------- limit
def test_n_limits(ctx):
    assert len(manage.search(filters={"format": {"n": 2}})) == 2


def test_n_zero_and_negative(ctx):
    assert manage.search(filters={"format": {"n": 0}}) == []
    with pytest.raises(ValueError):
        manage.search(filters={"format": {"n": -1}})


# -------------------------------------------------------------------- rank
def test_rank_top_orders_desc(ctx):
    rows = manage.search(filters={"format": {"rank": {"direction": "top", "metric": "co2"}, "n": 3}})
    print(rows)
    assert co2(rows) == [400, 300, 200]


def test_rank_bottom_orders_asc(ctx):
    rows = manage.search(filters={"format": {"rank": {"direction": "bottom", "metric": "co2"}, "n": 3}})
    assert co2(rows) == [10, 50, 100]


def test_rank_bad_direction(ctx):
    with pytest.raises(ValueError):
        manage.search(filters={"format": {"rank": {"direction": "sideways", "metric": "co2"}}})


# ------------------------------------------------------------------- group
def test_group_sum(ctx):
    rows = manage.search(filters={"format": {"group": {
        "by": "year", "aggregate": [["sum", "co2"]]}}})
    got = {r["year"]: r["sum_co2"] for r in rows}
    assert got == {2020: 700, 2021: 360}


@pytest.mark.parametrize("agg,expected", [("max", 400), ("min", 100), ("cnt", 3), ("avg", 700 / 3)])
def test_group_other_aggregates(ctx, agg, expected):
    rows = manage.search(filters={
        "args": [{"field": "year", "op": "=", "value": 2020}],
        "format": {"group": {"by": ["year"], "aggregate": [[agg, "co2"]]}}})
    assert rows[0][f"{agg}_co2"] == pytest.approx(expected)


def test_group_without_by_raises(ctx):
    with pytest.raises(ValueError):
        manage.search(filters={"format": {"group": {"aggregate": [["sum", "co2"]]}}})


def test_bad_aggregate_raises(ctx):
    with pytest.raises(LookupError):
        manage.search(filters={"format": {"group": {"by": "year", "aggregate": [["median", "co2"]]}}})


# ------------------------------------------------ rank n WITHIN each group
def test_top_n_per_group(ctx):
    """Top 1 AnnualRecord per year by CO2 -> 2020: 400, 2021: 300."""
    rows = manage.search(filters={"format": {
        "group": {"by": "year"},
        "rank": {"direction": "top", "metric": "co2", "n": 1}}})
    got = {r["year"]: r["co2"] for r in rows}
    assert got == {2020: 400, 2021: 300}


def test_bottom_2_per_group(ctx):
    rows = manage.search(filters={"format": {
        "group": {"by": "year"},
        "rank": {"direction": "bottom", "metric": "co2", "n": 2}}})
    assert sorted((r["year"], r["co2"]) for r in rows) == \
        [(2020, 100), (2020, 200), (2021, 10), (2021, 50)]


def test_filter_then_rank_per_group(ctx):
    """WHERE must apply before ranking."""
    rows = manage.search(filters={
        "args": [{"field": "co2", "op": "<", "value": 400}],
        "format": {"group": {"by": "year"},
                   "rank": {"direction": "top", "metric": "co2", "n": 1}}})
    assert {r["year"]: r["co2"] for r in rows} == {2020: 200, 2021: 300}


# ----------------------------------------------------- other models smoke
@pytest.mark.parametrize("model,count", [(t.Facility, 3), (t.Unit, 3), (t.AnnualRecord, 6), (t.Dataset, 0)])
def test_every_model_runs_unfiltered(ctx, model, count):
    assert len(manage.search(model)) == count
