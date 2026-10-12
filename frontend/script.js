/* =====================================================================
   epaData front end

   Back-end routes used (all under /api):
     GET  /health             status light in the top bar
     GET  /facilityVisualize  dashboard rows (8 values per row)
     POST /searchData         Basic search + Search database (query string: value, d, exempt)
     POST /searchAdvanced     Advanced + Describe search (form: conditions = JSON)
     POST /searchDatasets     Datasets page, dataset-name check, "latest import" card (form: value)
     POST /upload             step 1 of a file import -> quality report
     POST /finishUpload       step 2 of a file import (uploadID, push, question)
     POST /epa                step 1 of an EPA retrieval -> same quality report
     POST /secondRetrieve     step 2 of an EPA retrieval (same fields as /finishUpload)

   BACKEND NOTES: I was told not to touch the back end, so these are the places
   where the two halves need tying together. Each one is also repeated next to the
   code it affects (search for "BACKEND NOTE").

   1. /epa (retrieveByState in api.py) cannot run as written:
        - args["facilityId"] = ... and the next two lines run BEFORE `args = {...}`
          exists (UnboundLocalError). Move the `args = {...}` line above them.
        - the bucketing loop is `for item in data.itertuples()`, but `data` is a
          list. It should loop over the DataFrame: `df.itertuples()`.
        - retrieveCnt is never incremented, so every retrieval is named
          "retreival0" and the second /secondRetrieve fails the unique-name check.
          Use `global retrieveCnt` and add 1 after a successful createDataset.
   2. The sortBy / direction parameters sort in Python and raise TypeError when a
      value is NULL (None < float). The page therefore sorts in the browser.
      If you make sortBy None-safe you can send sortBy/direction instead.
   3. Date columns (operating_date, retirement_date) cannot be filtered through
      /searchAdvanced: JSON gives strings but SQLAlchemy's DateTime needs a datetime
      object. They are left out of the Advanced search field list. Converting inside
      process() with datetime.fromisoformat(val) would allow them.
   4. /searchData only takes a text value. manage.search() already accepts filters AND
      conditions together, so /searchData could also read a "filters" JSON argument.
      Until then the State / Year / Fuel dropdowns on the Basic tab narrow the
      results in the browser after the text search.
   5. process() raises on an unknown field or operator, which becomes an HTML 500
      page. The front end shows a generic "server error" message for that. Wrapping
      the search routes in try/except (ValueError, KeyError) -> jsonify({"error": ...})
      would give users a real message.
   6. manage.retrRecords(name) has no route, so there is no per-dataset CSV
      download. "View records" on the Datasets page instead runs an Advanced
      search with source = <dataset name>, and that result can be downloaded.
   7. Dataset.reportingYears is stored with json.dumps() inside a JSON column, so it
      comes back as the string "[2024, 2025]". formatYears() below copes with both.
   8. run.py points at sqlite:///:memory:, so the data disappears whenever Flask
      restarts (including the debug reloader). Fine for a demo, just be aware.
   ===================================================================== */

const api_url = "http://127.0.0.1:5000";

/* ---------- talking to the back end ---------- */

function setServerStatus(online) {
    const status = document.getElementById("serverStatus");
    status.dataset.state = online ? "online" : "offline";
    status.textContent = online ? "Back end connected" : "Back end offline";
}

// One place for every request. The back end reports many problems as {"error": "..."}
// with HTTP 200, and unexpected crashes come back as an HTML page, so both are turned
// into a normal Error with a readable message.
async function apiRequest(path, { method = "POST", query = {}, form = null } = {}) {
    const url = new URL(`${api_url}/api${path}`);
    Object.entries(query).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            url.searchParams.set(key, value);
        }
    });

    let response;
    try {
        response = await fetch(url, { method: method, body: form });
    } catch (error) {
        setServerStatus(false);
        const failure = new Error(`Can't reach the back end at ${api_url}. Is Flask running?`);
        failure.network = true;
        throw failure;
    }
    setServerStatus(true);

    let data;
    try {
        data = await response.json();
    } catch (error) {
        throw new Error(`The server hit an error (HTTP ${response.status}). Check the Flask console for details.`);
    }
    if (data && data.error) {
        throw new Error(data.error);
    }
    return data;
}

function formWith(fields) {
    const form = new FormData();
    Object.entries(fields).forEach(([key, value]) => form.append(key, value));
    return form;
}

async function checkServer() {
    try {
        await apiRequest("/health", { method: "GET" });
    } catch (error) {
        // apiRequest already updated the status light
    }
}

// API: facility row fetch (dashboard)
async function getFacilityRows() {
    // Retrieve Facility Data for Visualization
    const data = await apiRequest("/facilityVisualize", { method: "GET" });

    //Push Each Row to Rows
    const rows = [];
    for (const row of data.items) {
        rows.push({
            facility: row[0],
            id: row[1],
            state: row[2],
            unit: row[3],
            fuel: row[4],
            year: row[7],
            co2: row[5],
            so2: row[6]
        });
    }
    // Return Rows
    return rows;
}

let facilityData = [];
let importedOn = "—";
let dashboardError = "";

/* ---------- column catalog (labels and types for every field the back end returns) ---------- */

// Order here is the order columns appear in tables. kind: text | id | num | coord | date
const columnCatalog = {
    facility_name: { label: "Facility", kind: "text" },
    facility_id: { label: "Facility ID", kind: "id" },
    state: { label: "State", kind: "text" },
    county: { label: "County", kind: "text" },
    category: { label: "Source category", kind: "text" },
    latitude: { label: "Latitude", kind: "coord" },
    longitude: { label: "Longitude", kind: "coord" },
    unit_id: { label: "Unit", kind: "text" },
    key: { label: "Unit key", kind: "id" },
    type: { label: "Unit type", kind: "text" },
    primary_fuel: { label: "Fuel", kind: "text" },
    secondary_fuel: { label: "Secondary fuel", kind: "text" },
    operating_date: { label: "Operating date", kind: "date" },
    retirement_date: { label: "Retirement date", kind: "date" },
    year: { label: "Year", kind: "id" },
    operating_time: { label: "Operating time (h)", kind: "num" },
    gross: { label: "Gross load (MWh)", kind: "num" },
    steam_load: { label: "Steam load (1000 lb)", kind: "num" },
    heat_input: { label: "Heat input (mmBtu)", kind: "num" },
    co2: { label: "CO2 (t)", kind: "num" },
    so2: { label: "SO2 (t)", kind: "num" },
    nox: { label: "NOx (t)", kind: "num" },
    so2_control: { label: "SO2 controls", kind: "text" },
    nox_control: { label: "NOx controls", kind: "text" },
    pm: { label: "PM controls", kind: "text" },
    program_code: { label: "Program", kind: "text" },
    source: { label: "Dataset", kind: "text" }
};
const catalogKeys = Object.keys(columnCatalog);
const aggregateLabels = { sum: "Total", avg: "Average", max: "Maximum", min: "Minimum", cnt: "Count of" };

function columnFor(key) {
    if (columnCatalog[key]) {
        return { key: key, ...columnCatalog[key] };
    }
    // Grouped results come back as e.g. "sum_co2"
    const match = key.match(/^(sum|avg|max|min|cnt)_(.+)$/);
    if (match) {
        const metric = columnCatalog[match[2]];
        const metricLabel = match[2] === "key" ? "records" : metric ? metric.label : match[2];
        return { key: key, label: `${aggregateLabels[match[1]]} ${metricLabel}`, kind: "num" };
    }
    return { key: key, label: key.replaceAll("_", " "), kind: "text" };
}

function orderedKeys(keys) {
    const known = catalogKeys.filter((key) => keys.includes(key));
    const extra = keys.filter((key) => !catalogKeys.includes(key));
    return [...known, ...extra];
}

function isNumericKind(kind) {
    return kind === "num" || kind === "id" || kind === "coord";
}

// Columns used by the dashboard's own CSV export
const dashboardColumns = [
    { key: "facility", label: "Facility" },
    { key: "id", label: "Facility ID" },
    { key: "state", label: "State" },
    { key: "unit", label: "Unit" },
    { key: "fuel", label: "Fuel" },
    { key: "year", label: "Year" },
    { key: "co2", label: "CO2 (t)", kind: "num" },
    { key: "so2", label: "SO2 (t)", kind: "num" }
];

/* ---------- helpers ---------- */

function isEmpty(value) {
    return value === null || value === undefined || value === "";
}

function getUniqueValues(field) {
    const values = [...new Set(facilityData.map((row) => row[field]).filter((value) => !isEmpty(value)))];
    return values.sort((a, b) => (typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b))));
}

function fillSelect(select, values, keepFirstOption = true) {
    const previous = select.value;
    const firstOption = keepFirstOption && select.options[0] ? select.options[0].outerHTML : "";
    select.innerHTML =
        firstOption + values.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("");
    // Keep the user's choice when the list is rebuilt after an import
    if ([...select.options].some((option) => option.value === previous)) {
        select.value = previous;
    }
}

// Same idea, for [value, label] pairs
function fillOptions(select, pairs, keepFirstOption = true) {
    const firstOption = keepFirstOption && select.options[0] ? select.options[0].outerHTML : "";
    select.innerHTML =
        firstOption + pairs.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function showMessage(message, isError = false) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.classList.toggle("error", isError);
    toast.hidden = false;
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => {
        toast.hidden = true;
    }, isError ? 6000 : 3500);
}

function formatNumber(value) {
    if (isEmpty(value)) {
        return "—";
    }
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value);
}

