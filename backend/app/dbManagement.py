# Import Depenedencies
from datetime import datetime, timezone
import app.tables as table
import app.camApi as cam
import pandas as pd
from app import db
import json

def sessionFin():
    # Just a Public Commit Function
    db.session.commit()
    return

def sessionEnd():
    # Just a Public Rollback Function
    db.session.rollback()
    return

def createDataset(attributes: list):
    # Create Dataset Object Using Attributes
    item = table.Dataset(
        name = attributes[0],
        source = attributes[1],
        reportingYears = attributes[2],
        date = datetime.now(timezone.utc),
        fileName = attributes[3],
        rawRecords = attributes[4],
        acceptedRecords = attributes[5],
        notes = attributes[6]
    )

    # Push Object and Commit to Session
    db.session.add(item)
    db.session.flush()

    # Dataset Always Commits
    db.session.commit()
    return

def createFac(row: tuple) -> bool:
    # Retrieve Factory Data Using API
    info = cam.retrFacility({'facilityId': getattr(row, '_3'), 'year': getattr(row, 'Year'), 'page': 1})
    data = json.loads(info.text[10:-2])

    # Create Facility Object Using tables import
    item = table.Facility(
        id=getattr(row, '_3'),
        name=getattr(row, '_2'),
        state=getattr(row, 'State'),
        county=data['county'],
        latitude=data['latitude'],
        longitude=data['longitude'],
        category=data['sourceCategory']
    )

    # Push Object To Session
    db.session.add(item)
    db.session.flush()
    return True

def createFacScratch(data) -> bool:
    item = table.Facility(
        id=data[''],
        name=data[''],
        state=data[''],
        county=data['county'],
        latitude=data['latitude'],
        longitude=data['longitude'],
        category=data['sourceCategory']
    )
    # Push Table to Session
    db.session.add(item)
    db.session.flush()
    return True

def createUnit(row: tuple) -> bool:
    # Retrieve Factory Data Using API
    info = cam.retrFacility({'facilityId': getattr(row, '_3'), 'year': getattr(row, 'Year'), 'page': 1,
                             'perPage': 500})

    # Iterate Through Pages for Correct Unit Information
    p = 1
    items = json.loads(info.text)
    data = None

    while True:
        # Iterate Through Each Item
        for item in items['items']:
            if item['unitId'] == getattr(row, '_4'):
                # Change data for Check Later
                data = item

        # Break if Check Passes
        if data is not None:
            break
        
        # Find More Records if Available
        p += 1
        if len(items['items']) == 500:
            info = cam.retrFacility({'facilityId': getattr(row, '_3'), 'year': getattr(row, 'Year'), 'page': p,
                                     'perPage': 500})
            if info.status_code != 200: return False
            items = json.loads(info.text)
            continue
        # Return False if No More Found
        return False

    # Ensure Corresponding Facility Exists in Database
    facility = db.session.get(table.Facility, getattr(row, '_3'))
    if facility is None:
        # Write facility into Database using data
        if not createFacScratch(data):
            # Return False if Fails
            return False

    # Write Unit into Database Session
    item = table.Unit(
        facilityId = getattr(row, '_3'),
        id = getattr(row, '_4'),
        type = getattr(row, '_20'),
        primaryFuel = getattr(row, '_18'),
        secondaryFuel = None if pd.isna(getattr(row, '_19')) else getattr(row, '_19'),
        operatingDate=data['commercialOperationDate'],
    )
    db.session.add(item)
    db.session.flush()
    return True

def searchUnit(fac, unit):
    # Search Method for Readability
    response = None
    response = db.session.execute(db.select(table.Unit).where(
        table.Unit.facilityId == fac,
        table.Unit.id == unit
    )).scalar_one_or_none()
    return response

def createRecord(info: tuple) -> bool:
    # Add Facility and Unit if Not Already Present
    facility = db.session.get(table.Facility, getattr(info, '_3'))
    if facility is None:
        createFac(info)
        facility = db.session.get(table.Facility, getattr(info, '_3'))
        # If Facility is Missing so is Unit
        if not createUnit(info):
            return False
    unit = searchUnit(getattr(info, '_3'), getattr(info, '_4'))
    if unit is None:
        if not createUnit(info):
            return False
        unit = searchUnit(getattr(info, '_3'), getattr(info, '_4'))

    # Create Annual Record Item
    item = table.AnnualRecord(
        facilityID = facility.id,
        unitId = unit.key,
        reportingYear = getattr(info, 'Year'),
        operatingTime = getattr(info, '_8'),
        grossLoad = None if pd.isna(getattr(info, '_9')) else getattr(info, '_9'),
        steamLoad = None if pd.isna(getattr(info, '_10')) else getattr(info, '_10'),
        heatInput = None if pd.isna(getattr(info, '_17')) else getattr(info, '_17'),
        massCo2 = None if pd.isna(getattr(info, '_13')) else getattr(info, '_13'),
        massSo2 = None if pd.isna(getattr(info, '_11')) else getattr(info, '_11'),
        massNox = None if pd.isna(getattr(info, '_15')) else getattr(info, '_15'),
        so2ControlInfo = None if pd.isna(getattr(info, '_21')) else getattr(info, '_21'),
        noxControlInfo = None if pd.isna(getattr(info, '_22')) else getattr(info, '_22'),
        pmControlInfo = None if pd.isna(getattr(info, '_23')) else getattr(info, '_23'),
        programCode = getattr(info, '_25')
    )
    # Push to Session
    db.session.add(item)
    db.session.flush()
    return True