from app import createApp

def test_health():
    test = createApp({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})
    client = test.test_client()
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json == {"status": "ok"}

def test_upload():
    test = createApp({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})
    client = test.test_client()
    form = {
        "name": "Assignment",
        "notes": "I fucking hate my life"
    }
    response = None
    with open("annual-emissions-6ca49156-675f-4dae-885a-2853f8483b85.csv", 'rb') as uploaded:
        doc = {
            "file": uploaded
        }
        stdin = doc | form
        response = client.post("/api/upload", data=stdin, content_type='multipart/form-data')
    id = response.json["uploadID"]
    form = {
        "uploadID": id,
        "push": True
    }
    return client.post("/api/finishUpload", data=form, content_type='multipart/form-data')

# Upload Test
print(test_upload().json)