function parseDate(value) {
    if (isEmpty(value)) {
        return null;
    }
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : new Date(time);
}

// Unit operating dates are plain dates; the back end sends them as midnight GMT
function formatDate(value) {
    const date = parseDate(value);
    return date ? date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" }) : "—";
}

// Import times are real moments, so show them in the viewer's time zone
function formatDateTime(value) {
    const date = value instanceof Date ? value : parseDate(value);
    return date ? date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";
}

function formatYears(value) {
    let years = value;
    if (typeof years === "string") {
        try {
            years = JSON.parse(years);
        } catch (error) {
            return years;
        }
    }
    return Array.isArray(years) ? [...years].sort((a, b) => a - b).join(", ") : "—";
}

function csvCell(value) {
    return isEmpty(value) ? "" : `"${String(value).replaceAll('"', '""')}"`;
}

function csvValue(row, column) {
    const value = row[column.key];
    if (column.kind === "date") {
        const date = parseDate(value);
        return date ? date.toISOString().slice(0, 10) : "";
    }
    return value;
}

// columns: [{ key, label, kind }] (columns with an html renderer are buttons, so they are skipped)
function rowsToCsv(rows, columns) {
    const exportable = columns.filter((column) => !column.html);
    const header = exportable.map((column) => csvCell(column.label)).join(",");
    const lines = rows.map((row) => exportable.map((column) => csvCell(csvValue(row, column))).join(","));
    return [header, ...lines].join("\n");
}

function downloadCsv(fileName, csv) {
    const downloadUrl = URL.createObjectURL(
        new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" })
    );
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = fileName;
    downloadLink.click();
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

function downloadTable(fileName, tableControl) {
    const rows = tableControl.getRows();
    if (!rows.length) {
        showMessage("There are no results to download yet.", true);
        return;
    }
    downloadCsv(fileName, rowsToCsv(rows, tableControl.getColumns()));
}

/* ---------- reusable results table: sorting, pagination, dynamic columns ---------- */

function compareValues(first, second, kind) {
    if (isNumericKind(kind) || (typeof first === "number" && typeof second === "number")) {
        return Number(first) - Number(second);
    }
    if (kind === "date") {
        return parseDate(first) - parseDate(second);
    }
    return String(first).localeCompare(String(second), undefined, { numeric: true });
}

// config: { table, countEl, pager: { info, prev, next, size } | null, emptyMessage }
function createDataTable(config) {
    const { table, countEl, pager = null } = config;
    const emptyMessage = config.emptyMessage || "No records match. Remove a condition or widen a range.";
    const head = table.querySelector("thead");
    const body = table.querySelector("tbody");

    let rows = [];
    let columns = [];
    let sortKey = null;
    let sortDirection = "asc";
    let userSorted = false;
    let page = 1;
    let message = null;

    function sortedRows() {
        const column = columns.find((item) => item.key === sortKey);
        if (!column) {
            return rows;
        }
        const direction = sortDirection === "asc" ? 1 : -1;
        // Empty values always sort last, whichever way the column is sorted
        return [...rows].sort((a, b) => {
            const firstEmpty = isEmpty(a[column.key]);
            const secondEmpty = isEmpty(b[column.key]);
            if (firstEmpty || secondEmpty) {
                return firstEmpty === secondEmpty ? 0 : firstEmpty ? 1 : -1;
            }
            return direction * compareValues(a[column.key], b[column.key], column.kind);
        });
    }

    function headerCell(column) {
        const numeric = column.kind === "num" || column.kind === "coord" ? ' class="num"' : "";
        if (column.html) {
            return `<th${numeric}>${escapeHtml(column.label)}</th>`;
        }
        const sort = column.key === sortKey ? (sortDirection === "asc" ? "ascending" : "descending") : "none";
        return `<th data-key="${escapeHtml(column.key)}" tabindex="0"${numeric} aria-sort="${sort}">${escapeHtml(column.label)}</th>`;
    }

    function renderCell(row, column) {
        const numeric = column.kind === "num" || column.kind === "coord" ? ' class="num"' : "";
        if (column.html) {
            return `<td>${column.html(row)}</td>`;
        }
        const value = row[column.key];
        let text;
        if (column.format && !isEmpty(value)) {
            text = column.format(value, row);
        } else if (column.kind === "num") {
            text = formatNumber(value);
        } else if (column.kind === "coord") {
            text = isEmpty(value) ? "—" : Number(value).toFixed(4);
        } else if (column.kind === "date") {
            text = formatDate(value);
        } else {
            text = isEmpty(value) ? "—" : String(value);
        }
        const wrap = column.wrap ? ' class="wrap"' : "";
        return `<td${numeric || wrap}>${escapeHtml(text)}</td>`;
    }

    function render() {
        head.innerHTML = `<tr>${columns.map(headerCell).join("")}</tr>`;
        const span = Math.max(1, columns.length);

        const sorted = message ? [] : sortedRows();
        const pageSize = pager ? Number(pager.size.value) : Math.max(1, sorted.length);
        const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
        page = Math.min(page, totalPages);
        const pageRows = sorted.slice((page - 1) * pageSize, page * pageSize);

        if (message) {
            body.innerHTML = `<tr><td class="empty ${message.className}" colspan="${span}">${escapeHtml(message.text)}</td></tr>`;
        } else if (!pageRows.length) {
            body.innerHTML = `<tr><td class="empty" colspan="${span}">${escapeHtml(emptyMessage)}</td></tr>`;
        } else {
            body.innerHTML = pageRows
                .map((row) => `<tr>${columns.map((column) => renderCell(row, column)).join("")}</tr>`)
                .join("");
        }

        if (countEl) {
            countEl.textContent = message ? "" : `(${sorted.length.toLocaleString()} records)`;
        }
        if (pager) {
            pager.info.textContent = message ? "" : `Page ${page} of ${totalPages}`;
            pager.prev.disabled = page <= 1;
            pager.next.disabled = page >= totalPages;
        }
    }

    head.addEventListener("click", (event) => {
        const header = event.target.closest("th[data-key]");
        if (!header) {
            return;
        }
        sortDirection = sortKey === header.dataset.key && sortDirection === "asc" ? "desc" : "asc";
        sortKey = header.dataset.key;
        userSorted = true;
        page = 1;
        render();
    });

    head.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            event.target.click();
        }
    });

    if (pager) {
        pager.prev.addEventListener("click", () => {
            page--;
            render();
        });
        pager.next.addEventListener("click", () => {
            page++;
            render();
        });
        pager.size.addEventListener("change", () => {
            page = 1;
            render();
        });
    }

    return {
        // defaultSort applies until the user clicks a header themselves: { key, direction } or null
        setData(newRows, newColumns, defaultSort = null, forceSort = false) {
            if (forceSort) {
                userSorted = false; // a new search starts from its own sort, not the last header click
            }
            rows = newRows;
            columns = newColumns;
            message = null;
            page = 1;
            if (!userSorted || !columns.some((column) => column.key === sortKey)) {
                userSorted = false;
                sortKey = defaultSort ? defaultSort.key : null;
                sortDirection = defaultSort ? defaultSort.direction : "asc";
            }
            render();
        },
        setColumns(newColumns) {
            columns = newColumns;
            render();
        },
        setMessage(text, className = "") {
            rows = [];
            message = { text: text, className: className };
            render();
        },
        getRows: sortedRows,
        getColumns: () => columns
    };
}

/* ---------- sidebar navigation ---------- */

const viewTitles = {
    dashboard: "Dashboard",
    search: "Search facilities",
    dbsearch: "Search database",
    datasets: "Datasets",
    upload: "Upload data",
    epa: "EPA data service"
};

function showView(viewName) {
    document.querySelectorAll(".view").forEach((view) => {
        view.hidden = view.id !== `view-${viewName}`;
    });
    document.querySelectorAll("#sideNav button").forEach((button) => {
        button.classList.toggle("active", button.dataset.view === viewName);
    });
    document.getElementById("viewTitle").textContent = viewTitles[viewName];

    if (viewName === "search" && !searchLoaded) {
        runBasicSearch();
    }
    if (viewName === "datasets") {
        loadDatasets();
    }
}

document.getElementById("sideNav").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) {
        showView(button.dataset.view);
    }
});

// Any button with data-goto="viewName" jumps to that view
document.addEventListener("click", (event) => {
    const target = event.target.closest("[data-goto]");
    if (target) {
        showView(target.dataset.goto);
    }
});

/* ---------- dashboard: filters, summary cards, table ---------- */

const stateFilter = document.getElementById("stateFilter");
const facilityFilter = document.getElementById("facilityFilter");
const yearFilter = document.getElementById("yearFilter");
const facilitiesTable = document.getElementById("facilitiesTable");

function getDashboardRows() {
    return facilityData.filter((row) => {
        const matchesState = !stateFilter.value || row.state === stateFilter.value;
        const matchesFacility = !facilityFilter.value || row.facility === facilityFilter.value;
        const matchesYear = !yearFilter.value || String(row.year) === yearFilter.value;

        return matchesState && matchesFacility && matchesYear;
    });
}

function fillFilters() {
    fillSelect(stateFilter, getUniqueValues("state"));
    fillSelect(facilityFilter, getUniqueValues("facility"));
    fillSelect(yearFilter, getUniqueValues("year"));
    fillSelect(document.getElementById("bState"), getUniqueValues("state"));
    fillSelect(document.getElementById("bYear"), getUniqueValues("year"));
    fillSelect(document.getElementById("bFuel"), getUniqueValues("fuel"));
}

