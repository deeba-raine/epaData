# Run App Folder To Get All Services Up
from app import createApp

app = createApp({"TESTING": True, "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:"})

if __name__ == "__main__":
    app.run(debug=True)