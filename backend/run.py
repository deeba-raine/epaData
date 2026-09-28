# Run App Folder To Get All Services Up
from app import createApp

app = createApp()

if __name__ == "__main__":
    app.run(debug=True)