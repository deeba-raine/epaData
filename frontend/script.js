// Replace this generated sample data with the database/API response when it is available.
// API: facility rows should come from the Flask route that queries SQLite through SQLAlchemy.
const api_url = "http://127.0.0.1:5000";
const facilityList = [
    { name: "Ghent Generating Station", state: "KY", id: "1356", fuel: "Coal" },
    { name: "Trimble County Plant", state: "KY", id: "6071", fuel: "Coal" },
    { name: "Mill Creek Station", state: "KY", id: "1364", fuel: "Coal" },
    { name: "Paradise Fossil Plant", state: "KY", id: "1378", fuel: "Coal" },
    { name: "Cane Run Station", state: "KY", id: "1363", fuel: "Natural gas" },
    { name: "Gibson Generating Station", state: "IN", id: "6113", fuel: "Coal" },
    { name: "Sullivan Plant", state: "IN", id: "1010", fuel: "Natural gas" },
    { name: "Cumberland Fossil Plant", state: "TN", id: "3399", fuel: "Coal" },
    { name: "Kyger Creek Station", state: "OH", id: "2876", fuel: "Coal" },
    { name: "Mountaineer Plant", state: "WV", id: "6264", fuel: "Coal" }
];

function buildSampleData() {
    let seed = 42;
    const random = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };
    const rows = [];

    facilityList.forEach((facility) => {
        for (let unitNumber = 1; unitNumber <= 2; unitNumber++) {
            const isCoal = facility.fuel === "Coal";
            const baseCo2 = isCoal ? 350000 + random() * 600000 : 80000 + random() * 170000;

            for (let year = 2021; year <= 2025; year++) {
                const change = 1 - (year - 2021) * 0.04 + (random() - 0.5) * 0.08;
                const baseSo2 = isCoal ? 400 + random() * 1100 : 5 + random() * 25;

                rows.push({
                    facility: facility.name,
                    id: facility.id,
                    state: facility.state,
                    unit: `${facility.name.slice(0, 3).toUpperCase()}-${unitNumber}`,
                    fuel: facility.fuel,
                    year: year,
                    co2: Math.round(baseCo2 * change),
                    so2: Math.round(baseSo2 * change)
                });
            }
        }
    });

    return rows;
}

let facilityData = buildSampleData();
let importedOn = "Sep 14, 2026";

const csvColumns = ["state", "facility_name", "facility_id", "unit_id", "associated_stacks", "year", "operating_time_count",
                     "sum_of_the_operating_time", "gross_load_(MWh)", "steam_load_(1000_lb)", "so2_mass_(short_tons)",
                    "so2_rate_(lbs/mmBtu)", "co2_mass_(short_tons)", "co2_rate_(short_tons/mmBtu)", "nox_mass_(short_tons)",
                    "nox_rate_(lbs/mmBtu)", "heat_input_(mmBtu)", "primary_fuel_type", "secondary_fuel_type", "unit_type",
                    "so2_controls", "nox_controls", "pm_controls", "hg_controls", "program_code"];
const numericFields = ["facility_id", "year", "operating_time_count", "sum_of_operating_time", "gross_load_(MWh)", "steam_load_(1000_lb)",
                        "so2_mass_(short_tons)", "so2_rate_(lbs/mmBtu)", "co2_mass_(short_tons)", "co2_rate_(short_tons/mmBtu)",
                        "nox_mass_(short_tons)", "nox_rate_(lbs/mmBtu)", "heat_input_(mmBtu)"];

/* ---------- helpers ---------- */

function getUniqueValues(field) {
    return [...new Set(facilityData.map((row) => row[field]))].sort();
}

function fillSelect(select, values, keepFirstOption = true) {
    const firstOption = keepFirstOption && select.options[0] ? select.options[0].outerHTML : "";
    select.innerHTML =
        firstOption + values.map((value) => `<option value="${value}">${value}</option>`).join("");
}

function escapeHtml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function showMessage(message) {
    const toast = document.getElementById("toast");
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(showMessage.timer);
    showMessage.timer = setTimeout(() => {
        toast.hidden = true;
    }, 3500);
}

