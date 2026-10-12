# Import Dependencies
from flask import Blueprint, jsonify, request
from sqlalchemy.exc import IntegrityError
from . import dbManagement as manage
from . import services as serv
from . import tables as table
from . import camApi as cam
import pandas as pd
import time
import uuid
import json

api = Blueprint("api", __name__)

# Upload Query Setup
pending = {}
timeout = 30*60
retrieveCnt = 0

def cleanupPending():
    now = time.time()
    # Check Pending for Expired Queries
    expiredId = [upId for upId, upload in pending.items() if now - upload["start"] > timeout]
    # Clean Expired Uploads
    for id in expiredId:
        del pending[id]

@api.get("/health")
def health():
    return jsonify({"status": "ok"})

@api.post("/upload")
def upload():
    # Clean Pending
    cleanupPending()
    manage.sessionEnd()

    # Check File Has Been Uploaded
    file = request.files.get("file")
    notes = request.form.get("notes")
    if not file or not file.filename:
        return jsonify({"error": "Not CSV or Excel File"})

    # Check Metadata Has Been Passed
    name = request.form.get("name")
    if not name:
        return jsonify({"error": "Name is Required"})

    # Create Default Server: Upload Instance
    service = serv.Upload()

    # Confirm Correct Fily Type
    if not service.inputFormat(file.filename): return jsonify({"error": "Not CSV or Excel File"})
    # Read Corresponding File Type
    data = None
    try:
        if service.type == 'csv':
            data = pd.read_csv(file)
        else:
            data = pd.read_excel(file)
    except pd.errors.EmptyDataError:
        return jsonify({"error": "Empty File Given"})

    # Validate Columns
    if not service.columnCheck(data): return jsonify({"error": "Incorrect Columns"})

    # Begin Bucketing Rows
    for item in data.itertuples():
        # Duplicate Check
        if not service.duplicateCheck(item): continue
        # Issue Check Will Bucket item
        service.reportCheck(item)
    # Store Bucketed Data in Cache for Finish
    reports = service.getReports()
    duplicates = service.getDuplicates()
    response = reports | duplicates
    upid = str(uuid.uuid4())
    pending[upid] = {"start": time.time(), "filename": file.filename, "notes": notes, "name": name,"data": response}

    # Return Report Information
    report = response.copy()
    report["Indexes"] = list(report["Indexes"])
    return jsonify({"uploadID": upid} | report)

@api.post("/finishUpload")
def upRespond():
    # Clean Pending
    cleanupPending()

    # Two Checkboxes As Input, Get Both Booleans
    pushAccept = 'push' in request.form
    pushQuestion = 'question' in request.form

    # Pull Data Out of Pending
    upid = request.form.get("uploadID")
    if upid is None:
        return jsonify({"error": "Request Has Expired"})
    stored = pending.pop(upid, None)
    if stored is None:
        return jsonify({"error": "Bad Storage Request"})

    # If not Accepted, Return 
    if not pushAccept:
        return jsonify({"message": "Changes Reverted"})
    
    # Retrieve Needed Information
    data = stored['data']
    # Metadata
    years = set()
    raw = len(data["Indexes"]) + len(data["Valid"]["items"]) + len(data["Invalid"]["items"]) + len(data["Warning"]["items"])
    accepted = len(data["Valid"]["items"])
    dropped = 0

    # Flush All Accepted Items
    for item in data["Valid"]["items"]:
        if manage.createRecord(item, stored['name']):
            years.add(getattr(item, 'Year'))
        else:
            # Append To Dropped Report
            dropped += 1
            accepted -= 1
            continue

    # Check if Questionable was Pushed
    if pushQuestion:
        # Push All Questionable Records
        accepted += len(data["Warning"]["items"])
        for item in data["Warning"]["items"]:
            if manage.createRecord(item, stored['name']):
                years.add(getattr(item, 'Year'))
            else:
                # Append To Dropped Report
                dropped += 1
                accepted -= 1
                continue
    # Gather Dataset Attributes
    attributes = [stored['name'], 'upload', json.dumps(list(years)), stored['filename'], raw, 
                  accepted, stored['notes']]
    # Push To Database and Return *Dataset Push Commits Chenges*
    try:
        manage.createDataset(attributes)
    except Exception:
         # Likely Name Error, Rollback and Push JSON Error
         manage.sessionEnd()
         return jsonify({"error": "Try a Different Name (Name Must Be Unique)"})
    return jsonify({"message": "Changes Pushed", "rows": accepted, "dropped": dropped})

