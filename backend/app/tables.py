# Import Dependencies
from datetime import datetime, timezone
from . import db

# 4 Required Tables from Assignment Description
class Dataset(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String, unique=True, index=True)
    source = db.Column(db.String, nullable=False)
    reportingYears = db.Column(db.JSON, nullable=False)
    date = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))
    fileName = db.Column(db.String, nullable=False)
    rawRecords = db.Column(db.Integer, nullable=False)
    acceptedRecords = db.Column(db.Integer)
    notes = db.Column(db.String, default='')

class Facility(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String, index=True)
    state = db.Column(db.String, nullable=False, index=True)
    county = db.Column(db.String, nullable=False)
    latitude = db.Column(db.Double)
    longitude = db.Column(db.Double)
    category = db.Column(db.String, nullable=False)

class Unit(db.Model):
    key = db.Column(db.Integer, primary_key=True)
    facilityId = db.Column(db.Integer, db.ForeignKey(Facility.id), nullable=False)
    id = db.Column(db.String, nullable=False, index=True)
    type = db.Column(db.String, nullable=False)
    primaryFuel = db.Column(db.String, nullable=False, index=True)
    secondaryFuel = db.Column(db.String)
    operatingDate = db.Column(db.DateTime, nullable=False)
    retirementDate = db.Column(db.DateTime, default=None)
    __table_args__ = (db.UniqueConstraint(facilityId, id, name='facility-id-pair'),)

class AnnualRecord(db.Model):
    # Append FacilityID and UnitID as Foreign Keys To Assure One annualRecord per truple
    facilityID = db.Column(db.Integer, db.ForeignKey(Facility.id), primary_key=True, nullable=False)
    unitId = db.Column(db.Integer, db.ForeignKey(Unit.key), primary_key=True, nullable=False)

    # Link Annual Record to the Dataset that Imported it
    source = db.Column(db.String, db.ForeignKey(Dataset.name), nullable=False)

    reportingYear = db.Column(db.Integer, primary_key=True, nullable=False)
    operatingTime = db.Column(db.Double)
    grossLoad = db.Column(db.Double)
    steamLoad = db.Column(db.Double)
    heatInput = db.Column(db.Double)
    massCo2 = db.Column(db.Double, index=True)
    massSo2 = db.Column(db.Double, index=True)
    massNox = db.Column(db.Double)
    so2ControlInfo = db.Column(db.String)
    noxControlInfo = db.Column(db.String)
    pmControlInfo = db.Column(db.String)
    programCode = db.Column(db.String, nullable=False)