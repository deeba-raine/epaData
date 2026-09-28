from io import BytesIO
import os
import time

import pandas as pd
import requests

REQUIRED_COLUMNS = {"facility_id", "facility_name", "unit_id", "year", "pollutant", "emissions_tons"}
ALIASES = {
    "oris_facility_code": "facility_id",
    "facility": "facility_name",
    "unit": "unit_id",
    "reporting_year": "year",
    "co2_tons": "emissions_tons",
    "state_code": "state",
    "primary_fuel": "fuel_type",
    "operating_time": "operating_hours",
    "mass_co2": "co2_tons",
    "mass_so2": "so2_tons",
    "mass_nox": "nox_tons",
}


class EPAClient:
    """Small, bounded-retry client for the EPA EASEY endpoints."""

    base_url = "https://api.epa.gov/easey"

    def __init__(self, api_key=None, session=None, max_retries=3, wait_seconds=10):
        self.api_key = api_key or os.getenv("EPA_KEY")
        self.session = session or requests
        self.max_retries = max_retries
        self.wait_seconds = wait_seconds

    def get_facility(self, facility_id, year):
        return self._get(
            "/facilities-mgmt/facilities/attributes",
            {"facilityId": facility_id, "year": year, "perPage": 500},
        )

    def _get(self, path, params):
        if not self.api_key:
            raise RuntimeError("EPA_KEY is required for EPA facility lookups")
        params = {**params, "api_key": self.api_key}
        for attempt in range(self.max_retries + 1):
            response = self.session.get(self.base_url + path, params=params, timeout=30)
            if response.status_code == 429 and attempt < self.max_retries:
                retry_after = response.headers.get("Retry-After")
                delay = float(retry_after) if retry_after and retry_after.isdigit() else self.wait_seconds
                time.sleep(delay)
                continue
            if response.status_code == 200:
                return response.json()
            if response.status_code == 400:
                raise ValueError("EPA rejected the facility lookup")
            if response.status_code == 404:
                raise LookupError("Facility was not found in the EPA API")
            if response.status_code == 429:
                raise RuntimeError("EPA rate limit exceeded; try again later")
            raise RuntimeError(f"EPA request failed with status {response.status_code}")
        raise RuntimeError("EPA request failed after retries")


def read_upload(filename, content):
    if filename.lower().endswith(".csv"):
        return pd.read_csv(BytesIO(content))
    if filename.lower().endswith((".xlsx", ".xls")):
        return pd.read_excel(BytesIO(content))
    raise ValueError("Only CSV and Excel files are supported")


def validate_frame(frame):
    normalized = frame.copy()
    normalized.columns = [str(column).strip().lower().replace(" ", "_") for column in normalized.columns]
    normalized = normalized.rename(columns=ALIASES)
    issues = []
    missing = sorted(REQUIRED_COLUMNS - set(normalized.columns))
    for column in missing:
        issues.append({"row": 0, "field": column, "message": "Required column is missing"})

    if missing:
        return normalized, issues

    for row_index, row in normalized.iterrows():
        row_number = int(row_index) + 2
        for field in ("facility_id", "facility_name", "unit_id", "pollutant"):
            if pd.isna(row[field]) or str(row[field]).strip() == "":
                issues.append({"row": row_number, "field": field, "message": "Value is required"})
        for field in ("year", "emissions_tons"):
            if pd.isna(row[field]):
                issues.append({"row": row_number, "field": field, "message": "Value is required"})
            elif not _is_number(row[field]):
                issues.append({"row": row_number, "field": field, "message": "Value must be numeric"})
        if _is_number(row.get("year")) and not 1900 <= int(float(row["year"])) <= 2100:
            issues.append({"row": row_number, "field": "year", "message": "Year is outside supported range"})

    duplicate_columns = ["facility_id", "unit_id", "year", "pollutant"]
    duplicates = normalized.duplicated(subset=duplicate_columns, keep=False)
    for row_index in normalized.index[duplicates]:
        issues.append({"row": int(row_index) + 2, "field": "record", "message": "Duplicate record key"})
    return normalized, issues


def _is_number(value):
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def import_records(frame, dataset, client):
    """Persist valid rows and retrieve missing facility/unit metadata."""
    from backend.app import db
    from backend.app.models import AnnualRecord, Facility, GeneratingUnit

    normalized, issues = validate_frame(frame)
    if issues:
        return 0, issues
    accepted = 0
    years = set()
    for _, row in normalized.iterrows():
        facility = Facility.query.filter_by(facility_id=str(row["facility_id"])).first()
        api_items = []
        if facility is None or not facility.county:
            payload = client.get_facility(str(row["facility_id"]), int(row["year"]))
            api_items = payload.get("items", []) if isinstance(payload, dict) else []
            match = next(
                (item for item in api_items if str(item.get("unitId", "")) == str(row["unit_id"])),
                api_items[0] if api_items else None,
            )
            if match is None:
                raise LookupError(f"Unit {row['unit_id']} was not found for facility {row['facility_id']}")
            if facility is None:
                facility = Facility(facility_id=str(row["facility_id"]), name=str(row["facility_name"]))
                db.session.add(facility)
            facility.state = _text(row.get("state"))
            facility.county = _text(match.get("county"))
            facility.latitude = _number(match.get("latitude"))
            facility.longitude = _number(match.get("longitude"))
            facility.category = _text(match.get("sourceCategory"))
        unit = GeneratingUnit.query.filter_by(facility=facility, unit_id=str(row["unit_id"])).first()
        if unit is None:
            payload = client.get_facility(str(row["facility_id"]), int(row["year"]))
            item = next((x for x in payload.get("items", []) if str(x.get("unitId")) == str(row["unit_id"])), None)
            if item is None:
                raise LookupError(f"Unit {row['unit_id']} was not found for facility {row['facility_id']}")
            unit = GeneratingUnit(facility=facility, unit_id=str(row["unit_id"]))
            unit.fuel_type = _text(row.get("fuel_type")) or _text(item.get("primaryFuel"))
            unit.secondary_fuel = _text(row.get("secondary_fuel"))
            unit.operating_date = _date(item.get("commercialOperationDate"))
            db.session.add(unit)
            db.session.flush()
        record = AnnualRecord.query.filter_by(
            unit=unit, year=int(row["year"]), pollutant=str(row["pollutant"])
        ).first()
        if record is None:
            record = AnnualRecord(unit=unit, year=int(row["year"]), pollutant=str(row["pollutant"]))
            db.session.add(record)
        record.emissions_tons = _number(row.get("emissions_tons"))
        record.generation_mwh = _number(row.get("generation_mwh"))
        record.operating_hours = _number(row.get("operating_hours"))
        record.mass_co2 = _number(row.get("co2_tons"))
        record.mass_so2 = _number(row.get("so2_tons"))
        record.mass_nox = _number(row.get("nox_tons"))
        record.program_code = _text(row.get("program_code"))
        years.add(int(row["year"]))
        accepted += 1
    dataset.reporting_years = sorted(years)
    dataset.raw_records = len(normalized)
    dataset.accepted_records = accepted
    db.session.commit()
    return accepted, []


def _text(value):
    return None if pd.isna(value) else str(value).strip()


def _number(value):
    return None if value is None or pd.isna(value) else float(value)


def _date(value):
    if value is None or pd.isna(value):
        return None
    return pd.to_datetime(value).date()
