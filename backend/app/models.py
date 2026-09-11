from datetime import datetime

from backend.app import db


class DataSource(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(120), nullable=False, unique=True)
    description = db.Column(db.Text)


class Dataset(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(160), nullable=False)
    source_id = db.Column(db.Integer, db.ForeignKey("data_source.id"), nullable=False)
    source = db.relationship("DataSource", backref="datasets")


class ImportJob(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    dataset_id = db.Column(db.Integer, db.ForeignKey("dataset.id"), nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    status = db.Column(db.String(30), nullable=False, default="preview")
    accepted_rows = db.Column(db.Integer, default=0)
    rejected_rows = db.Column(db.Integer, default=0)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    dataset = db.relationship("Dataset", backref="imports")


class ImportIssue(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    import_job_id = db.Column(db.Integer, db.ForeignKey("import_job.id"), nullable=False)
    row_number = db.Column(db.Integer, nullable=False)
    field = db.Column(db.String(120))
    message = db.Column(db.String(500), nullable=False)
    import_job = db.relationship("ImportJob", backref="issues")


class Facility(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    facility_id = db.Column(db.String(40), nullable=False, unique=True)
    name = db.Column(db.String(200), nullable=False)
    state = db.Column(db.String(2))
    city = db.Column(db.String(120))


class GeneratingUnit(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    facility_id = db.Column(db.Integer, db.ForeignKey("facility.id"), nullable=False)
    unit_id = db.Column(db.String(40), nullable=False)
    fuel_type = db.Column(db.String(80))
    facility = db.relationship("Facility", backref="units")
    __table_args__ = (db.UniqueConstraint("facility_id", "unit_id", name="uq_facility_unit"),)


class AnnualRecord(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    unit_id = db.Column(db.Integer, db.ForeignKey("generating_unit.id"), nullable=False)
    year = db.Column(db.Integer, nullable=False)
    pollutant = db.Column(db.String(40), nullable=False)
    emissions_tons = db.Column(db.Float)
    generation_mwh = db.Column(db.Float)
    operating_hours = db.Column(db.Float)
    unit = db.relationship("GeneratingUnit", backref="annual_records")
    __table_args__ = (
        db.UniqueConstraint("unit_id", "year", "pollutant", name="uq_unit_year_pollutant"),
    )