function rowsToCsv(rows) {
    const quote = (value) => `"${String(value).replaceAll('"', '""')}"`;
    const lines = rows.map((row) => csvColumns.map((column) => quote(row[column])).join(","));
    return [csvColumns.join(","), ...lines].join("\n");
}

function downloadCsv(fileName, csv) {
    const downloadUrl = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8;" })
    );
    const downloadLink = document.createElement("a");
    downloadLink.href = downloadUrl;
    downloadLink.download = fileName;
    downloadLink.click();
    URL.revokeObjectURL(downloadUrl);
}

/* ---------- sidebar navigation ---------- */

const viewTitles = {
    dashboard: "Dashboard",
    search: "Search facilities",
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

    if (viewName === "search" && searchResults === null) {
        runSearch([]);
    }
}

document.getElementById("sideNav").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button) {
        showView(button.dataset.view);
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
    return rows.reduce((total, row) => total + row[field], 0);
}

function renderDashboard() {
    const rows = getDashboardRows();
    const shownRows = rows.slice(0, 8);

    document.getElementById("kpiFacilities").textContent = new Set(
        rows.map((row) => row.id)
    ).size.toLocaleString();
    document.getElementById("kpiCo2").textContent = `${sumBy(rows, "co2").toLocaleString()} t`;
    document.getElementById("kpiSo2").textContent = `${sumBy(rows, "so2").toLocaleString()} t`;
    document.getElementById("kpiImported").textContent = importedOn;
    document.getElementById("lastUpdated").textContent = importedOn;

    facilitiesTable.querySelector("tbody").innerHTML = shownRows.length
        ? shownRows
              .map(
                  (row) => `
                    <tr>
                        <td>${escapeHtml(row.facility)}</td>
                        <td>${escapeHtml(row.state)}</td>
                        <td>${escapeHtml(row.unit)}</td>
                        <td>${escapeHtml(row.fuel)}</td>
                        <td class="num">${row.co2.toLocaleString()}</td>
                        <td class="num">${row.so2.toLocaleString()}</td>
                        <td>${row.year}</td>
                    </tr>`
              )
              .join("")
        : `<tr><td class="empty" colspan="7">No records match these filters. Reset a filter to see more.</td></tr>`;

    document.getElementById("dashCount").textContent =
        `Showing ${shownRows.length} of ${rows.length.toLocaleString()} records.`;

    updateChart(rows);
}

[stateFilter, facilityFilter, yearFilter].forEach((filter) => {
    filter.addEventListener("change", renderDashboard);
});

/* ---------- dashboard: trend chart ---------- */

function getEmissionsByYear(rows) {
    const years = [...new Set(rows.map((row) => row.year))].sort();

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
    downloadCsv("facility-emissions.csv", rowsToCsv(getDashboardRows()));
});

document.getElementById("uploadDataButton").addEventListener("click", () => {
    showView("upload");
});

document.getElementById("viewFullTableButton").addEventListener("click", () => {
    const conditions = [];

    if (stateFilter.value) {
        conditions.push({ field: "state", operator: "=", value: stateFilter.value });
    }
    if (facilityFilter.value) {
        conditions.push({ field: "facility", operator: "=", value: facilityFilter.value });
    }
    if (yearFilter.value) {
        conditions.push({ field: "year", operator: "=", value: yearFilter.value });
    }

    showView("search");
    runSearch(conditions);
});

document.getElementById("quickSearch").addEventListener("submit", (event) => {
    event.preventDefault();
    const query = event.target.search.value.trim();

    showView("search");
    runSearch(query ? [{ field: "any", operator: "contains", value: query }] : []);
});

/* ---------- search: matching, sorting, pagination ---------- */

const fieldLabels = {
    any: "Name / ID / unit",
    facility: "Facility",
    id: "Facility ID",
    unit: "Unit ID",
    state: "State",
    fuel: "Fuel",
    year: "Year",
    co2: "CO2 (t)",
    so2: "SO2 (t)"
};
const operators = ["=", "≠", ">", "≥", "<", "≤", "contains"];

