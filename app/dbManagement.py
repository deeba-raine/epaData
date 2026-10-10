# Import Depenedencies
from datetime import datetime, timezone
from . import tables as table
from . import camApi as cam
from sqlalchemy import func
import pandas as pd
from . import db
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
        operatingDate=datetime.strptime(data['commercialOperationDate'], "%Y-%m-%d")
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

    # Ensure Record Doesn't Already Exist
    rec = db.session.get(table.AnnualRecord, (facility.id, unit.key, getattr(info, 'Year')))
    if rec is not None:
        # Record Exists, Return False
        return False

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

# Grab all of A Table
def getAll(model=table.AnnualRecord):
    query = db.select(model)
    return db.session.execute(query).scalars().all()

def search(filters: dict | None=None):
    filters = filters or {}
    # Searchable Table Fields Dictionary for Formatting Clarity and Joining Purposes
    fields = {"facility_id": table.Facility.id, "facility_name": table.Facility.name, "state": table.Facility.state,
              "county": table.Facility.county, "latitude": table.Facility.latitude, "key": table.Unit.key,
              "longitude": table.Facility.longitude, "category": table.Facility.category, "unit_id": table.Unit.id,
              "type": table.Unit.type, "primary_fuel": table.Unit.primaryFuel, "secondary_fuel": table.Unit.secondaryFuel,
              "operating_date": table.Unit.operatingDate, "retirement_date": table.Unit.retirementDate, "year": table.AnnualRecord.reportingYear,
              "operating_time": table.AnnualRecord.operatingTime, "gross": table.AnnualRecord.grossLoad,
              "steam_load": table.AnnualRecord.steamLoad, "heat_input": table.AnnualRecord.heatInput, "co2": table.AnnualRecord.massCo2,
              "so2": table.AnnualRecord.massSo2, "nox": table.AnnualRecord.massNox, "so2_control": table.AnnualRecord.so2ControlInfo,
              "nox_control": table.AnnualRecord.noxControlInfo, "pm": table.AnnualRecord.pmControlInfo, "program_code": table.AnnualRecord.programCode}
    
    # Join All Tables for Searching Purposes
    query = db.select(*[c.label(n) for n, c in fields.items()]).select_from(table.AnnualRecord).join(table.Unit, table.AnnualRecord.unitId == table.Unit.key).join(table.Facility, table.AnnualRecord.facilityID == table.Facility.id)

    # Process Filters into Usable Constrains
    ### Filters needs Two Sections: {args: {field, operator, value}, format: {group, rank, n}}
    constraints = [process(fields, f) for f in filters.get('args', [])]
    if constraints:
        query = query.where(*constraints)

    # Format Query Accordingly
    query = form(fields, query, filters.get('format', {}))

    # Return Query
    return db.session.execute(query).mappings().all()

# Process Filter Arguments; Seperate Function For Readability
def process(fields, args: dict):
    field = args.get("field")
    op = args.get("op", args.get("operator"))
    val = args.get("value")

    arg = fields[field]
    base = None
    # Switch Operator to Return Correct Query
    match(op):
        # Comparison Operands
        case('='):
            base = arg == val
        case('!=' | '≠'):
            base = arg != val
        case('>'):
            base = arg > val
        case('>=' | '≥'):
            base = arg >= val
        case('<'):
            base = arg < val
        case('<=' | '≤'):
            base = arg <= val

        # Text Operands
        case('contains'):
            base = arg.ilike(f"%{val}%")
        case('ends_with'):
            base = arg.ilike(f"%{val}")
        case('starts_with'):
            base = arg.ilike(f"{val}%")
        case('in'):
            base = arg.in_(val)
        case('not_in'):
            base = arg.not_in(val)
        case _:
            raise ValueError(f"Not Supported Operator: {op}")
    return base

# Reorginize or Group Data Before Limiter; Different Function for Readability
def form(fields, query, args):
    rank = args.get("rank", None)
    n = args.get("n", None)
    group = args.get("group", None)
    rankN = None
    if rank:
        rankN = rank.get("n", None)

    # Groupby Implementation
    ### group format: {group: {by: [], aggregate: [function, metric]}}
    if group:
        # Check rank.n-if exists DO NOT collapse-
        if rankN is None:
            # Group By Given Metrics First
            arg = group.get("by", None)
            if arg is None:
                raise ValueError("You Must Group By Something to use Group")

            arg = [arg] if isinstance(arg, str) else arg
            columns = [fields[field] for field in arg]

            aggs = group.get("aggregate", None)
            if aggs is not None:
                build = list(columns)
                for agg, metric in aggs:
                    # Adjust Metric in Given Manner
                    name = metric
                    metric = fields[metric]
                    build.append(aggregate(agg, metric).label(f"{agg}_{name}"))
                # Create Final Query Using Build
                query = query.with_only_columns(*build)
            # Group After Aggregations
            query = query.group_by(*columns)

    # Top/Bottom Order if Told To
    ### rank formatting {direction: "Top/Bottom", metric: "", n: int > 0}
    if rank:
        arg = fields[rank.get("metric", None)]
        if arg is None:
            raise ValueError("You Need a Metric To Order By")

        # Implementing This was My Life's Biggest Mistake
        columns = None
        if rankN:
            arg2 = group.get("by", None)
            if arg2 is None:
                raise ValueError("You Must Group By Something to use Group")

            arg2 = [arg2] if isinstance(arg2, str) else arg2
            columns = [fields[field] for field in arg2]
        def subQuery(q, column, value, d=''):
            if d == 'bottom':
                sub = q.add_columns(
                    func.row_number().over(
                        partition_by=column,
                        order_by=value.asc()
                    ).label("rn")
                ).subquery()
                return sub
            else:
                sub = q.add_columns(
                    func.row_number().over(
                        partition_by=column,
                        order_by=value.desc()
                    ).label("rn")
                ).subquery()
                return sub
        
        direction = rank.get("direction", None)
        if direction and direction == 'top':
            if rankN is None:
                query = query.order_by(arg.desc())
            else:
                s = subQuery(query, columns, arg, direction)
                query = db.select(*[s.c[col] for col in s.c.keys() if col != "rn"]).where(s.c.rn <= rankN)
        elif direction and direction == 'bottom':
            if rankN is None:
                query = query.order_by(arg.asc())
            else:
                s = subQuery(query, columns, arg, direction)
                query = db.select(*[s.c[col] for col in s.c.keys() if col != "rn"]).where(s.c.rn <= rankN)
        else:
            raise ValueError("Direction Must be Top or Bottom")
    # Limit Total by N
    if n is not None:
        if n >= 0:
            query = query.limit(n)
        else:
            raise ValueError("n Must Be At Least 0")
    return query

def aggregate(agg: str, metric):
    match(agg):
        case('sum'):
            return func.sum(metric)
        case('max'):
            return func.max(metric)
        case('min'):
            return func.min(metric)
        case('avg'):
            return func.avg(metric)
        case('cnt'):
            return func.count(metric)
    raise LookupError("Improper Aggregate")