function sumBy(rows, field) {
    // Questionable rows can be imported with a missing CO2 or SO2, so treat those as 0
    return rows.reduce((total, row) => total + (Number(row[field]) || 0), 0);
}

function renderDashboard() {
    const rows = getDashboardRows();
    // Show the biggest emitters first
    const shownRows = [...rows].sort((a, b) => (Number(b.co2) || 0) - (Number(a.co2) || 0)).slice(0, 8);

    document.getElementById("kpiFacilities").textContent = new Set(
        rows.map((row) => row.id)
    ).size.toLocaleString();
    document.getElementById("kpiCo2").textContent = `${formatNumber(sumBy(rows, "co2"))} t`;
    document.getElementById("kpiSo2").textContent = `${formatNumber(sumBy(rows, "so2"))} t`;
    document.getElementById("kpiImported").textContent = importedOn;
    document.getElementById("lastUpdated").textContent = importedOn;

    let emptyText = "No records match these filters. Reset a filter to see more.";
    if (dashboardError) {
        emptyText = dashboardError;
    } else if (!facilityData.length) {
        emptyText = "The database is empty. Upload a file or retrieve data from the EPA data service to get started.";
    }

    facilitiesTable.querySelector("tbody").innerHTML = shownRows.length
        ? shownRows
              .map(
                  (row) => `
                    <tr>
                        <td>${escapeHtml(row.facility)}</td>
                        <td>${escapeHtml(row.state)}</td>
                        <td>${escapeHtml(row.unit)}</td>
                        <td>${escapeHtml(row.fuel)}</td>
                        <td class="num">${formatNumber(row.co2)}</td>
                        <td class="num">${formatNumber(row.so2)}</td>
                        <td>${escapeHtml(row.year)}</td>
                    </tr>`
              )
              .join("")
        : `<tr><td class="empty" colspan="7">${escapeHtml(emptyText)}</td></tr>`;

    document.getElementById("dashCount").textContent = rows.length
        ? `Showing the top ${shownRows.length} of ${rows.length.toLocaleString()} records by CO2.`
        : "";

    updateChart(rows);
}

[stateFilter, facilityFilter, yearFilter].forEach((filter) => {
    filter.addEventListener("change", renderDashboard);
});

// The "Latest import" card comes from the datasets table
async function refreshLatestImport() {
    try {
        const data = await apiRequest("/searchDatasets", { form: formWith({ value: "" }) });
        const dates = data.items.map((item) => parseDate(item.date)).filter(Boolean);
        importedOn = dates.length ? formatDateTime(new Date(Math.max(...dates))) : "No imports yet";
    } catch (error) {
        importedOn = "—";
    }
    document.getElementById("kpiImported").textContent = importedOn;
    document.getElementById("lastUpdated").textContent = importedOn;
}

// Re-read everything the dashboard shows. Called at start-up and after every import.
async function refreshAllData() {
    try {
        facilityData = await getFacilityRows();
        dashboardError = "";
    } catch (error) {
        facilityData = [];
        dashboardError = `Could not load data: ${error.message}`;
        showMessage(error.message, true);
    }
    // Search results and catalogs are stale after an import
    searchLoaded = false;
    fillFilters();
    renderDashboard();
    refreshLatestImport();
}

/* ---------- dashboard: trend chart ---------- */

function getEmissionsByYear(rows) {
    const years = [...new Set(rows.map((row) => row.year))].sort((a, b) => a - b);

    return years.map((year) => {
        const yearRows = rows.filter((row) => row.year === year);
        return { year: String(year), co2: sumBy(yearRows, "co2"), so2: sumBy(yearRows, "so2") };
    });
}

const chartData = {
    labels: [],
    datasets: [
        {
            label: "CO2 (t)",
            data: [],
            borderColor: "#386c47",
            backgroundColor: "rgba(56, 108, 71, 0.12)",
            borderWidth: 3,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.3,
            fill: true,
            yAxisID: "co2"
        },
        {
            label: "SO2 (t)",
            data: [],
            borderColor: "#c47a2c",
            backgroundColor: "#c47a2c",
            borderWidth: 3,
            pointRadius: 4,
            pointHoverRadius: 6,
            tension: 0.3,
            fill: false,
            yAxisID: "so2"
        }
    ]
};

const trendChart = new Chart(document.getElementById("trendChart"), {
    type: "line",
    data: chartData,
    options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
            mode: "index",
            intersect: false
        },
        plugins: {
            legend: {
                position: "bottom",
                labels: {
                    usePointStyle: true,
                    padding: 20
                }
            },
            tooltip: {
                callbacks: {
                    label: (context) =>
                        `${context.dataset.label}: ${context.parsed.y.toLocaleString()}`
                }
            }
        },
        scales: {
            co2: {
                type: "linear",
                position: "left",
                title: {
                    display: true,
                    text: "CO2 (tonnes)"
                },
                beginAtZero: false,
                grid: {
                    color: "rgba(38, 51, 47, 0.08)"
                }
            },
            so2: {
                type: "linear",
                position: "right",
                title: {
                    display: true,
                    text: "SO2 (tonnes)"
                },
                beginAtZero: false,
                grid: {
                    drawOnChartArea: false
                }
            }
        }
    }
});

function updateChart(rows) {
    const emissionsData = getEmissionsByYear(rows);

    trendChart.data.labels = emissionsData.map((entry) => entry.year);
    trendChart.data.datasets[0].data = emissionsData.map((entry) => entry.co2);
    trendChart.data.datasets[1].data = emissionsData.map((entry) => entry.so2);
    trendChart.update();
}

/* ---------- dashboard: buttons ---------- */

document.getElementById("exportCsvButton").addEventListener("click", () => {
    const rows = getDashboardRows();
    if (!rows.length) {
        showMessage("There are no records to export.", true);
        return;
    }
    downloadCsv("facility-emissions.csv", rowsToCsv(rows, dashboardColumns));
});

document.getElementById("uploadDataButton").addEventListener("click", () => {
    showView("upload");
});

document.getElementById("viewFullTableButton").addEventListener("click", () => {
    // Carry the dashboard filters over as Advanced search conditions
    const args = [];

    if (stateFilter.value) {
        args.push({ field: "state", op: "=", value: stateFilter.value });
    }
    if (facilityFilter.value) {
        args.push({ field: "facility_name", op: "=", value: facilityFilter.value });
    }
    if (yearFilter.value) {
        args.push({ field: "year", op: "=", value: Number(yearFilter.value) });
    }

    openAdvancedSearch({ args: args, format: {} });
});

document.getElementById("quickSearch").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = event.target.search.value.trim();

    bQuery.value = query;
    ["bState", "bYear", "bFuel"].forEach((id) => {
        document.getElementById(id).value = "";
    });
    searchLoaded = true;
    showView("search");
    activateTab("basic");
    runBasicSearch();
});

/* ---------- search: shared results, summary chips ---------- */

const DEFAULT_SORT = { key: "co2", direction: "desc" };

const resultsTable = document.getElementById("resultsTable");
const resSummary = document.getElementById("resSummary");
const resultsControl = createDataTable({
    table: resultsTable,
    countEl: document.getElementById("resCount"),
    pager: {
        info: document.getElementById("pageInfo"),
        prev: document.getElementById("prevPage"),
        next: document.getElementById("nextPage"),
        size: document.getElementById("pageSize")
    }
});

let searchLoaded = false;
let searchRequestId = 0;
let catalog = {}; // "distinct" values from the last unfiltered search

// Which columns the Search facilities table shows (the original 8 by default)
const visibleKeys = new Set(["facility_name", "facility_id", "state", "unit_id", "primary_fuel", "co2", "so2", "year"]);

function visibleColumns() {
    return catalogKeys.filter((key) => visibleKeys.has(key)).map(columnFor);
}

// Normal searches return full records. Grouped searches return only the grouped
// column(s) plus the summary, so their columns come from whatever the back end sent.
function resultColumns(rows) {
    if (!rows.length) {
        return visibleColumns();
    }
    const keys = Object.keys(rows[0]);
    if (keys.includes("facility_name") && keys.includes("unit_id")) {
        return visibleColumns();
    }
    return orderedKeys(keys).map(columnFor);
}

function renderColumnMenu() {
    const list = document.getElementById("colMenuList");
    list.innerHTML = catalogKeys
        .filter((key) => key !== "key")
        .map(
            (key) => `
                <label class="check">
                    <input type="checkbox" data-column="${key}" ${visibleKeys.has(key) ? "checked" : ""}>
                    ${escapeHtml(columnCatalog[key].label)}
                </label>`
        )
        .join("");
}

document.getElementById("colMenuList").addEventListener("change", (event) => {
    const box = event.target.closest("input[data-column]");
    if (!box) {
        return;
    }
    if (box.checked) {
        visibleKeys.add(box.dataset.column);
    } else if (visibleKeys.size > 1) {
        visibleKeys.delete(box.dataset.column);
    } else {
        box.checked = true;
        showMessage("Keep at least one column visible.", true);
    }
    resultsControl.setColumns(resultColumns(resultsControl.getRows()));
});

// Close the Columns menu when clicking elsewhere
document.addEventListener("click", (event) => {
    const menu = document.getElementById("colMenu");
    if (menu.open && !menu.contains(event.target)) {
        menu.open = false;
    }
});

function showChips(parts, className = "") {
    resSummary.innerHTML =
        `<span class="muted">Searched for:</span>` +
        parts.map((part) => `<span class="chip ${className}">${escapeHtml(part)}</span>`).join("");
}

