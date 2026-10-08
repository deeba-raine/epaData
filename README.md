epaData

EPA Environmental Data Management, Evaluation, and Visualization System.

epaData is a Flask-based web application for managing and exploring environmental and power-sector data from the U.S. Environmental Protection Agency (EPA).

### Features

* Import and upload EPA data
* Validate and store data in SQLite
* Search and filter environmental data
* View facility and unit information
* Download datasets and search results
* Analyze and visualize environmental data

### Technologies

* Python / Flask
* SQLite / SQLAlchemy
* HTML / Jinja
* Pandas

### Data Sources

* EPA CAMPD
* EPA TRACI
* Other EPA environmental datasets

### Running the backend

From the repository root, start the application with:

```powershell
.\.venv\Scripts\python.exe backend\run.py
```

The server can start without an EPA key, but EPA data operations require the
`EPA_KEY` environment variable. Set it in the terminal before starting the
server:

```powershell
$env:EPA_KEY = "your-key"
.\.venv\Scripts\python.exe backend\run.py
```
