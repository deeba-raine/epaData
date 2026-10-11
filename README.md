# epaData

epaData is a Flask web application for exploring U.S. EPA power-plant emissions data. You can upload EPA annual-emissions files (or enrich them from the EPA CAMPD API), store them in a SQLite database, and search them by facility, unit and year. A dashboard shows totals and emissions trends.

## Features

- **Upload and import:** upload a CSV or Excel (.xlsx) file, review a validation report, and import only the records you approve.
- **Validation:** checks the file type and the 25 expected columns, skips duplicate rows, and sorts each row into valid, warning or invalid.
- **Database:** facilities, units, annual records and dataset history stored in SQLite through SQLAlchemy.
- **Basic search:** by facility name, facility ID, unit ID, state, year or fuel.
- **Advanced search:** combine conditions such as `State = KY AND CO2 > 500000` using `=`, `≠`, `>`, `≥`, `<`, `≤` and `contains`.
- **Description search:** type a sentence such as "Find coal units in Kentucky with high CO2 emissions"; keyword rules turn it into conditions that are shown before the search runs.
- **Results:** sortable columns, pagination (10, 25 or 50 rows) and CSV download of the filtered results.
- **Dashboard:** facility count, total CO2 and SO2, filters, an annual trend chart and a facility table with CSV export.

## Technologies

Python 3.10+, Flask 3.1 with Flask-CORS, SQLite with Flask-SQLAlchemy 3.1, pandas and openpyxl, requests, pytest, and an HTML/CSS/JavaScript front end with Chart.js (loaded from a CDN, so an internet connection is needed to draw the chart).

## Requirements

| Requirement     | Details                                                                                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python          | 3.10 or newer (the code uses`match` statements)                                                                                                                                              |
| Internet access | Needed to install packages, to load Chart.js, and to call the EPA API during import                                                                                                            |
| EPA API key     | Needed to import data, because the import fills in facility and unit details from the EPA API. Request a free key from the EPA CAM API portal: https://www.epa.gov/power-sector/cam-api-portal |
| Browser         | Any current browser                                                                                                                                                                            |

## Setup

Run all commands from the repository root. Commands are shown for Windows PowerShell first, then macOS/Linux.

**1. Get the code**

```
git clone <your-repository-url>
cd epaData
```

(Or download the ZIP from GitHub, unzip it, and open a terminal in the unzipped folder.)

**2. Create a virtual environment and install packages**

Windows PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

macOS/Linux:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
```

**3. Set your EPA API key**

The server starts without a key, but imports will fail with `EPA_KEY is not set`. Set the key in the same terminal you will use to start the backend.

Windows PowerShell:

```powershell
$env:EPA_KEY = "your-key"
```

macOS/Linux:

```bash
export EPA_KEY="your-key"
```

**4. Start the backend** (API at http://127.0.0.1:5000)

Windows PowerShell:

```powershell
.\.venv\Scripts\python.exe backend\run.py
```

macOS/Linux:

```bash
.venv/bin/python backend/run.py
```

Check it works by opening http://127.0.0.1:5000/api/health in a browser. You should see `{"status":"ok"}`.

**5. Start the front end** (in a second terminal, leave the backend running)

Windows PowerShell:

```powershell
cd frontend
..\.venv\Scripts\python.exe -m http.server 8000
```

macOS/Linux:

```bash
cd frontend
../.venv/bin/python -m http.server 8000
```

Open http://localhost:8000 in your browser. The front end expects the API at `http://127.0.0.1:5000`, so keep the backend on that address and port.

## Reproducing the results

### Input file

The upload needs an EPA CAMPD **annual, unit-level emissions** file in CSV or .xlsx format, with exactly these 25 columns in this order:

```
State, Facility Name, Facility ID, Unit ID, Associated Stacks, Year, Operating Time Count,
Sum of the Operating Time, Gross Load (MWh), Steam Load (1000 lb), SO2 Mass (short tons),
SO2 Rate (lbs/mmBtu), CO2 Mass (short tons), CO2 Rate (short tons/mmBtu), NOx Mass (short tons),
NOx Rate (lbs/mmBtu), Heat Input (mmBtu), Primary Fuel Type, Secondary Fuel Type, Unit Type,
SO2 Controls, NOx Controls, PM Controls, Hg Controls, Program Code
```

