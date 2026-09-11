import io

from backend.app import create_app


CSV = "facility_id,facility_name,unit_id,year,pollutant,emissions_tons\n123,North Plant,1,2023,CO2,12.5\n"


def test_preview_csv():
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})
    response = app.test_client().post(
        "/api/imports/preview",
        data={"file": (io.BytesIO(CSV.encode()), "sample.csv")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 201
    assert response.json["accepted_rows"] == 1
    assert response.json["rejected_rows"] == 0


def test_rejects_missing_columns():
    app = create_app({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})
    response = app.test_client().post(
        "/api/imports/preview",
        data={"file": (io.BytesIO(b"facility_id\n123\n"), "sample.csv")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 201
    assert response.json["issues"]
