# epaData
 
epaData is a flask based web application for exploring U.S. Environmental Protection Agency (EPA) power plant emissions data. Users can retrieve or upload the data, store it in a database, and search it by facility, unit, and year. The application also shows how emissions change over time.
 
## About the EPA and Power Plant Emissions
 
The Environmental Protection Agency (EPA) is an independent agency of the United States federal government with a mission to protect human health and the environment. To achieve this, the EPA uses legal, institutional, and research measures to monitor and regulate pollutants and chemicals produced by power plants. The agency also educates the public about the hazards of these pollutants and regularly publishes open data based on its scientific research.
 
## How Power Plants Report Emissions
 
Power plants burn fuels to produce electricity. The emissions reporting system works like this:
 
* **EGU (Emissions Generating Unit):** the machine at a power plant that actually generates electricity
* **Emissions produced:** burning fuel produces emissions, mainly sulfur dioxide (SO₂), nitrogen oxides (NOₓ), carbon dioxide (CO₂), and mercury
* **ECMPS:** the reporting system the EPA uses to collect emissions and operating data directly from power plant facilities
* **CAMPD:** EPA's public data warehouse, which takes the data collected through ECMPS and publishes it in a form the public can access, search, and analyze
epaData sits at the end of this chain: it pulls CAMPD data (or CAMPD download files), stores it in a local database, and makes it searchable.
 

## Features
 
* **Upload and import:** upload a CSV or Excel (.xlsx) file, check the validation report, and import only the records you approve. A template file can be downloaded from the upload page.
* **Validation:** the file type and 25 expected columns are checked, duplicate rows are skipped, and each row is sorted into valid, warning, or invalid.
* **Database:** facilities, units, annual records, and dataset history are stored in SQLite through SQLAlchemy.
* **Basic search:** by facility name, facility ID, unit ID, state, year, or fuel.
* **Advanced search:** combine several conditions, for example State = KY AND CO2 > 500,000, using `=`, `≠`, `>`, `≥`, `<`, `≤`, and `contains`.
* **Description search:** type a sentence such as "Find coal units in Kentucky with high CO2 emissions". Simple keyword rules turn it into search conditions, which are shown before the search runs.
* **Results:** sortable columns, pagination (10, 25, or 50 rows), and CSV download of the filtered results.
* **Dashboard:** facility count, total CO2 and SO2, filters by state, facility, and year, an annual emissions trend chart, and a facility emissions table with CSV export.
## Technologies
 
* Python 3 and Flask 3.1 (with Flask-CORS)
* SQLite with Flask-SQLAlchemy 3.1
* pandas and openpyxl for reading CSV and Excel files
* requests for the EPA API
* HTML, CSS, and JavaScript front end, with Chart.js for the chart
* pytest for tests


## Data Sources

* EPA Clean Air Markets Program Data (CAMPD), `https://api.epa.gov/easey`
* EPA annual emissions CSV files in the CAMPD download format (see below)

## Project structure

```
epaData/
├── backend/
│   ├── run.py                  # starts the Flask server
│   ├── app/
│   │   ├── __init__.py         # app factory, database setup
│   │   ├── api.py              # routes (/api/...)
│   │   ├── services.py         # upload validation
│   │   ├── dbManagement.py     # saving records and search queries
│   │   ├── camApi.py           # EPA API client
│   │   └── tables.py           # database schema
│   └── tests/                  # pytest tests
├── frontend/
│   ├── index.html
│   ├── script.js
│   └── style.css
├── requirements.txt
└── pyproject.toml
```
## Setup

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Run

Backend (serves the API at `http://127.0.0.1:5000`):

```powershell
$env:EPA_KEY = "your-key"   # needed only for EPA API calls
.\.venv\Scripts\python.exe backend\run.py
```

Front end:

```powershell
cd frontend
..\.venv\Scripts\python.exe -m http.server 8000
```

Open `http://localhost:8000`.

## Uploading data

Upload a CSV or .xlsx file with the 25 EPA annual emissions columns. Rows are sorted during the preview:

| Group | Rule | Imported |
| --- | --- | --- |
| Valid | All required fields present | On confirmation |
| Warning | Missing emissions, load, heat input or control info | Only if "Push Questionable Rows" is ticked |
| Invalid | Missing State, facility, unit, year, fuel, unit type or program code | Never |

Duplicate rows (same facility, unit, year) are skipped.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| POST | `/api/upload` | Validate a file and return a preview |
| POST | `/api/finishUpload` | Confirm or cancel the upload |
| GET | `/api/facilityVisualize` | Rows for the front end |

## Database

SQLite (`epaData.db`) with `Facility`, `Unit`, `AnnualRecord` and `Dataset` tables, defined in `backend/app/tables.py`.

## Tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```