// Runs one search request and puts the outcome in the results table.
// request: async function returning { items, distinct }
async function executeSearch({ request, summary, defaultSort, unfiltered }) {
    const requestId = ++searchRequestId;
    showChips(summary);
    resultsControl.setMessage("Searching…", "muted");

    try {
        const data = await request();
        if (requestId !== searchRequestId) {
            return; // a newer search has started, ignore this answer
        }
        searchLoaded = true;
        if (unfiltered) {
            catalog = data.distinct || {};
            updateDatalists();
        }
        resultsControl.setData(data.items, resultColumns(data.items), defaultSort);
    } catch (error) {
        if (requestId !== searchRequestId) {
            return;
        }
        resultsControl.setMessage(error.message, "err");
        showMessage(error.message, true);
    }
}

document.getElementById("downloadResults").addEventListener("click", () => {
    downloadTable("search-results.csv", resultsControl);
});

/* ---- turning a search into readable chips ---- */

const operatorLabels = {
    "=": "=",
    "≠": "≠",
    ">": ">",
    "≥": "≥",
    "<": "<",
    "≤": "≤",
    contains: "contains",
    starts_with: "starts with",
    ends_with: "ends with",
    in: "is any of",
    not_in: "is none of"
};

function describeCondition(condition) {
    const column = columnFor(condition.field);
    const show = (value) => (column.kind === "num" ? formatNumber(value) : String(value));
    const value = Array.isArray(condition.value) ? condition.value.map(show).join(", ") : show(condition.value);
    return `${column.label} ${operatorLabels[condition.op] || condition.op} ${value}`;
}

function describeFormat(format) {
    const parts = [];
    const group = format.group;
    const rank = format.rank;

    if (group) {
        const [fn, metric] = group.aggregate[0];
        const metricLabel = metric === "key" ? "records" : columnFor(metric).label;
        parts.push(`${aggregateLabels[fn]} ${metricLabel} by ${columnFor(group.by[0]).label}`);
    }
    if (rank) {
        const word = rank.direction === "bottom" ? "Lowest" : "Highest";
        const metric = columnFor(rank.metric).label;
        if (rank.n && rank.partition) {
            parts.push(`${word} ${rank.n} per ${columnFor(rank.partition).label} by ${metric}`);
        } else {
            parts.push(`${word} first by ${metric}`);
        }
    }
    if (format.n !== undefined) {
        parts.push(`First ${format.n} rows`);
    }
    return parts;
}

function describeSpec(spec) {
    const parts = [...(spec.args || []).map(describeCondition), ...describeFormat(spec.format || {})];
    return parts.length ? parts : ["All records"];
}

/* ---------- search: tabs ---------- */

function activateTab(name) {
    document.querySelectorAll("#view-search .tabs button").forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === name);
    });
    document.querySelectorAll("#view-search .tab-pane[data-pane]").forEach((pane) => {
        pane.hidden = pane.dataset.pane !== name;
    });
}

document.querySelector(".tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("button");
    if (tab) {
        activateTab(tab.dataset.tab);
    }
});

/* ---------- search: basic ---------- */

const basicForm = document.getElementById("basicForm");
const bQuery = document.getElementById("bQuery");

// API: POST /searchData?value=<text>&d=1 searches facility name, facility ID and unit ID.
// BACKEND NOTE: /searchData only takes the text, so the State / Year / Fuel dropdowns
// are applied here in the browser. To do it server-side, make getBasicData() read a
// "filters" argument and pass it as manage.search(conditions=condition, filters=...).
function runBasicSearch() {
    const text = bQuery.value.trim();
    const state = document.getElementById("bState").value;
    const year = document.getElementById("bYear").value;
    const fuel = document.getElementById("bFuel").value;

    const summary = [];
    if (text) {
        summary.push(`Name, ID or unit contains "${text}"`);
    }
    if (state) {
        summary.push(`State = ${state}`);
    }
    if (year) {
        summary.push(`Year = ${year}`);
    }
    if (fuel) {
        summary.push(`Fuel = ${fuel}`);
    }

    return executeSearch({
        request: async () => {
            const data = await apiRequest("/searchData", { query: { value: text, d: 1 } });
            const items = data.items.filter(
                (row) =>
                    (!state || row.state === state) &&
                    (!year || String(row.year) === year) &&
                    (!fuel || row.primary_fuel === fuel)
            );
            return { items: items, distinct: data.distinct };
        },
        summary: summary.length ? summary : ["All records"],
        defaultSort: DEFAULT_SORT,
        unfiltered: text === ""
    });
}

basicForm.addEventListener("submit", (event) => {
    event.preventDefault();
    runBasicSearch();
});

basicForm.addEventListener("reset", () => {
    setTimeout(runBasicSearch, 0);
});

/* ---------- search: advanced (multi-constraint) ---------- */

const conditionRows = document.getElementById("condRows");
const advForm = document.getElementById("advForm");

// Fields offered in Advanced search, grouped for the dropdown.
// Date columns are left out on purpose (see BACKEND NOTE 3 at the top).
const advancedFields = [
    { group: "Facility", fields: ["facility_name", "facility_id", "state", "county", "category", "latitude", "longitude"] },
    { group: "Unit", fields: ["unit_id", "type", "primary_fuel", "secondary_fuel"] },
    {
        group: "Annual record",
        fields: ["year", "co2", "so2", "nox", "gross", "heat_input", "steam_load", "operating_time", "so2_control", "nox_control", "pm", "program_code", "source"]
    }
];

const textOperators = [
    ["=", "equals"],
    ["≠", "is not"],
    ["contains", "contains"],
    ["starts_with", "starts with"],
    ["ends_with", "ends with"],
    ["in", "is any of (a, b)"],
    ["not_in", "is none of (a, b)"]
];
const numberOperators = [
    ["=", "="],
    ["≠", "≠"],
    [">", ">"],
    ["≥", "≥"],
    ["<", "<"],
    ["≤", "≤"],
    ["in", "is any of (a, b)"]
];

function operatorsFor(field) {
    return isNumericKind(columnFor(field).kind) ? numberOperators : textOperators;
}

const metricFields = ["co2", "so2", "nox", "gross", "heat_input", "steam_load", "operating_time"];
const partitionFields = ["state", "primary_fuel", "year", "facility_name", "type"];
const groupFields = ["state", "primary_fuel", "year", "facility_name", "county", "category", "type"];

const rankMetric = document.getElementById("rankMetric");
const rankDir = document.getElementById("rankDir");
const limitN = document.getElementById("limitN");
const limitPer = document.getElementById("limitPer");
const groupBy = document.getElementById("groupBy");
const aggFn = document.getElementById("aggFn");
const aggMetric = document.getElementById("aggMetric");

function fillOptionSelects() {
    const labelOf = (key) => columnFor(key).label;
    fillOptions(rankMetric, [...metricFields.map((key) => [key, labelOf(key)]), ["__agg", "The grouped summary"]]);
    fillOptions(limitPer, partitionFields.map((key) => [key, `per ${labelOf(key)}`]));
    fillOptions(groupBy, groupFields.map((key) => [key, labelOf(key)]));
    fillOptions(aggFn, [["sum", "Total"], ["avg", "Average"], ["max", "Maximum"], ["min", "Minimum"], ["cnt", "Count"]], false);
    fillOptions(aggMetric, [...metricFields.map((key) => [key, labelOf(key)]), ["key", "Records (for counts)"]], false);
}

function updateDatalists() {
    const box = document.getElementById("datalists");
    const lists = [];
    advancedFields.forEach((group) => {
        group.fields.forEach((field) => {
            const values = (catalog[field] || []).filter((value) => !isEmpty(value));
            // Only suggest for fields that behave like categories
            if (values.length && values.length <= 200) {
                values.sort((a, b) => (typeof a === "number" ? a - b : String(a).localeCompare(String(b))));
                lists.push(
                    `<datalist id="dl-${field}">${values.map((value) => `<option value="${escapeHtml(value)}"></option>`).join("")}</datalist>`
                );
            }
        });
    });
    box.innerHTML = lists.join("");
}

function addConditionRow(preset = { field: "state", op: "=", value: "" }) {
    const row = document.createElement("div");
    row.className = "cond";

    const fieldOptions = advancedFields
        .map(
            (group) =>
                `<optgroup label="${group.group}">${group.fields
                    .map((field) => `<option value="${field}">${escapeHtml(columnFor(field).label)}</option>`)
                    .join("")}</optgroup>`
        )
        .join("");

    row.innerHTML = `
        <select class="field" aria-label="Field">${fieldOptions}</select>
        <select class="operator" aria-label="Operator"></select>
        <input class="value" aria-label="Value" placeholder="Value" required>
        <button type="button" class="remove" aria-label="Remove condition">Remove</button>`;

    const fieldSelect = row.querySelector(".field");
    const operatorSelect = row.querySelector(".operator");
    const valueInput = row.querySelector(".value");

    function syncOperators(selected) {
        const operators = operatorsFor(fieldSelect.value);
        fillOptions(operatorSelect, operators, false);
        operatorSelect.value = operators.some(([value]) => value === selected) ? selected : "=";
    }

    function syncHints() {
        const numeric = isNumericKind(columnFor(fieldSelect.value).kind);
        const list = operatorSelect.value === "in" || operatorSelect.value === "not_in";
        valueInput.placeholder = list ? (numeric ? "e.g. 2023, 2024" : "e.g. KY, TN") : numeric ? "e.g. 500000" : "e.g. Coal";
        valueInput.setAttribute("list", `dl-${fieldSelect.value}`);
    }

    fieldSelect.value = preset.field;
    syncOperators(preset.op);
    valueInput.value = preset.value;
    syncHints();

    fieldSelect.addEventListener("change", () => {
        syncOperators(operatorSelect.value);
        syncHints();
    });
    operatorSelect.addEventListener("change", syncHints);
    row.querySelector(".remove").addEventListener("click", () => row.remove());

    conditionRows.append(row);
}