let searchResults = null;
let sortKey = "co2";
let sortDirection = "desc";
let currentPage = 1;

function matchesCondition(row, condition) {
    if (condition.field === "any") {
        const text = String(condition.value).toLowerCase();
        return [row.facility, row.id, row.unit].some((value) =>
            String(value).toLowerCase().includes(text)
        );
    }

    let rowValue = row[condition.field];
    let searchValue = condition.value;

    if (numericFields.includes(condition.field)) {
        rowValue = Number(rowValue);
        searchValue = Number(String(searchValue).replaceAll(",", ""));
    } else {
        rowValue = String(rowValue).toLowerCase();
        searchValue = String(searchValue).toLowerCase();
    }

    switch (condition.operator) {
        case "=":
            return rowValue === searchValue;
        case "≠":
            return rowValue !== searchValue;
        case ">":
            return rowValue > searchValue;
        case "≥":
            return rowValue >= searchValue;
        case "<":
            return rowValue < searchValue;
        case "≤":
            return rowValue <= searchValue;
        case "contains":
            return String(rowValue).includes(String(searchValue));
        default:
            return true;
    }
}

// API: replace this filter with a request that sends the conditions to the back end.
function runSearch(conditions) {
    searchResults = facilityData.filter((row) =>
        conditions.every((condition) => matchesCondition(row, condition))
    );
    currentPage = 1;
    renderResults();
}

const resultsTable = document.getElementById("resultsTable");
const pageSizeSelect = document.getElementById("pageSize");
const previousPageButton = document.getElementById("prevPage");
const nextPageButton = document.getElementById("nextPage");

function renderResults() {
    const pageSize = Number(pageSizeSelect.value);
    const sortedRows = [...searchResults].sort((a, b) => {
        const first = a[sortKey];
        const second = b[sortKey];
        const difference =
            typeof first === "number" ? first - second : String(first).localeCompare(String(second));

        return sortDirection === "asc" ? difference : -difference;
    });

    const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
    currentPage = Math.min(currentPage, totalPages);
    const pageRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

    resultsTable.querySelector("tbody").innerHTML = pageRows.length
        ? pageRows
              .map(
                  (row) => `
                    <tr>
                        <td>${escapeHtml(row.facility)}</td>
                        <td>${escapeHtml(row.id)}</td>
                        <td>${escapeHtml(row.state)}</td>
                        <td>${escapeHtml(row.unit)}</td>
                        <td>${escapeHtml(row.fuel)}</td>
                        <td class="num">${row.co2.toLocaleString()}</td>
                        <td class="num">${row.so2.toLocaleString()}</td>
                        <td>${row.year}</td>
                    </tr>`
              )
              .join("")
        : `<tr><td class="empty" colspan="8">No records match. Remove a condition or widen a range.</td></tr>`;

    document.getElementById("resCount").textContent = `(${sortedRows.length.toLocaleString()} records)`;
    document.getElementById("pageInfo").textContent = `Page ${currentPage} of ${totalPages}`;
    previousPageButton.disabled = currentPage <= 1;
    nextPageButton.disabled = currentPage >= totalPages;

    resultsTable.querySelectorAll("th[data-key]").forEach((header) => {
        if (header.dataset.key === sortKey) {
            header.setAttribute("aria-sort", sortDirection === "asc" ? "ascending" : "descending");
        } else {
            header.setAttribute("aria-sort", "none");
        }
    });
}

resultsTable.querySelector("thead").addEventListener("click", (event) => {
    const header = event.target.closest("th[data-key]");
    if (!header) {
        return;
    }

    sortDirection = sortKey === header.dataset.key && sortDirection === "asc" ? "desc" : "asc";
    sortKey = header.dataset.key;
    renderResults();
});

resultsTable.querySelector("thead").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
        event.target.click();
    }
});

previousPageButton.addEventListener("click", () => {
    currentPage--;
    renderResults();
});

nextPageButton.addEventListener("click", () => {
    currentPage++;
    renderResults();
});

