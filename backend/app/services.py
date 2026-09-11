from io import BytesIO

import pandas as pd

REQUIRED_COLUMNS = {"facility_id", "facility_name", "unit_id", "year", "pollutant", "emissions_tons"}
ALIASES = {
    "oris_facility_code": "facility_id",
    "facility": "facility_name",
    "unit": "unit_id",
    "reporting_year": "year",
    "co2_tons": "emissions_tons",
}


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