document.getElementById("addCond").addEventListener("click", () => addConditionRow());

function parseConditionValue(field, op, raw) {
    const column = columnFor(field);
    const isList = op === "in" || op === "not_in";
    const parts = (isList ? raw.split(",") : [raw]).map((part) => part.trim()).filter(Boolean);

    if (!parts.length) {
        throw new Error(`Enter a value for ${column.label}.`);
    }
    const converted = parts.map((part) => {
        if (isNumericKind(column.kind)) {
            const number = Number(part.replaceAll(",", ""));
            if (!Number.isFinite(number)) {
                throw new Error(`${column.label} needs a number (got "${part}").`);
            }
            return number;
        }
        return field === "state" ? part.toUpperCase() : part;
    });
    return isList ? converted : converted[0];
}

// Reads the Advanced form into the shape the back end expects:
//   { args: [{ field, op, value }], format: { group, rank, n } }
function readAdvancedSpec() {
    const args = Array.from(conditionRows.querySelectorAll(".cond")).map((row) => {
        const field = row.querySelector(".field").value;
        const op = row.querySelector(".operator").value;
        return { field: field, op: op, value: parseConditionValue(field, op, row.querySelector(".value").value) };
    });

    const format = {};
    const grouped = Boolean(groupBy.value);
    const aggregateMetric = aggMetric.value;

    if (grouped) {
        if (aggregateMetric === "key" && aggFn.value !== "cnt") {
            throw new Error("Only Count can be used with Records. Pick a measurement such as CO2 instead.");
        }
        format.group = { by: [groupBy.value], aggregate: [[aggFn.value, aggregateMetric]] };
    }

    const limit = limitN.value ? Number(limitN.value) : null;
    if (limit !== null && (!Number.isInteger(limit) || limit < 1)) {
        throw new Error("Keep first N rows needs a whole number of at least 1.");
    }

    if (rankMetric.value) {
        if (rankMetric.value === "__agg" && !grouped) {
            throw new Error("Choose a Group by value to rank by the grouped summary.");
        }
        const metric = rankMetric.value === "__agg" ? `${aggFn.value}_${aggregateMetric}` : rankMetric.value;
        format.rank = { metric: metric, direction: rankDir.value };
        if (limitPer.value) {
            if (limit === null) {
                throw new Error("Enter how many rows to keep per group.");
            }
            format.rank.n = limit;
            format.rank.partition = limitPer.value;
        } else if (limit !== null) {
            format.n = limit;
        }
    } else if (limitPer.value) {
        throw new Error("Pick a Rank by value to keep rows per group.");
    } else if (limit !== null) {
        format.n = limit;
    }

    return { args: args, format: format };
}

// Puts a spec back into the Advanced form (used by Dashboard, Datasets and Describe)
function writeAdvancedSpec(spec) {
    conditionRows.innerHTML = "";
    (spec.args || []).forEach((arg) =>
        addConditionRow({
            field: arg.field,
            op: arg.op,
            value: Array.isArray(arg.value) ? arg.value.join(", ") : arg.value
        })
    );
    if (!(spec.args || []).length) {
        addConditionRow();
    }

    const format = spec.format || {};
    const group = format.group;
    const rank = format.rank;

    groupBy.value = group ? group.by[0] : "";
    if (group) {
        aggFn.value = group.aggregate[0][0];
        aggMetric.value = group.aggregate[0][1];
    }
    rankMetric.value = "";
    rankDir.value = "top";
    limitPer.value = "";
    limitN.value = "";
    if (rank) {
        rankMetric.value = group && rank.metric === `${group.aggregate[0][0]}_${group.aggregate[0][1]}` ? "__agg" : rank.metric;
        rankDir.value = rank.direction;
        limitPer.value = rank.partition || "";
        limitN.value = rank.n || "";
    }
    if (format.n !== undefined) {
        limitN.value = format.n;
    }
}

// API: POST /searchAdvanced with form field conditions = JSON of the spec
function runAdvancedSearch(spec) {
    const format = spec.format || {};
    const reordered = Boolean(format.rank || format.group);
    return executeSearch({
        request: () => apiRequest("/searchAdvanced", { form: formWith({ conditions: JSON.stringify(spec) }) }),
        summary: describeSpec(spec),
        // ranked and grouped results arrive in the order the back end built them
        defaultSort: reordered ? null : DEFAULT_SORT,
        unfiltered: !(spec.args || []).length && !Object.keys(format).length
    });
}

// Show a spec in the Advanced tab and run it
function openAdvancedSearch(spec) {
    searchLoaded = true;
    showView("search");
    activateTab("advanced");
    writeAdvancedSpec(spec);
    runAdvancedSearch(spec);
}

advForm.addEventListener("submit", (event) => {
    event.preventDefault();
    let spec;
    try {
        spec = readAdvancedSpec();
    } catch (error) {
        showMessage(error.message, true);
        return;
    }
    runAdvancedSearch(spec);
});

advForm.addEventListener("reset", () => {
    // Native reset clears the option boxes; the condition rows are built by script
    setTimeout(() => {
        conditionRows.innerHTML = "";
        addConditionRow();
    }, 0);
});

/* ---------- search: description-based ---------- */

const stateNames = {
    alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA", colorado: "CO",
    connecticut: "CT", delaware: "DE", "district of columbia": "DC", florida: "FL", georgia: "GA",
    hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY",
    louisiana: "LA", maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
    mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH",
    "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
    ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
    virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY"
};

// Fuel words and the text the back end should look for in the fuel name (a "contains" match)
const fuelRules = [
    [/\bcoal\b/, "coal"],
    [/\b(natural gas|pipeline gas)\b/, "natural gas"],
    [/\bgas\b/, "gas"],
    [/\bdiesel\b/, "diesel"],
    [/\boil\b/, "oil"],
    [/\bwood\b/, "wood"]
];

const metricRules = [
    [/\bco2\b|carbon/, "co2"],
    [/\bso2\b|sulfur|sulphur/, "so2"],
    [/\bnox\b|nitrogen/, "nox"],
    [/heat input/, "heat_input"],
    [/gross load|generation/, "gross"]
];

// What counts as "high" and "low" for each measurement
const highLevels = { co2: 500000, so2: 1000, nox: 1000, heat_input: 5000000, gross: 1000000 };
const lowLevels = { co2: 150000, so2: 300, nox: 300, heat_input: 500000, gross: 100000 };

const groupWords = {
    state: "state",
    fuel: "primary_fuel",
    "fuel type": "primary_fuel",
    year: "year",
    facility: "facility_name",
    county: "county",
    "unit type": "type",
    category: "category"
};
const aggregateWords = {
    total: "sum", sum: "sum", average: "avg", avg: "avg", mean: "avg",
    maximum: "max", max: "max", minimum: "min", min: "min", count: "cnt", "number of": "cnt"
};

function metricMentions(text) {
    const found = [];
    metricRules.forEach(([pattern, metric]) => {
        for (const match of text.matchAll(new RegExp(pattern.source, "g"))) {
            found.push({ metric: metric, index: match.index });
        }
    });
    return found.sort((a, b) => a.index - b.index);
}

