# Import Dependencies
from flask import Blueprint, jsonify, request
import app.dbManagement as manage
import app.services as serv
import app.camApi as cam
import pandas as pd
import time
import uuid
import json

api = Blueprint("api", __name__)

# Upload Query Setup
pending = {}
timeout = 30*60

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

    # Flush All Accepted Items
    for item in data["Valid"]["items"]:
        if manage.createRecord(item):
            years.add(getattr(item, 'Year'))
        else:
            accepted -= 1
            continue

    # Check if Questionable was Pushed
    if pushQuestion:
        # Push All Questionable Records
        accepted += len(data["Warning"]["items"])
        for item in data["Warning"]["items"]:
            if manage.createRecord(item):
                years.add(getattr(item, 'Year'))
            else:
                accepted -= 1
                continue
    # Gather Dataset Attributes
    attributes = [stored['name'], 'upload', json.dumps(list(years)), stored['filename'], raw, 
                  accepted, stored['notes']]
    # Push To Database and Return *Dataset Push Commits Chenges*
    manage.createDataset(attributes)
    return jsonify({"message": "Changes Pushed"})
