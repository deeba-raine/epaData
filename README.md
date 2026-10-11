# epaData
 
epaData is a Flask web application that transforms raw EPA emissions data into actionable insights. It allows users to explore power-sector emissions trends, compare generating units, and visualize environmental performance over time by retrieving, importing, storing and searching U.S. Environmental Protection Agency (EPA) data at the facility, unit and year level.
 
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

* **EPA data service:** retrieve facility and emissions data from the EPA CAMPD web services
* **Upload and import:** upload CSV or Excel (.xlsx) files, validate them, preview the results, and import only the records you approve
* **Database:** facilities, units, annual records and import history stored in SQLite through SQLAlchemy
* **Basic search:** facility name, facility ID, unit ID, state, year and fuel type
* **Advanced search:** combine several conditions (for example State = KY AND CO2 > 500,000) using equality, range and text operators
* **Description search:** type a sentence such as "Find coal units in Kentucky with high CO2 emissions" and a language model turns it into search conditions, which are shown before the search runs
* **Results:** sortable columns, pagination, and CSV download of the filtered results
* **Dashboard:** facility count, total CO2 and SO2, and an annual emissions trend chart

## Technologies

* Python 3 and Flask 3.1 (with Flask-CORS)
* SQLite with Flask-SQLAlchemy 3.1
* pandas and openpyxl for reading CSV and Excel files
* requests for the EPA API (and the language model)
* HTML, CSS and JavaScript front end, with Chart.js for charts
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

From the repository root, create a virtual environment and install the dependencies:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

## Running the backend

Start the server from the repository root:

```powershell
.\.venv\Scripts\python.exe backend\run.py
```

The API is served at `http://127.0.0.1:5000`.

The server can start without an EPA key, but EPA data operations require the `EPA_KEY` environment variable. Set it in the terminal before starting the server:

```powershell
$env:EPA_KEY = "your-key"
.\.venv\Scripts\python.exe backend\run.py
```

## Running the front end

The front end is a static page that calls the API at `http://127.0.0.1:5000`. With the backend running, serve the `frontend` folder:

```powershell
cd frontend
..\.venv\Scripts\python.exe -m http.server 8000
```

Then open `http://localhost:8000` in a browser. Opening `index.html` directly also works.

## Description search (language model)

The "Describe it" search sends the sentence to `POST /api/describeSearch`, which asks a language model for search conditions. The model's answer is validated against a fixed list of fields and operators before it is used. If the model is unavailable, the page falls back to simple keyword rules.

Cloud model (Anthropic):

```powershell
$env:ANTHROPIC_API_KEY = "your-key"
# optional: $env:LLM_MODEL = "claude-sonnet-5-5"
```

Local model (Ollama):

```powershell
ollama pull llama3.1
$env:LLM_PROVIDER = "local"
$env:LOCAL_LLM_MODEL = "llama3.1"
```

LM Studio or another OpenAI-style server: also set `LOCAL_LLM_URL`, for example `http://localhost:1234/v1/chat/completions`.

## Uploading data

Upload a CSV or .xlsx file from the **Upload data** page. The header must match the 25 columns of the EPA annual emissions download, in this order:

`State, Facility Name, Facility ID, Unit ID, Associated Stacks, Year, Operating Time Count, Sum of the Operating Time, Gross Load (MWh), Steam Load (1000 lb), SO2 Mass (short tons), SO2 Rate (lbs/mmBtu), CO2 Mass (short tons), CO2 Rate (short tons/mmBtu), NOx Mass (short tons), NOx Rate (lbs/mmBtu), Heat Input (mmBtu), Primary Fuel Type, Secondary Fuel Type, Unit Type, SO2 Controls, NOx Controls, PM Controls, Hg Controls, Program Code`

Rows are sorted into three groups during the preview:

| Group | Meaning | Imported |
| --- | --- | --- |
| Valid | All required and useful fields present | Yes, on confirmation |
| Warning | Missing emissions, load, heat input or control information | Only if "Push Questionable Rows" is ticked |
| Invalid | Missing State, facility, unit, year, fuel, unit type or program code | Never |

Duplicate rows (same facility, unit and year) are skipped.

## API routes

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Health check |
| POST | `/api/upload` | Validate an uploaded file and return a preview report |
| POST | `/api/finishUpload` | Confirm or cancel the previewed upload |
| GET | `/api/facilityVisualize` | Facility, unit and emissions rows for the front end |
| POST | `/api/describeSearch` | Convert a description into search conditions with a language model |

## Database

SQLite database `epaData.db` with four tables: `Facility`, `Unit`, `AnnualRecord` and `Dataset`. A facility has many units, and a unit has one annual record per reporting year. The schema is defined in `backend/app/tables.py`.

## Running the tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```

## Known limitations (Phase 1)

* The EPA data service page does not yet call a back-end retrieval route.
* Searching, sorting and pagination run in the browser on the rows loaded from `/api/facilityVisualize`.
* `backend/run.py` starts the app with an in-memory database, so data is lost when the server stops.