// Turns a sentence into a search spec ({ args, format }) with simple keyword rules.
function interpretDescription(text) {
    const lowerText = ` ${text.toLowerCase()} `;
    let remaining = lowerText;
    const args = [];
    const format = {};

    // --- states: full names first (longest first so "west virginia" beats "virginia")
    const found = [];
    Object.keys(stateNames)
        .sort((a, b) => b.length - a.length)
        .forEach((name) => {
            const pattern = new RegExp(`\\b${name}\\b`);
            if (pattern.test(remaining)) {
                found.push({ code: stateNames[name], index: lowerText.search(pattern) });
                remaining = remaining.replace(pattern, " ");
            }
        });
    // keep them in the order they were typed
    const states = found.sort((a, b) => a.index - b.index).map((item) => item.code);
    // ...then two-letter codes typed in capitals that exist in the data
    getUniqueValues("state").forEach((abbreviation) => {
        if (new RegExp(`\\b${abbreviation}\\b`).test(text) && !states.includes(abbreviation)) {
            states.push(abbreviation);
        }
    });
    if (states.length === 1) {
        args.push({ field: "state", op: "=", value: states[0] });
    } else if (states.length > 1) {
        args.push({ field: "state", op: "in", value: states });
    }

    // --- fuel
    for (const [pattern, fuel] of fuelRules) {
        if (pattern.test(remaining)) {
            args.push({ field: "primary_fuel", op: "contains", value: fuel });
            break;
        }
    }

    // --- which measurement is being talked about
    const mentions = metricMentions(remaining);
    const firstMetric = mentions.length ? mentions[0].metric : "co2";

    // --- an explicit amount: "over 500,000", "below 2 million", "at least 300k"
    const thresholdPattern =
        /\b(over|above|greater than|more than|exceeding|exceeds|at least|under|below|less than|fewer than|at most)\s+([\d,]*\.?\d+)\s*(k|thousand|million|m|billion)?\b/;
    const amountMatch = remaining.match(thresholdPattern);
    let hasAmount = false;
    if (amountMatch) {
        hasAmount = true;
        const multipliers = { k: 1e3, thousand: 1e3, m: 1e6, million: 1e6, billion: 1e9 };
        const amount = Number(amountMatch[2].replaceAll(",", "")) * (multipliers[amountMatch[3]] || 1);
        const before = mentions.filter((mention) => mention.index < amountMatch.index);
        const metric = before.length ? before[before.length - 1].metric : firstMetric;
        const word = amountMatch[1];
        let op = /over|above|greater|more|exceed/.test(word) ? ">" : "<";
        if (word === "at least") {
            op = "≥";
        } else if (word === "at most") {
            op = "≤";
        }
        args.push({ field: metric, op: op, value: amount });
        remaining = remaining.replace(amountMatch[0], " ");
    }

    // --- years: one year, a range, or a list
    const years = [...remaining.matchAll(/\b(?:19|20)\d{2}\b/g)].map((match) => Number(match[0]));
    if (years.length === 2 && /between|from|through|\bto\b|-|–/.test(remaining)) {
        args.push({ field: "year", op: "≥", value: Math.min(...years) });
        args.push({ field: "year", op: "≤", value: Math.max(...years) });
    } else if (years.length === 1) {
        const year = years[0];
        let op = "=";
        if (new RegExp(`\\bafter\\s+${year}\\b`).test(remaining)) {
            op = ">";
        } else if (new RegExp(`\\bsince\\s+${year}\\b`).test(remaining)) {
            op = "≥";
        } else if (new RegExp(`\\bbefore\\s+${year}\\b`).test(remaining)) {
            op = "<";
        }
        args.push({ field: "year", op: op, value: year });
    } else if (years.length > 1) {
        args.push({ field: "year", op: "in", value: [...new Set(years)].sort() });
    }

    // --- ranking: "top 5", "highest", "lowest 10"...
    const topMatch = remaining.match(/\b(?:top|highest|largest|biggest|dirtiest|worst)\s+(\d+)\b|\b(\d+)\s+(?:highest|largest|biggest|dirtiest|worst)\b/);
    const bottomMatch = remaining.match(/\b(?:bottom|lowest|smallest|cleanest)\s+(\d+)\b|\b(\d+)\s+(?:lowest|smallest|cleanest)\b/);
    let direction = null;
    let rankCount = null;
    if (topMatch) {
        direction = "top";
        rankCount = Number(topMatch[1] || topMatch[2]);
    } else if (bottomMatch) {
        direction = "bottom";
        rankCount = Number(bottomMatch[1] || bottomMatch[2]);
    } else if (/\b(highest|largest|biggest|dirtiest|worst|top)\b/.test(remaining)) {
        direction = "top";
        rankCount = 10;
    } else if (/\b(lowest|smallest|cleanest|bottom)\b/.test(remaining)) {
        direction = "bottom";
        rankCount = 10;
    }

    // --- "high" / "low" without a number become a fixed level
    if (!hasAmount && !direction) {
        if (/\bhigh\b/.test(remaining)) {
            args.push({ field: firstMetric, op: ">", value: highLevels[firstMetric] });
        } else if (/\blow\b/.test(remaining)) {
            args.push({ field: firstMetric, op: "<", value: lowLevels[firstMetric] });
        }
    }

    // --- summaries: "total CO2 by state", "number of units per fuel"
    const aggregateMatch = remaining.match(/\b(total|sum|average|avg|mean|maximum|max|minimum|min|count|number of)\b/);
    const groupMatch = remaining.match(/\b(?:by|per|for each|in each|each|every)\s+(state|fuel type|fuel|year|facility|county|unit type|category)\b/);
    let aggregateName = null;

    if (aggregateMatch && groupMatch) {
        const fn = aggregateWords[aggregateMatch[1]];
        const metric = fn === "cnt" ? "key" : firstMetric;
        aggregateName = `${fn}_${metric}`;
        format.group = { by: [groupWords[groupMatch[1]]], aggregate: [[fn, metric]] };
    }

    if (direction) {
        format.rank = { metric: aggregateName || firstMetric, direction: direction };
        if (groupMatch && !aggregateName) {
            // "top 3 emitters per state": keep the first N inside each group
            format.rank.n = rankCount;
            format.rank.partition = groupWords[groupMatch[1]];
        } else {
            format.n = rankCount;
        }
    }

    return { args: args, format: format };
}

const descForm = document.getElementById("descForm");
const interpretation = document.getElementById("interp");
let lastDescribedSpec = null;

descForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const spec = interpretDescription(document.getElementById("dText").value);
    interpretation.hidden = false;

    if (!spec.args.length && !Object.keys(spec.format).length) {
        lastDescribedSpec = null;
        interpretation.innerHTML =
            `<span class="err">No search terms found. Try naming a state, fuel, year or emission level, e.g. "coal units in Kentucky over 500,000 tons of CO2".</span>`;
        return;
    }

    lastDescribedSpec = spec;
    interpretation.innerHTML =
        `<span class="muted">Interpreted as:</span>` +
        describeSpec(spec)
            .map((part) => `<span class="chip">${escapeHtml(part)}</span>`)
            .join("") +
        `<button type="button" class="chip-button" data-action="edit">Edit in Advanced</button>` +
        `<button type="button" class="chip-button" data-action="json">Show query</button>` +
        `<pre class="json-view" hidden>${escapeHtml(JSON.stringify(spec, null, 2))}</pre>`;

    runAdvancedSearch(spec);
});

interpretation.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) {
        return;
    }
    if (button.dataset.action === "json") {
        const view = interpretation.querySelector(".json-view");
        view.hidden = !view.hidden;
    } else if (lastDescribedSpec) {
        activateTab("advanced");
        writeAdvancedSpec(lastDescribedSpec);
    }
});

descForm.addEventListener("click", (event) => {
    const example = event.target.closest("button[data-example]");
    if (example) {
        document.getElementById("dText").value = example.dataset.example;
        descForm.requestSubmit();
    }
});

/* ---------- search database (every column, straight from /searchData) ---------- */

const dbForm = document.getElementById("dbSearchForm");
const dbScope = document.getElementById("dbScope");
const dbFieldsBox = document.getElementById("dbFieldsBox");
const dbFieldList = document.getElementById("dbFieldList");
const dbEmpty = document.getElementById("dbEmpty");
let dbRequestId = 0;

const dbControl = createDataTable({
    table: document.getElementById("dbResultsTable"),
    countEl: document.getElementById("dbResCount"),
    pager: {
        info: document.getElementById("dbPageInfo"),
        prev: document.getElementById("dbPrev"),
        next: document.getElementById("dbNext"),
        size: document.getElementById("dbPageSize")
    },
    emptyMessage: "Nothing in the database matches that search."
});

// Dates are skipped by the back end's text search, so they are not offered as choices
const dbSearchFields = catalogKeys.filter((key) => columnCatalog[key].kind !== "date");

function renderDbFieldList() {
    dbFieldList.innerHTML = dbSearchFields
        .map(
            (key) => `
                <label class="check">
                    <input type="checkbox" value="${key}" checked>
                    ${escapeHtml(columnCatalog[key].label)}
                </label>`
        )
        .join("");
}

dbScope.addEventListener("change", () => {
    dbFieldsBox.hidden = dbScope.value !== "custom";
});

// API: POST /searchData?value=<text> plus
//   d=1                      -> look only in facility name, facility ID and unit ID
//   exempt=["co2", ...]      -> look in every column except these
//   (neither)                -> look in every column
dbForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const query = { value: document.getElementById("dbQuery").value.trim() };

    if (dbScope.value === "names") {
        query.d = 1;
    } else if (dbScope.value === "custom") {
        const checked = [...dbFieldList.querySelectorAll("input:checked")].map((box) => box.value);
        if (!checked.length) {
            showMessage("Pick at least one column to search.", true);
            return;
        }
        // Everything that is not ticked is "exempt" (dates are always skipped by the back end)
        query.exempt = JSON.stringify(dbSearchFields.filter((key) => !checked.includes(key)));
    }

    const requestId = ++dbRequestId;
    dbEmpty.hidden = true;
    dbControl.setMessage("Searching…", "muted");
    try {
        const data = await apiRequest("/searchData", { query: query });
        if (requestId !== dbRequestId) {
            return;
        }
        const keys = data.items.length ? Object.keys(data.items[0]) : catalogKeys;
        dbControl.setData(data.items, orderedKeys(keys).map(columnFor), currentDbSort(), true);
    } catch (error) {
        if (requestId !== dbRequestId) {
            return;
        }
        dbControl.setMessage(error.message, "err");
        showMessage(error.message, true);
    }
});

dbForm.addEventListener("reset", () => {
    dbRequestId++;
    setTimeout(() => {
        dbFieldsBox.hidden = true;
        dbControl.setData([], []);
        dbEmpty.hidden = false;
    }, 0);
});

document.getElementById("dbDownload").addEventListener("click", () => {
    downloadTable("database-search.csv", dbControl);
});

/* ---------- datasets ---------- */

const datasetsControl = createDataTable({
    table: document.getElementById("datasetsTable"),
    countEl: document.getElementById("dsCount"),
    emptyMessage: "No datasets yet. Upload a file or retrieve data from the EPA data service.",
});