@api.get("/facilityVisualize")
def getFacilityData():
    visualizedData = ["facility_name", "facility_id", "state", "unit_id", "primary_fuel", "co2", "so2", "year"]
    # Refresh with Every Record
    facilities = manage.search()
    relevant = [facility[x] for facility in facilities for x in visualizedData]
    # Group Relevant into Eights
    i = 0
    ret = []
    while i < len(relevant):
        ret.append(relevant[i:i+8])
        i += 8
    return jsonify({"items": ret})

# Database Basic Search Endpoint
@api.post("/searchData")
def getBasicData():
    condition = dict()
    search = None

    condition["target"] = request.args.get("value")
    # Conduct default search if given
    if "d" in request.args:
        search = manage.search(conditions=condition)
    else:
        # If Not Default Build Condition.field
        defa = ["facility_id", "facility_name", "state", "county", "latitude", "key", "longitude", 
               "category", "unit_id", "type", "primary_fuel", "secondary_fuel", "operating_date", 
               "retirement_date", "year", "operating_time", "gross", "steam_load", "heat_input", "co2",
              "so2", "nox", "so2_control", "nox_control", "pm", "program_code", "source"]
        # Subtract Explicit Filters
        filters = json.loads(request.args.get('exempt')) if 'exempt' in request.args else []
        condition['fields'] = list(set(defa) - set(filters))

        # Search Using Given Restrictions
        search = manage.search(conditions=condition)

    # Sort Search if Present
    if "sortBy" in request.args:
        # d and t will be strictly enforced in front end
        t = json.loads(request.args.get("sortBy"))
        d = request.args.get("direction")
        search = sortBy(search, t, d=='top')

    # Turn search to javascript readable
    search = [dict(x) for x in search]
    return jsonify({"items": search, "distinct": distinct(search)})

# Search Making Use of All Filters
@api.post('/searchAdvanced')
def advancedGetData():
    # Frontend Passes Exact Form; Pass Back Results + Distinct Rows for Dropdowns-Maybe Sort Implementation
    filter = request.form.get("conditions")
    try:
        filter = json.loads(filter) if filter else {}
    except Exception:
        return jsonify({"error": "Filters Have Incorrect Format"})
    search = [dict(x) for x in manage.search(filters=filter)]

    if "sortBy" in request.form:
        t = json.loads(request.form.get("sortBy"))
        d = request.form.get("direction")
        search = sortBy(search, t, d=='top')
    return jsonify({"items": search, "distinct": distinct(search)})

# Dataset Retrieval
@api.post('/searchDatasets')
def dataSearch():
    search = [dict(x) for x in manage.datasetSearch(request.form.get("value"))]
    if "sortBy" in request.form:
        t = json.loads(request.form.get("sortBy"))
        d = request.form.get("direction")
        search = sortBy(search, t, d=='top')
    return jsonify({"items": search, "distinct": distinct(search)})

def sortBy(items, targets, r=False):
    # items format: [item{}, item{}] where item includes args targets
    return sorted(items, key=lambda x: tuple(x[key] for key in targets), reverse=r)

def distinct(items):
    # Given a list of dictionaries, create a dictionary {key: [uniqueValues]}
    ret = {}
    for item in items:
        for k, v in item.items():
            if k not in ret:
                ret[k] = set()
            try:
                ret[k].add(v)
            except:
                continue
    # Javascript Can't Accept set() so turn all Values to Lists
    for k, v in ret.items():
        ret[k] = list(v)
    return ret