Download such a file from the CAMPD data download pages (https://campd.epa.gov) and do not edit the header. A file with different columns is rejected with "Incorrect Columns".

### Walkthrough

1. Start the backend and front end as above (EPA key set).
2. Open **Upload data**, enter a dataset name, and drop in the CSV.
3. Read the validation report (rows with no issues, duplicates, warnings, invalid rows).
4. Optionally tick **Push Questionable Rows**, then click **Import valid rows**. Imports call the EPA API for each new facility and unit, so large files take time; rate-limit pauses of 10 seconds are normal.
5. Open **Dashboard** to see totals, filters and the trend chart.
6. Open **Search facilities** and try:
   - Basic: `Ghent` with State = `KY`
   - Advanced: `State = KY` and `CO2 > 500000`
   - Describe it: `Find coal units in Kentucky with high CO2 emissions`
7. Click a column heading to sort, change **Rows**, and click **Download CSV** to export all matching rows.

### Row validation rules

| Group   | Rule                                                                                                           | Imported                                 |
| ------- | -------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| Valid   | All required fields present                                                                                    | On confirmation                          |
| Warning | Missing gross load, SO2, CO2, NOx or heat input, or NOx or PM control info                                     | Only if Push Questionable Rows is ticked |
| Invalid | Missing State, facility name, facility ID, unit ID, year, operating time, fuel type, unit type or program code | Never                                    |

Duplicate rows (same facility, unit and year) are skipped. Nothing is saved until you confirm the import, and a pending upload expires after 30 minutes.

## Running the tests

```powershell
.\.venv\Scripts\python.exe -m pytest
```

On macOS/Linux use `.venv/bin/python -m pytest`. Tests run against an in-memory database and do not need an EPA key.

## Configuration

| Setting                           | Where                                 | Default                     |
| --------------------------------- | ------------------------------------- | --------------------------- |
| `EPA_KEY`                       | Environment variable                  | none (required for imports) |
| Database                          | `backend/app/__init__.py`           | SQLite file`epaData.db`   |
| Upload size limit                 | `backend/app/__init__.py`           | 50 MB                       |
| API address used by the front end | `api_url` in `frontend/script.js` | `http://127.0.0.1:5000`   |

## API routes

| Method | Route                      | Purpose                              |
| ------ | -------------------------- | ------------------------------------ |
| GET    | `/api/health`            | Health check                         |
| POST   | `/api/upload`            | Validate a file and return a preview |
| POST   | `/api/finishUpload`      | Confirm or cancel the upload         |
| GET    | `/api/facilityVisualize` | Rows for the front end               |

## Project structure

```
epaData/
├── backend/
│   ├── run.py              # starts the Flask server
│   ├── app/
│   │   ├── __init__.py     # app factory, database setup
│   │   ├── api.py          # routes (/api/...)
│   │   ├── services.py     # upload validation
│   │   ├── dbManagement.py # saving records and search queries
│   │   ├── camApi.py       # EPA API client
│   │   └── tables.py       # database schema
│   └── tests/              # pytest tests
├── frontend/               # index.html, script.js, style.css
├── requirements.txt
└── pyproject.toml
```

## Troubleshooting

| Problem                                | Fix                                                                               |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| `EPA_KEY is not set` when importing  | Set the key (Setup step 3) in the terminal that runs the backend, then restart it |
| "Incorrect Columns"                    | Use an unedited CAMPD annual emissions file with the 25 columns listed above      |
| Dashboard stays empty or requests fail | Confirm the backend is running and http://127.0.0.1:5000/api/health responds      |
| Port 5000 or 8000 already in use       | Stop the other program, or use a different port for the front end server          |
| Chart does not appear                  | Check your internet connection (Chart.js loads from a CDN)                        |

## Data source

EPA Clean Air Markets Program Data (CAMPD): https://campd.epa.gov (API: https://api.epa.gov/easey)