const datasetColumns = [
    { key: "name", label: "Dataset", kind: "text" },
    { key: "source", label: "Source", kind: "text", format: (value) => (value === "api" ? "EPA API" : "File upload") },
    { key: "years", label: "Reporting years", kind: "text", format: formatYears },
    { key: "date", label: "Imported", kind: "date", format: (value) => formatDateTime(value) },
    { key: "file_name", label: "File", kind: "text" },
    { key: "raw", label: "Rows read", kind: "num" },
    { key: "accepted", label: "Rows imported", kind: "num" },
    { key: "notes", label: "Notes", kind: "text", wrap: true },
    {
        key: "name",
        label: "",
        html: (row) =>
            `<button type="button" class="secondary-button" data-dataset="${escapeHtml(row.name)}">View records</button> ` +
            `<button type="button" class="secondary-button" data-download="${escapeHtml(row.name)}">Download CSV</button>`
    }
];

// API: POST /searchDatasets with form field value
async function loadDatasets(text = "") {
    datasetsControl.setMessage("Loading…", "muted");
    try {
        const data = await apiRequest("/searchDatasets", { form: formWith({ value: text }) });
        // Newest import first; the dates arrive as text so the table sorts them by their real value
        const rows = data.items.map((item) => ({ ...item, date: item.date }));
        rows.sort((a, b) => (parseDate(b.date) || 0) - (parseDate(a.date) || 0));
        datasetsControl.setData(rows, datasetColumns, null);
    } catch (error) {
        datasetsControl.setMessage(error.message, "err");
        showMessage(error.message, true);
    }
}

document.getElementById("dsForm").addEventListener("submit", (event) => {
    event.preventDefault();
    loadDatasets(document.getElementById("dsQuery").value.trim());
});

document.getElementById("dsForm").addEventListener("reset", () => {
    setTimeout(() => loadDatasets(), 0);
});

// "View records": every annual record carries the name of the dataset that imported it (field "source")
document.getElementById("datasetsTable").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-dataset]");
    if (button) {
        openAdvancedSearch({ args: [{ field: "source", op: "=", value: button.dataset.dataset }], format: {} });
    }
});

// Used before an upload so a duplicate name is caught early (the back end only
// notices when you click Import, after the preview has already been used up)
async function datasetNameTaken(name) {
    const data = await apiRequest("/searchDatasets", { form: formWith({ value: name }) });
    return data.items.some((item) => item.name === name);
}

/* ---------- import review: shared by Upload and the EPA data service ---------- */

// The 25 columns the back end expects, in order (services.Upload.columns)
const uploadColumns = [
    "State", "Facility Name", "Facility ID", "Unit ID", "Associated Stacks", "Year",
    "Operating Time Count", "Sum of the Operating Time", "Gross Load (MWh)",
    "Steam Load (1000 lb)", "SO2 Mass (short tons)", "SO2 Rate (lbs/mmBtu)",
    "CO2 Mass (short tons)", "CO2 Rate (short tons/mmBtu)", "NOx Mass (short tons)",
    "NOx Rate (lbs/mmBtu)", "Heat Input (mmBtu)", "Primary Fuel Type", "Secondary Fuel Type",
    "Unit Type", "SO2 Controls", "NOx Controls", "PM Controls", "Hg Controls", "Program Code"
];

// The back end sends each row as an array: [pandasIndex, State, Facility Name, ...].
// Position n holds uploadColumns[n - 1].
// These are the positions services.Upload checks (self.reject and self.suspicious).
const requiredPositions = [1, 2, 3, 4, 6, 7, 8, 18, 20, 25]; // missing/bad -> rejected
const usefulPositions = [9, 17, 13, 11, 15, 22, 23]; // missing/bad -> questionable
const numericPositions = [3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17];

// The back end only says which bucket a row landed in, so work out why here
function findIssues(row, watched) {
    const check = (positions) => {
        const issues = [];
        positions.forEach((position) => {
            const value = row[position];
            const name = uploadColumns[position - 1];
            if (isEmpty(value)) {
                issues.push(`Missing ${name}`);
            } else if (numericPositions.includes(position) && (typeof value !== "number" || value < 0)) {
                issues.push(`Invalid ${name} (${value})`);
            }
        });
        return issues;
    };

    let issues = check(watched);
    if (!issues.length) {
        issues = check(numericPositions);
    }
    return issues.length ? issues.join("; ") : "Did not pass the validation rules";
}

// Columns shown in the report previews: [label, position]
const previewColumns = [["State", 1], ["Facility", 2], ["Facility ID", 3], ["Unit", 4], ["Year", 6], ["SO2 (t)", 11], ["CO2 (t)", 13]];

function previewTable(items, watched, limit) {
    const shown = items.slice(0, limit);
    const issueHeader = watched ? "<th>Problem</th>" : "";
    const head = `<tr><th>File row</th>${previewColumns.map(([label]) => `<th>${label}</th>`).join("")}${issueHeader}</tr>`;
    const rows = shown
        .map((row) => {
            const cells = previewColumns.map(([, position]) => `<td>${escapeHtml(isEmpty(row[position]) ? "—" : row[position])}</td>`).join("");
            const issue = watched ? `<td class="wrap">${escapeHtml(findIssues(row, watched))}</td>` : "";
            // pandas row 0 is line 2 of the file (line 1 is the header)
            return `<tr><td>${row[0] + 2}</td>${cells}${issue}</tr>`;
        })
        .join("");
    const more = items.length > limit ? `<p class="muted">…and ${items.length - limit} more not shown.</p>` : "";
    return `<div class="table-wrap short"><table><thead>${head}</thead><tbody>${rows}</tbody></table></div>${more}`;
}

function reportSection(title, count, body, open) {
    return count ? `<details class="report-section" ${open ? "open" : ""}><summary>${title} (${count})</summary>${body}</details>` : "";
}

function renderQualityReport(parsed) {
    const valid = parsed.Valid.items;
    const warning = parsed.Warning.items;
    const invalid = parsed.Invalid.items;
    const duplicates = parsed.Indexes;
    const total = valid.length + warning.length + invalid.length + duplicates.length;

    const duplicateRows = duplicates.map((index) => index + 2).sort((a, b) => a - b);
    const duplicateText =
        `<p class="muted">Rows ${duplicateRows.slice(0, 15).join(", ")}${duplicateRows.length > 15 ? `, and ${duplicateRows.length - 15} more` : ""} repeat an earlier facility, unit and year, so only the first one is kept.</p>`;

    return `
        <div class="stat-row">
            <div class="stat good"><strong>${valid.length}</strong><span>Ready to import</span></div>
            <div class="stat warn"><strong>${warning.length}</strong><span>Questionable</span></div>
            <div class="stat bad"><strong>${invalid.length}</strong><span>Rejected</span></div>
            <div class="stat dup"><strong>${duplicates.length}</strong><span>Duplicates (skipped)</span></div>
        </div>
        <p class="muted">${total} rows read. Questionable rows are missing optional data and are only imported if you tick the box. Rejected rows and duplicates are never imported.</p>
        ${reportSection("Rejected rows", invalid.length, previewTable(invalid, requiredPositions, 20), true)}
        ${reportSection("Questionable rows", warning.length, previewTable(warning, usefulPositions, 20), true)}
        ${reportSection("Duplicate rows", duplicates.length, duplicateText, false)}
        ${reportSection("Rows ready to import", valid.length, previewTable(valid, null, 10), false)}`;
}

// options: { reportEl, importButton, cancelButton, questionBox, finishPath, onFinished(accepted, result) }
// finishPath is /finishUpload for a file and /secondRetrieve for an EPA retrieval; both take the same fields.
function createImportSession(options) {
    const { reportEl, importButton, cancelButton, questionBox, finishPath } = options;
    let pending = null; // { id, valid, warning }

    function updateImportLabel() {
        if (!pending) {
            importButton.textContent = "Import valid rows";
            return;
        }
        const count = pending.valid + (questionBox.checked ? pending.warning : 0);
        importButton.textContent = `Import ${count} ${count === 1 ? "row" : "rows"}`;
        importButton.disabled = count === 0;
    }

    function setButtons(enabled) {
        importButton.disabled = !enabled;
        cancelButton.disabled = !enabled;
    }

    questionBox.addEventListener("change", updateImportLabel);

    async function finish(accept) {
        if (!pending) {
            return;
        }
        const id = pending.id;
        setButtons(false);
        showMessage(accept ? "Importing…" : "Cancelling…");

        const form = formWith({ uploadID: id });
        if (accept) {
            form.append("push", 1);
            if (questionBox.checked) {
                form.append("question", 1);
            }
        }

        try {
            const result = await apiRequest(finishPath, { form: form });
            pending = null;
            updateImportLabel();
            if (accept) {
                const dropped = result.dropped
                    ? `<p class="muted">${result.dropped} rows could not be saved (already in the database, or EPA facility details were unavailable).</p>`
                    : "";
                reportEl.innerHTML =
                    `<p class="ok"><strong>Imported ${result.rows} records.</strong></p>${dropped}` +
                    `<div class="row-actions"><button type="button" class="secondary-button" data-goto="dashboard">View dashboard</button>` +
                    `<button type="button" class="secondary-button" data-goto="datasets">View datasets</button></div>`;
                showMessage(`Imported ${result.rows} records.`);
            } else {
                reportEl.innerHTML = `<p class="err">${escapeHtml(result.message)}. Nothing was saved.</p>`;
            }
            await options.onFinished(accept, result);
        } catch (error) {
            if (error.network) {
                // The request never reached the server, so the preview is still waiting
                setButtons(true);
                updateImportLabel();
            } else {
                // The server uses up the preview even when saving fails
                pending = null;
                updateImportLabel();
                reportEl.innerHTML =
                    `<p class="err">${escapeHtml(error.message)}</p><p class="muted">The preview has been used up, so start again from the top.</p>`;
                await options.onFinished(false, null);
            }
            showMessage(error.message, true);
        }
    }

    importButton.addEventListener("click", () => finish(true));
    cancelButton.addEventListener("click", () => finish(false));

    return {
        show(parsed) {
            pending = { id: parsed.uploadID, valid: parsed.Valid.items.length, warning: parsed.Warning.items.length };
            reportEl.hidden = false;
            reportEl.innerHTML = renderQualityReport(parsed);
            cancelButton.disabled = false;
            importButton.disabled = false;
            updateImportLabel();
        },
        showError(message) {
            pending = null;
            setButtons(false);
            updateImportLabel();
            reportEl.hidden = false;
            reportEl.innerHTML = `<p class="err">${escapeHtml(message)}</p>`;
        },
        showNote(html) {
            pending = null;
            setButtons(false);
            updateImportLabel();
            reportEl.hidden = false;
            reportEl.innerHTML = html;
        },
        isPending: () => pending !== null
    };
}