pageSizeSelect.addEventListener("change", () => {
    currentPage = 1;
    renderResults();
});

document.getElementById("downloadResults").addEventListener("click", () => {
    if (searchResults) {
        downloadCsv("search-results.csv", rowsToCsv(searchResults));
    }
});

/* ---------- search: tabs ---------- */

document.querySelector(".tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("button");
    if (!tab) {
        return;
    }

    document.querySelectorAll(".tabs button").forEach((button) => {
        button.classList.toggle("active", button === tab);
    });
    document.querySelectorAll(".tab-pane").forEach((pane) => {
        pane.hidden = pane.dataset.pane !== tab.dataset.tab;
    });
});

/* ---------- search: basic ---------- */

const basicForm = document.getElementById("basicForm");

basicForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const conditions = [];
    const query = document.getElementById("bQuery").value.trim();

    if (query) {
        conditions.push({ field: "any", operator: "contains", value: query });
    }

    [
        ["state", "bState"],
        ["year", "bYear"],
        ["fuel", "bFuel"]
    ].forEach(([field, selectId]) => {
        const value = document.getElementById(selectId).value;
        if (value) {
            conditions.push({ field: field, operator: "=", value: value });
        }
    });

    runSearch(conditions);
});

basicForm.addEventListener("reset", () => {
    setTimeout(() => runSearch([]), 0);
});

/* ---------- search: advanced (multi-constraint) ---------- */

const conditionRows = document.getElementById("condRows");

function addConditionRow(preset = { field: "state", operator: "=", value: "" }) {
    const row = document.createElement("div");
    row.className = "cond";

    const fieldOptions = Object.entries(fieldLabels)
        .filter(([field]) => field !== "any")
        .map(([field, label]) => `<option value="${field}">${label}</option>`)
        .join("");
    const operatorOptions = operators.map((operator) => `<option>${operator}</option>`).join("");

    row.innerHTML = `
        <select class="field" aria-label="Field">${fieldOptions}</select>
        <select class="operator" aria-label="Operator">${operatorOptions}</select>
        <input class="value" aria-label="Value" placeholder="Value" required>
        <button type="button" class="remove" aria-label="Remove condition">Remove</button>`;

    row.querySelector(".field").value = preset.field;
    row.querySelector(".operator").value = preset.operator;
    row.querySelector(".value").value = preset.value;
    row.querySelector(".remove").addEventListener("click", () => row.remove());

    conditionRows.append(row);
}

document.getElementById("addCond").addEventListener("click", () => addConditionRow());

document.getElementById("advForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const conditions = Array.from(conditionRows.querySelectorAll(".cond")).map((row) => ({
        field: row.querySelector(".field").value,
        operator: row.querySelector(".operator").value,
        value: row.querySelector(".value").value.trim()
    }));

    runSearch(conditions);
});

/* ---------- search: description-based ---------- */

const stateNames = {
    kentucky: "KY",
    tennessee: "TN",
    ohio: "OH",
    indiana: "IN",
    "west virginia": "WV",
    virginia: "VA",
    illinois: "IL",
    texas: "TX"
};