# EPA Retrieval Endpoints (Download and Retrieval)
@api.post('/epa')
def retrieveByState():
    # Upload Needs to Cleanup
    global retrieveCnt
    cleanupPending()
    manage.sessionEnd()

    amount = 50
    if 'amount' in request.form:
        amount = request.form.get('amount')
    # Default Retrieve 50 Records

    # Build List using From and To
    start = request.args.get('from', type=int)
    end = request.args.get('to', type=int)
    years = list(range(start, end+1))

    # Add Misc. Arguments to Retrieval if They Exists
    attr = {}
    attr["facilityId"] = request.args.get('facility', None)
    attr["unitFuelType"] = request.args.get('fuel', None)
    attr["unitType"] = request.args.get('unit', None)

    # Retrieve Other Arguments for camAPI Pass
    attr = {"page": 1, "perPage": amount, "year": years, "stateCode": request.args.get('state'), "period": "annual"} | attr
    try:
        retrieval = cam.retrEmission(attr)
    except Exception as e:
        print(e)
        return jsonify({"error": str(e)})

    # If Retrieval Is Successful, Prepare Data for Upload Report and 2nd Pass
    data = json.loads(retrieval.text[9:-1])
    
    # Write Data into Pandas Dataframe and Map Default Names
    df = pd.DataFrame(data)
    df = df.drop(columns=['unitId'])
    columnNames = ["State", "Facility Name", "Facility ID", "Unit ID", "Associated Stacks", "Year", "Operating Time Count",
                     "Sum of the Operating Time", "Gross Load (MWh)", "Steam Load (1000 lb)", "SO2 Mass (short tons)",
                    "SO2 Rate (lbs/mmBtu)", "CO2 Mass (short tons)", "CO2 Rate (short tons/mmBtu)", "NOx Mass (short tons)",
                    "NOx Rate (lbs/mmBtu)", "Heat Input (mmBtu)", "Primary Fuel Type", "Secondary Fuel Type", "Unit Type",
                    "SO2 controls", "NOx Controls", "PM controls", "Hg controls", "Program Code"]
    df = df.set_axis(columnNames, axis=1)

    # Begin Bucketing Rows
    service = serv.Upload()
    for item in df.itertuples():
        # Duplicate Check
        if not service.duplicateCheck(item): continue
        # Issue Check Will Bucket item
        service.reportCheck(item)
    # Store Bucketed Data in Cache for Finish
    reports = service.getReports()
    duplicates = service.getDuplicates()
    response = reports | duplicates
    upid = str(uuid.uuid4())
    pending[upid] = {"start": time.time(), "filename": f'retreival{retrieveCnt}', "notes": f'The {retrieveCnt+1}th CAM Api Retrieval', "name": f'retreival{retrieveCnt}',"data": response}
    retrieveCnt += 1

    # Return Report Information
    report = response.copy()
    report["Indexes"] = list(report["Indexes"])
    return jsonify({"uploadID": upid} | report)

@api.post('/secondRetrieve')
def retrieveUpload():
    ### Exact Same Format as Other Upload
    # Clean Pending
    cleanupPending()

    # Two Checkboxes As Input, Get Both Booleans
    pushAccept = 'push' in request.form
    pushQuestion = 'question' in request.form

    # Pull Data Out of Pending
    upid = request.form.get("uploadID")
    if upid is None:
        return jsonify({"error": "Request Has Expired"})
    stored = pending.pop(upid, None)
    if stored is None:
        return jsonify({"error": "Bad Storage Request"})

    # If not Accepted, Return 
    if not pushAccept:
        return jsonify({"message": "Changes Reverted"})
    
    # Retrieve Needed Information
    data = stored['data']
    # Metadata
    years = set()
    raw = len(data["Indexes"]) + len(data["Valid"]["items"]) + len(data["Invalid"]["items"]) + len(data["Warning"]["items"])
    accepted = len(data["Valid"]["items"])
    dropped = 0

    # Flush All Accepted Items
    for item in data["Valid"]["items"]:
        if manage.createRecord(item, stored['name']):
            years.add(getattr(item, 'Year'))
        else:
            # Append To Dropped Report
            dropped += 1
            accepted -= 1
            continue

    # Check if Questionable was Pushed
    if pushQuestion:
        # Push All Questionable Records
        accepted += len(data["Warning"]["items"])
        for item in data["Warning"]["items"]:
            if manage.createRecord(item, stored['name']):
                years.add(getattr(item, 'Year'))
            else:
                # Append To Dropped Report
                dropped += 1
                accepted -= 1
                continue
    # Gather Dataset Attributes
    attributes = [stored['name'], 'api', json.dumps(list(years)), stored['filename'], raw, 
                    accepted, stored['notes']]
    # Push To Database and Return *Dataset Push Commits Chenges*
    try:
        manage.createDataset(attributes)
    except Exception:
            # Likely Name Error, Rollback and Push JSON Error
            manage.sessionEnd()
            return jsonify({"error": "Try a Different Name (Name Must Be Unique)"})
    return jsonify({"message": "Changes Pushed", "rows": accepted, "dropped": dropped})