/* ---------- upload and import ---------- */

const dataFileInput = document.getElementById("dataFileInput");
const dropZone = document.getElementById("dropZone");
const uploadReport = document.getElementById("uploadReport");
const datasetName = document.getElementById("datasetName");

document.getElementById("uploadCols").textContent = uploadColumns.join(", ");

const uploadSession = createImportSession({
    reportEl: uploadReport,
    importButton: document.getElementById("importButton"),
    cancelButton: document.getElementById("cancelButton"),
    questionBox: document.getElementById("pushQuestion"),
    finishPath: "/finishUpload",
    onFinished: async (accepted) => {
        document.getElementById("fileName").textContent = "";
        if (accepted) {
            await refreshAllData();
        }
    }
});

// API: POST /upload (file, name, notes) -> { uploadID, Valid, Warning, Invalid, Indexes }
async function firstPass(file) {
    const payload = new FormData();
    payload.append("file", file);
    payload.append("notes", document.getElementById("datasetNotes").value);
    payload.append("name", datasetName.value.trim());
    return apiRequest("/upload", { form: payload });
}

async function handleUploadedFile(file) {
    if (!file) {
        return;
    }
    uploadSession.showNote("");
    document.getElementById("fileName").textContent = file.name;

    if (!datasetName.value.trim()) {
        uploadSession.showError("Enter a dataset name first, then choose the file again.");
        datasetName.focus();
        dataFileInput.value = "";
        return;
    }
    if (!/\.(csv|xlsx)$/i.test(file.name)) {
        uploadSession.showError("Not CSV or Excel File. Choose a .csv or .xlsx file.");
        dataFileInput.value = "";
        return;
    }
    // Check File Size
    const maxData = 50 * 1024 * 1024;
    if (file.size > maxData) {
        uploadSession.showError("File Size is too Large (50 MB maximum).");
        dataFileInput.value = "";
        return;
    }

    uploadSession.showNote('<p class="muted">Checking file…</p>');
    try {
        if (await datasetNameTaken(datasetName.value.trim())) {
            uploadSession.showError(`A dataset called "${datasetName.value.trim()}" already exists. Pick a different name.`);
            return;
        }
        // First pass: the back end validates the file and returns the report
        uploadSession.show(await firstPass(file));
    } catch (error) {
        uploadSession.showError(error.message);
    } finally {
        // Lets the same file be chosen again after fixing it
        dataFileInput.value = "";
    }
}

dropZone.addEventListener("click", () => dataFileInput.click());

dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        dataFileInput.click();
    }
});

dataFileInput.addEventListener("change", () => handleUploadedFile(dataFileInput.files[0]));

["dragover", "dragenter"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.add("over");
    });
});

["dragleave", "drop"].forEach((eventName) => {
    dropZone.addEventListener(eventName, (event) => {
        event.preventDefault();
        dropZone.classList.remove("over");
    });
});

dropZone.addEventListener("drop", (event) => handleUploadedFile(event.dataTransfer.files[0]));

// The template has to match the back end's 25 columns exactly or the upload is refused
document.getElementById("templateButton").addEventListener("click", () => {
    const sample = [
        "KY", "Ghent Generating Station", 1356, "1", "CS001", 2023, 8000, 7500, 3000000, "",
        1200, 0.15, 4500000, 0.1, 900, 0.09, 40000000, "Coal", "", "Tangentially-fired",
        "Wet Limestone", "Selective Catalytic Reduction", "Baghouse", "", "ARP, CSAPR"
    ];
    downloadCsv("epa-upload-template.csv", [uploadColumns.map(csvCell).join(","), sample.map(csvCell).join(",")].join("\n"));
});

/* ---------- EPA data service ---------- */

const epaForm = document.getElementById("epaForm");
const epaLog = document.getElementById("epaLog");
const epaReport = document.getElementById("epaReport");
const epaActions = document.getElementById("epaActions");
let epaLogEntry = null;
let epaLogText = "";

function addEpaLog(html) {
    if (epaLog.firstElementChild && epaLog.firstElementChild.classList.contains("muted")) {
        epaLog.innerHTML = "";
    }
    const entry = document.createElement("li");
    entry.innerHTML = html;
    epaLog.prepend(entry);
    return entry;
}

const epaSession = createImportSession({
    reportEl: epaReport,
    importButton: document.getElementById("epaImport"),
    cancelButton: document.getElementById("epaCancel"),
    questionBox: document.getElementById("epaPushQuestion"),
    finishPath: "/secondRetrieve",
    onFinished: async (accepted, result) => {
        if (epaLogEntry) {
            const outcome = result
                ? accepted
                    ? `imported ${result.rows} records${result.dropped ? ` (${result.dropped} not saved)` : ""}`
                    : "cancelled, nothing saved"
                : "import failed";
            epaLogEntry.innerHTML = `${epaLogText} <span class="muted">${escapeHtml(outcome)}</span>`;
        }
        if (accepted) {
            await refreshAllData();
        }
    }
});

function fillEpaForm() {
    const years = [];
    for (let year = 2025; year >= 2000; year--) {
        years.push(year);
    }

    fillSelect(document.getElementById("eState"), ["AL", "AK", "AS", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FM", "FL", "GA", "GU", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MH", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "MP", "OH", "OK", "OR", "PW", "PA", "PR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VI", "VA", "WA", "WV", "WI", "WY"], false);
    fillSelect(document.getElementById("eFrom"), years, false);
    fillSelect(document.getElementById("eTo"), years, false);
    document.getElementById("eState").value = "KY";
    document.getElementById("eFrom").value = "2020";
    document.getElementById("eTo").value = "2025";
}

// API: POST /epa?state=&from=&to=[&facility=&fuel=&unit=] with form field amount.
// Returns the same quality report as /upload; /secondRetrieve then saves it.
// BACKEND NOTE: see note 1 at the top of this file. As written, /epa fails on the
// "args" variable and the DataFrame loop, and retrieveCnt never increases, so only
// the first retrieval can ever be imported.
epaForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = document.getElementById("eState").value;
    const fromYear = Number(document.getElementById("eFrom").value);
    const toYear = Number(document.getElementById("eTo").value);
    const amount = Number(document.getElementById("eAmount").value);

    if (fromYear > toYear) {
        showMessage("From year must not be later than To year.", true);
        return;
    }
    if (!Number.isInteger(amount) || amount < 1) {
        showMessage("Max records must be a whole number of at least 1.", true);
        return;
    }

    const query = { state: state, from: fromYear, to: toYear };
    const optional = { facility: "eFacility", fuel: "eFuel", unit: "eUnit" };
    Object.entries(optional).forEach(([name, id]) => {
        const value = document.getElementById(id).value.trim();
        if (value) {
            query[name] = value;
        }
    });

    const label = `${state}, ${fromYear}-${toYear}`;
    const submit = document.getElementById("epaSubmission");
    submit.disabled = true;
    submit.textContent = "Retrieving…";
    epaSession.showNote('<p class="muted">Asking the EPA for data. This can take a little while…</p>');
    epaActions.hidden = false;
    showMessage("Attempting retrieval");

    epaLogText = `${new Date().toLocaleTimeString()}: requested ${escapeHtml(label)}`;
    epaLogEntry = addEpaLog(epaLogText);

    try {
        const result = await apiRequest("/epa", { query: query, form: formWith({ amount: amount }) });
        const counts =
            `${result.Valid.items.length} valid, ${result.Warning.items.length} questionable, ` +
            `${result.Invalid.items.length} rejected, ${result.Indexes.length} duplicates`;
        epaLogText += ` (${counts})`;
        epaLogEntry.innerHTML = `${epaLogText} <span class="muted">waiting for your decision</span>`;
        epaSession.show(result);
    } catch (error) {
        epaLogEntry.innerHTML = `${epaLogText} <span class="err">failed: ${escapeHtml(error.message)}</span>`;
        epaSession.showError(error.message);
        showMessage(error.message, true);
    } finally {
        submit.disabled = false;
        submit.textContent = "Retrieve from EPA";
    }
});

/* ---------- start ---------- */

fillOptionSelects();
renderColumnMenu();
renderDbFieldList();
fillFilters();
fillEpaForm();
addConditionRow();
checkServer();
refreshAllData();