// Turns a sentence into search conditions with simple keyword rules.
function interpretDescription(text) {
    const lowerText = text.toLowerCase();
    const conditions = [];

    Object.entries(stateNames).forEach(([name, abbreviation]) => {
        const isWestVirginia = name === "virginia" && lowerText.includes("west virginia");

        if (new RegExp(`\\b${name}\\b`).test(lowerText) && !isWestVirginia) {
            conditions.push({ field: "state", operator: "=", value: abbreviation });
        }
    });

    getUniqueValues("state").forEach((abbreviation) => {
        const alreadyAdded = conditions.some((condition) => condition.field === "state");

        if (new RegExp(`\\b${abbreviation}\\b`).test(text) && !alreadyAdded) {
            conditions.push({ field: "state", operator: "=", value: abbreviation });
        }
    });

    if (/\bcoal\b/.test(lowerText)) {
        conditions.push({ field: "fuel", operator: "=", value: "Coal" });
    } else if (/\b(natural )?gas\b/.test(lowerText)) {
        conditions.push({ field: "fuel", operator: "=", value: "Natural gas" });
    }

    const yearMatch = lowerText.match(/\b(19|20)\d{2}\b/);
    if (yearMatch) {
        conditions.push({ field: "year", operator: "=", value: yearMatch[0] });
    }

    const mentionsSo2Only = /so2/.test(lowerText) && !/co2/.test(lowerText);
    const amountMatch = lowerText.match(
        /(co2|so2)?\D{0,12}?(over|above|greater than|more than|under|below|less than)\s*([\d,]+)/
    );

    if (amountMatch) {
        conditions.push({
            field: amountMatch[1] || (mentionsSo2Only ? "so2" : "co2"),
            operator: /over|above|greater|more/.test(amountMatch[2]) ? ">" : "<",
            value: amountMatch[3].replaceAll(",", "")
        });
    } else if (/\bhigh\b/.test(lowerText)) {
        conditions.push(
            mentionsSo2Only
                ? { field: "so2", operator: ">", value: "1000" }
                : { field: "co2", operator: ">", value: "500000" }
        );
    } else if (/\blow\b/.test(lowerText)) {
        conditions.push(
            mentionsSo2Only
                ? { field: "so2", operator: "<", value: "300" }
                : { field: "co2", operator: "<", value: "150000" }
        );
    }

    return conditions;
}

document.getElementById("descForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const conditions = interpretDescription(document.getElementById("dText").value);
    const interpretation = document.getElementById("interp");

    interpretation.hidden = false;

    if (!conditions.length) {
        interpretation.innerHTML =
            `<span class="err">No search terms found. Try naming a state, fuel, year or emission level.</span>`;
        return;
    }

    interpretation.innerHTML =
        `<span class="muted">Searching for:</span>` +
        conditions
            .map((condition) => {
                const value = numericFields.includes(condition.field)
                    ? Number(condition.value).toLocaleString()
                    : condition.value;
                return `<span class="chip">${fieldLabels[condition.field]} ${condition.operator} ${value}</span>`;
            })
            .join("");

    runSearch(conditions);
});

/* ---------- upload and import ---------- */

const dataFileInput = document.getElementById("dataFileInput");
const dropZone = document.getElementById("dropZone");
const importButton = document.getElementById("importButton");
const uploadReport = document.getElementById("uploadReport");
const cancelReport = document.getElementById("cancelButton");
let testCount = 0;
let uploadId = null;

async function firstPass(file) {
    const payload = new FormData();
    payload.append('file', file);
    // Replace These with Upload Page Inputs
    payload.append('notes', 'This is a test');
    payload.append('name', 'testRun' + testCount);
    testCount += 1;
    
    let result = null;
    try {
        const response = await fetch(`${api_url}/api/upload`, {method: 'POST', body: payload});
        result = await response.json();
    } catch (error) {
        console.error('Problem During Upload', error);
        throw error;
    }
    return result;
}

async function secondPass(payload) {
    // Append Relevant Information
    payload.append("uploadID", uploadId);
    if (document.getElementById("pushQuestion").checked) {
        payload.append("question", 1)
    }

    // Fetch Second Pass with Payload
    let result = null;
    try {
        const response = await fetch(`${api_url}/api/finishUpload`, {method: 'POST', body: payload});
        result = await response.json();
    } catch (error) {
        console.error('Problem During Upload', error);
        throw error;
    }
    return result;
}

