# Import Dependencies
from datetime import datetime, timezone
from app import db

# 4 Required Tables from Assignment Description
class Dataset(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String, unique=True)
    source = db.Column(db.String, nullable=False)
    reportingYears = db.Column(db.JSON, nullable=False)
    date = db.Column(db.DateTime, default=datetime.now(timezone.utc))
    fileName = db.Column(db.String, nullable=False)
    rawRecords = db.Column(db.Integer, nullable=False)
    acceptedRecords = db.Column(db.Integer)
    notes = db.Column(db.String, default='')

class Facility(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String, unique=True)
    state = db.Column(db.String, nullable=False)
    county = db.Column(db.String, nullable=False)
    latitude = db.Column(db.Double)
    longitude = db.Column(db.Double)
    category = db.Column(db.String, nullable=False)

class Unit(db.Model):
    key = db.Column(db.Integer, primary_key=True)
    facilityId = db.Column(db.Integer, db.ForeignKey(Facility.id), nullable=False)
    id = db.Column(db.String, nullable=False)
    type = db.Column(db.String, nullable=False)
    primaryFuel = db.Column(db.String, nullable=False)
    secondaryFuel = db.Column(db.String)
    operatingDate = db.Column(db.DateTime, nullable=False)
    retirementDate = db.Column(db.DateTime, default=None)
    __table_args__ = (db.UniqueConstraint(facilityId, id, name='facility-id-pair'),)

class AnnualRecord(db.Model):
    # Append FacilityID and UnitID as Foreign Keys To Assure One annualRecord per truple
    facilityID = db.Column(db.Integer, db.ForeignKey(Facility.id), primary_key=True, nullable=False)
    unitId = db.Column(db.Integer, db.ForeignKey(Unit.key), primary_key=True, nullable=False)

    reportingYear = db.Column(db.Integer, primary_key=True, nullable=False)
    operatingTime = db.Column(db.Double)
    grossLoad = db.Column(db.Double, default=0)
    steamLoad = db.Column(db.Double, default=0)
    heatInput = db.Column(db.Double, default=0)
    massCo2 = db.Column(db.Double, default=0)
    massSo2 = db.Column(db.Double, default=0)
    massNox = db.Column(db.Double, default=0)
    so2ControlInfo = db.Column(db.String)
    noxControlInfo = db.Column(db.String)
    pmControlInfo = db.Column(db.String)
    programCode = db.Column(db.String, nullable=False)