from flask import Blueprint, jsonify, request

from backend.app import db
from backend.app.models import DataSource, Dataset, ImportIssue, ImportJob
from backend.app.services import EPAClient, import_records, read_upload, validate_frame

api = Blueprint("api", __name__)


@api.get("/health")
def health():
    return jsonify({"status": "ok"})


@api.post("/imports/preview")
def preview_import():
    upload = request.files.get("file")
    if not upload or not upload.filename:
        return jsonify({"error": "A CSV or Excel file is required"}), 400
    try:
        frame = read_upload(upload.filename, upload.read())
        _, issues = validate_frame(frame)
    except (ValueError, OSError) as error:
        return jsonify({"error": str(error)}), 400

    source = DataSource.query.filter_by(name="EPA CAMPD").first()
    if not source:
        source = DataSource(name="EPA CAMPD", description="EPA Clean Air Markets data")
        db.session.add(source)
        db.session.flush()
    dataset = Dataset.query.filter_by(name="CAMPD annual emissions", source_id=source.id).first()
    if not dataset:
        dataset = Dataset(name="CAMPD annual emissions", source_id=source.id)
        db.session.add(dataset)
        db.session.flush()
    job = ImportJob(
        dataset_id=dataset.id,
        filename=upload.filename,
        status="preview",
        accepted_rows=max(len(frame) - len({issue["row"] for issue in issues if issue["row"] > 0}), 0),
        rejected_rows=len({issue["row"] for issue in issues if issue["row"] > 0}),
    )
    db.session.add(job)
    db.session.flush()
    for issue in issues:
        db.session.add(ImportIssue(import_job_id=job.id, row_number=issue["row"], field=issue["field"], message=issue["message"]))
    db.session.commit()
    return jsonify({"job_id": job.id, "status": job.status, "accepted_rows": job.accepted_rows, "rejected_rows": job.rejected_rows, "issues": issues}), 201


@api.post("/imports/<int:job_id>/commit")
def commit_import(job_id):
    job = db.session.get(ImportJob, job_id)
    if job is None:
        return jsonify({"error": "Import job not found"}), 404
    if job.status == "committed":
        return jsonify({"error": "Import job is already committed"}), 409
    upload = request.files.get("file")
    if not upload or upload.filename != job.filename:
        return jsonify({"error": "The original upload is required to commit this job"}), 400
    try:
        frame = read_upload(upload.filename, upload.read())
        accepted, issues = import_records(frame, job.dataset, EPAClient())
    except (ValueError, LookupError, RuntimeError, OSError) as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 502
    job.status = "committed"
    job.accepted_rows = accepted
    job.rejected_rows = len({issue["row"] for issue in issues if issue["row"] > 0})
    db.session.commit()
    return jsonify({"job_id": job.id, "status": job.status, "accepted_rows": accepted, "issues": issues}), 200
