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
    response = client.post("/api/upload")
    return response.json

print(test_upload())