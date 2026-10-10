# Import Dependencies
from flask import Flask
from flask_cors import CORS
from flask_sqlalchemy import SQLAlchemy

# Initialize Database for Other File Imports
db = SQLAlchemy()

def create_app(test=None):
    app = Flask(__name__, instance_relative_config=True)
    app.config.from_mapping(
        SQLALCHEMY_DATABASE_URI="sqlite:///epaData.db",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        MAX_CONTENT_LENGTH=50 * 1024 * 1024,
    )

    # Allows For Test Files to Create DB in Memory
    if test:
        app.config.update(test)

    # Initialize Databese Needs
    db.init_app(app)
    CORS(app)

    # Import Database and Routing for Flask App
    from .api import api
    from . import tables

    app.register_blueprint(api, url_prefix="/api")
    with app.app_context():
        db.create_all()

    # Return app
    return app


# Keep the original public name available for existing callers.
createApp = create_app