async function handleUploadedFile(file) {
    // validRows = [];
    uploadReport.style.cssText = '';
    importButton.disabled = true;
    cancelReport.disabled = true;
    uploadReport.hidden = false;

    // Check File Size
    const maxData = 50 * 1024 * 1024;
    if (file.size > maxData) {
        uploadReport.innerHTML = '<p class="err">File Size is too Large.</p>';
        return;
    }

    // Attempt First Upload Pass
    const parsed = await firstPass(file);
    // Make Upload Report Visible
    uploadReport.hidden = false
    if ("error" in parsed) {
        // Switch Error Possibilities and Return Them In <p>
        uploadReport.innerHTML = `<p class="err">${parsed.error}</p>`;
        return;
    }
    // First Pass Completed, Store Id
    uploadId = parsed.uploadID;

    // Display Data Quality Report
    let report = '';
    const duplicates = parsed.Indexes;
    const valid = parsed.Valid.items;
    const invalid = parsed.Invalid.items;
    const warning = parsed.Warning.items;

    report += `${valid.length} Items Had No Issues\n`;
    
    // Function for Report Creation
    function firstFound(arr, n) {
        let res = '';
        items = arr.slice(0, n);
        for (i=0; i < items.length; i++) {
            res += `${items[i]}\n`;
        }
        return res;
    }

    // Skip if Length is not > 0
    if (duplicates.length > 0) {
        report += `Rows: ${duplicates.slice(0, 3)} Were Duplicates Including ${Math.max(0, duplicates.length-3)} Others\n`;
    }
    if (warning.length > 0) {
        report += `There were ${warning.length} Rows with Missing Useful Data Including:\n`;
        report += `${firstFound(warning, 5)}`;
    }
    if (invalid.length > 0) {
        report += `There were ${invalid.length} Unnacceptable Rows; of Which 3 Were:\n${firstFound(invalid, 3)}`;
    }

    // Push report to Panel
    uploadReport.innerHTML = `<pre class="ok">${report}</pre>`;
    uploadReport.style.cssText = 'max-height: 300px; max-width: 100%; overflow: auto;';
    importButton.disabled = false;
    cancelReport.disabled = false;
    return;
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

document.getElementById("templateButton").addEventListener("click", () => {
    downloadCsv(
        "epa-upload-template.csv",
        "facility,facility_id,state,unit,fuel,year,co2,so2\nGhent Generating Station,1356,KY,GHT-1,Coal,2025,184420,612"
    );
});

importButton.addEventListener("click", async () => {
    importButton.disabled = true;
    cancelReport.disabled = true;
    showMessage(`Importing...`)
    let data = new FormData();
    data.append('push', 1);
    const response = await secondPass(data);
    showMessage(`Imported ${response.rows} records.`);
    uploadReport.style.cssText = '';
    uploadReport.hidden = true;
});

cancelReport.addEventListener("click", async () => {
    importButton.disabled = true;
    cancelReport.disabled = true;
    const response = await secondPass(new FormData())
    uploadReport.innerHTML = `<p class="err">${response.message}</p>`;
    uploadReport.style.cssText = '';
    return;
});
/* ---------- EPA data service ---------- */

const epaForm = document.getElementById("epaForm");
const epaLog = document.getElementById("epaLog");

function fillEpaForm() {
    const years = [2025, 2024, 2023, 2022, 2021, 2020];

    fillSelect(document.getElementById("eState"), ["KY", "TN", "OH", "IN", "WV", "IL"], false);
    fillSelect(document.getElementById("eFrom"), [...years].reverse(), false);
    fillSelect(document.getElementById("eTo"), years, false);
}

epaForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const state = document.getElementById("eState").value;
    const fromYear = Number(document.getElementById("eFrom").value);
    const toYear = Number(document.getElementById("eTo").value);

    if (fromYear > toYear) {
        showMessage("From year must not be later than To year.");
        return;
    }

    // API: call the back-end route that requests EPA CAMPD data and saves it, for example:
    // fetch(`/api/epa/fetch?state=${state}&from=${fromYear}&to=${toYear}`, { method: "POST" });
    if (epaLog.firstElementChild && epaLog.firstElementChild.classList.contains("muted")) {
        epaLog.innerHTML = "";
    }

    epaLog.insertAdjacentHTML(
        "afterbegin",
        `<li>${new Date().toLocaleTimeString()}: requested ${state}, ${fromYear}-${toYear}
        <span class="muted">(demo mode: connect the back-end route to import real records)</span></li>`
    );
});

/* ---------- start ---------- */

fillFilters();
fillEpaForm();
addConditionRow();
renderDashboard();