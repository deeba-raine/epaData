/* =====================================================================
   explorer.js: Basic / Advanced / Describe-it search for the "Search database"
   page (same split as "Search facilities"), plus the Datasets CSV download.

   Load it AFTER script.js (it reuses that file's globals: apiRequest, formWith,
   columnFor, orderedKeys, dbControl, datasetsControl, datasetColumns, ...).

   Advanced search is the condition builder from the mock (Filter, Group by,
   Aggregate, Top / Bottom by, Top / Bottom in, Limit, Sort by). The spec is
     { args: [{field, op, value}], format: {group, rank, n}, sort: {key, direction} }
   and is sent to POST /searchAdvanced WITHOUT "sort": sorting happens in the
   browser (the back end's sortBy crashes on NULL values).
   Rank rules: "Top / Bottom in" sends rank.n + rank.partition; "Top / Bottom by"
   sends format.n (the back end rejects rank.n without a partition).
   ===================================================================== */

const AGG_RE = /^(sum|avg|max|min|cnt)_(.+)$/;
const aggregateFunctions = [["sum", "Total"], ["avg", "Average"], ["max", "Maximum"], ["min", "Minimum"], ["cnt", "Count"]];

/* ---------- scoped tabs (Search facilities keeps its own tab code in script.js) ---------- */

function activateScopedTab(group, name) {
    document.querySelectorAll(`[data-stabs="${group}"] button`).forEach((button) => {
        button.classList.toggle("active", button.dataset.stab === name);
    });
    document.querySelectorAll(`[data-sgroup="${group}"]`).forEach((pane) => {
        pane.hidden = pane.dataset.spane !== name;
    });
}

document.querySelectorAll("[data-stabs]").forEach((tabs) => {
    tabs.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-stab]");
        if (button) {
            activateScopedTab(tabs.dataset.stabs, button.dataset.stab);
        }
    });
});

/* ---------- shared helpers ---------- */

function renderChips(element, parts, label = "Searched for:") {
    element.innerHTML =
        `<span class="muted">${label}</span>` + parts.map((part) => `<span class="chip">${escapeHtml(part)}</span>`).join("");
}

// Column keys a spec will return when it groups (used when there are zero rows to read keys from)
function specKeys(spec, fallback) {
    const group = (spec.format || {}).group;
    if (!group) {
        return fallback;
    }
    return [...(group.by || []), ...(group.aggregate || []).map(([fn, metric]) => `${fn}_${metric}`)];
}

// Turns what was typed into the value the back end wants; undefined means "left blank"
function parseFilterValue(kind, label, field, op, raw) {
    const isList = op === "in" || op === "not_in";
    const parts = (isList ? String(raw).split(",") : [String(raw)]).map((part) => part.trim()).filter(Boolean);
    if (!parts.length) {
        return undefined;
    }
    const values = parts.map((part) => {
        if (kind === "date") {
            if (parseDate(part) === null) {
                throw new Error(`${label} needs a date such as 2026-01-31 (got "${part}").`);
            }
            return part;
        }
        if (isNumericKind(kind)) {
            const number = Number(part.replaceAll(",", ""));
            if (!Number.isFinite(number)) {
                throw new Error(`${label} needs a number (got "${part}").`);
            }
            return number;
        }
        return field === "state" ? part.toUpperCase() : part;
    });
    return isList ? values : values[0];
}

// Readable chips for any spec. Unlike describeSpec() in script.js this copes with
// several Group by / Aggregate conditions and with a Group by that has no aggregate.
function describeSpecFor(spec, labelOf, kindOf) {
    const parts = [];
    (spec.args || []).forEach((arg) => {
        const numeric = isNumericKind(kindOf(arg.field));
        const show = (value) => (numeric ? formatNumber(value) : String(value));
        const value = Array.isArray(arg.value) ? arg.value.map(show).join(", ") : show(arg.value);
        parts.push(`${labelOf(arg.field)} ${operatorLabels[arg.op] || arg.op} ${value}`);
    });

    const format = spec.format || {};
    if (format.group) {
        const summaries = (format.group.aggregate || []).map(([fn, metric]) => `${aggregateLabels[fn]} ${labelOf(metric)}`);
        const by = (format.group.by || []).map(labelOf);
        parts.push(`${summaries.length ? summaries.join(" and ") : "Groups"}${by.length ? ` by ${by.join(" + ")}` : ""}`);
    }
    if (format.rank) {
        const word = format.rank.direction === "bottom" ? "Lowest" : "Highest";
        const metric = labelOf(format.rank.metric);
        if (format.rank.n && format.rank.partition) {
            const partition = [].concat(format.rank.partition).map(labelOf).join(" + ");
            parts.push(`${word} ${format.rank.n} per ${partition} by ${metric}`);
        } else {
            parts.push(`${word} first by ${metric}`);
        }
    }
    if (format.n !== undefined) {
        parts.push(`First ${format.n} rows`);
    }
    if (spec.sort) {
        parts.push(`Sorted by ${labelOf(spec.sort.key)} ${spec.sort.direction === "asc" ? "ascending" : "descending"}`);
    }
    return parts.length ? parts : ["All records"];
}

/* ---------- the condition builder (the mock, made reusable) ---------- */

/* cfg: {
     form,                                  <form> holding [data-qb=shortcuts|list|json|clear|copy]
     filterGroups: [{ group, fields }],     fields offered in Filter
     groupFields, metricFields, aggFields,  keys offered in Group by / ranking / Aggregate
     countField,                            the field that only works with Count ("key", "id")
     labelOf(key), kindOf(key),
     listPrefix,                            datalist id prefix for value suggestions
     onRun(spec)
   } */
function createQueryBuilder(cfg) {
    const { form, labelOf, kindOf } = cfg;
    const listEl = form.querySelector('[data-qb="list"]');
    const jsonEl = form.querySelector('[data-qb="json"]');
    const types = ["Filter", "Group by", "Aggregate", "Top / Bottom by", "Top / Bottom in", "Limit", "Sort by"];
    const filterFields = cfg.filterGroups.flatMap((group) => group.fields);
    let conditions = [];
    let nextId = 1;

    const whole = (value) => Math.max(1, Math.floor(Number(value) || 1));

    function aggregateMetrics() {
        const found = [];
        conditions.filter((c) => c.type === "Aggregate").forEach((c) => {
            const name = `${c.fn}_${c.field}`;
            if (!found.includes(name)) {
                found.push(name);
            }
        });
        return found;
    }

    function metricOptions(current) {
        const options = [...cfg.metricFields, ...aggregateMetrics()].map((key) => [key, labelOf(key)]);
        if (current && !options.some(([key]) => key === current)) {
            options.push([current, `${labelOf(current)} (add an aggregate)`]);
        }
        return options;
    }

    const defaultMetric = () => aggregateMetrics()[0] || cfg.metricFields[0];
    const defaults = {
        "Filter": () => ({ field: filterFields[0], operator: "=", value: "" }),
        "Group by": () => ({ field: cfg.groupFields[0] }),
        "Aggregate": () => ({ fn: "sum", field: cfg.aggFields[0] }),
        "Top / Bottom by": () => ({ direction: "top", metric: defaultMetric(), n: 10 }),
        "Top / Bottom in": () => ({ direction: "top", metric: defaultMetric(), n: 1, partition: cfg.groupFields[0] }),
        "Limit": () => ({ n: 100 }),
        "Sort by": () => ({ field: defaultMetric(), direction: "desc" })
    };

    /* ---- markup ---- */
    const option = (value, label, selected) =>
        `<option value="${escapeHtml(value)}"${String(value) === String(selected) ? " selected" : ""}>${escapeHtml(label)}</option>`;

    function select(label, key, pairs, value) {
        const list = value === undefined || pairs.some(([v]) => v === value) ? pairs : [...pairs, [value, `${value} (custom)`]];
        return `<div class="field"><label>${label}<select data-key="${key}">${list.map(([v, l]) => option(v, l, value)).join("")}</select></label></div>`;
    }

    function input(label, key, value, attributes = "") {
        return `<div class="field"><label>${label}<input data-key="${key}" value="${escapeHtml(value ?? "")}" ${attributes}></label></div>`;
    }

    function filterSelect(c) {
        const groups = cfg.filterGroups
            .map((g) => `<optgroup label="${escapeHtml(g.group)}">${g.fields.map((f) => option(f, labelOf(f), c.field)).join("")}</optgroup>`)
            .join("");
        return `<div class="field"><label>Attribute<select data-key="field">${groups}</select></label></div>`;
    }

    function cardBody(c) {
        const pairs = (keys) => keys.map((key) => [key, labelOf(key)]);
        const directions = [["top", "Top (highest)"], ["bottom", "Bottom (lowest)"]];

        if (c.type === "Filter") {
            const kind = kindOf(c.field);
            const operators = kind === "text" ? textOperators : numberOperators;
            const isList = c.operator === "in" || c.operator === "not_in";
            const hint = isList ? "e.g. KY, TN" : kind === "date" ? "e.g. 2026-01-31" : kind === "text" ? "e.g. Coal" : "e.g. 500000";
            return `<div class="qb-fields filter">${filterSelect(c)}${select("Operator", "operator", operators, c.operator)}${
                input("Value", "value", c.value, `placeholder="${hint}" list="${cfg.listPrefix}${c.field}"`)}</div>`;
        }
        if (c.type === "Group by") {
            return `<div class="qb-fields">${select("Group attribute", "field", pairs(cfg.groupFields), c.field)}</div>`;
        }
        if (c.type === "Aggregate") {
            return `<div class="qb-fields">${select("Function", "fn", aggregateFunctions, c.fn)}${select("Attribute", "field", pairs(cfg.aggFields), c.field)}</div>`;
        }
        if (c.type === "Top / Bottom by") {
            return `<div class="qb-fields">${select("Direction", "direction", directions, c.direction)}${
                select("Ranking metric", "metric", metricOptions(c.metric), c.metric)}${
                input("Rows to keep (N)", "n", c.n, 'type="number" min="1"')}</div>`;
        }
        if (c.type === "Top / Bottom in") {
            return `<div class="qb-fields">${select("Direction", "direction", directions, c.direction)}${
                input("Rows per group (N)", "n", c.n, 'type="number" min="1"')}${
                select("Ranking metric", "metric", metricOptions(c.metric), c.metric)}${
                select("Partition by", "partition", pairs(cfg.groupFields), c.partition)}</div>
                <div class="qb-note">Ranks inside each partition and keeps the first N. If you also use Group by, the partition must be one of its attributes.</div>`;
        }
        if (c.type === "Sort by") {
            const keys = [...cfg.sortFields, ...aggregateMetrics()];
            return `<div class="qb-fields">${select("Sort attribute", "field", keys.map((key) => [key, labelOf(key)]), c.field)}${
                select("Direction", "direction", [["asc", "Ascending (low to high)"], ["desc", "Descending (high to low)"]], c.direction)}</div>
                <div class="qb-note">Orders the table in your browser. Use Top / Bottom to choose which rows are kept.</div>`;
        }
        return `<div class="qb-fields">${input("Maximum rows", "n", c.n, 'type="number" min="1"')}</div>`;
    }

    function render() {
        listEl.innerHTML =
            conditions
                .map(
                    (c) => `<article class="qb-card" data-id="${c.id}">
                        <div class="qb-head"><div class="qb-kind"><span class="qb-dot"></span>${escapeHtml(c.type)}</div>
                        <button type="button" class="qb-remove" data-remove aria-label="Remove ${escapeHtml(c.type)}">✕ Remove</button></div>
                        ${cardBody(c)}</article>`
                )
                .join("") || `<div class="qb-empty">No conditions yet. Add a filter, grouping or aggregate, or run it empty to see everything.</div>`;
        preview();
    }

    /* ---- spec <-> conditions ---- */
    function getSpec() {
        const args = [];
        const group = { by: [], aggregate: [] };
        const limits = [];
        let rank = null;
        let sort = null;

        conditions.forEach((c) => {
            if (c.type === "Filter") {
                const value = parseFilterValue(kindOf(c.field), labelOf(c.field), c.field, c.operator, c.value);
                if (value !== undefined) {
                    args.push({ field: c.field, op: c.operator, value: value });
                }
            } else if (c.type === "Group by") {
                if (!group.by.includes(c.field)) {
                    group.by.push(c.field);
                }
            } else if (c.type === "Aggregate") {
                if (c.field === cfg.countField && c.fn !== "cnt") {
                    throw new Error(`Only Count can be used with ${labelOf(c.field)}. Pick a measurement for other functions.`);
                }
                if (!group.aggregate.some(([fn, field]) => fn === c.fn && field === c.field)) {
                    group.aggregate.push([c.fn, c.field]);
                }
            } else if (c.type === "Top / Bottom by" || c.type === "Top / Bottom in") {
                if (rank) {
                    throw new Error("Use only one Top / Bottom condition per search.");
                }
                rank = { direction: c.direction, metric: c.metric };
                if (c.type === "Top / Bottom in") {
                    rank.n = whole(c.n);
                    rank.partition = [c.partition];
                } else {
                    limits.push(whole(c.n)); // "top N overall" is a rank plus a row limit
                }
            } else if (c.type === "Limit") {
                limits.push(whole(c.n));
            } else if (c.type === "Sort by") {
                if (sort) {
                    throw new Error("Use only one Sort by condition per search.");
                }
                sort = { key: c.field, direction: c.direction === "asc" ? "asc" : "desc" };
            }
        });

        const grouped = group.by.length > 0 || group.aggregate.length > 0;
        if (rank) {
            const aggregates = group.aggregate.map(([fn, field]) => `${fn}_${field}`);
            const isAggregate = AGG_RE.test(rank.metric) && !cfg.metricFields.includes(rank.metric);
            if (isAggregate && !aggregates.includes(rank.metric)) {
                throw new Error(`Add an Aggregate (and a Group by) for "${labelOf(rank.metric)}" before ranking by it.`);
            }
            if (grouped && !isAggregate) {
                throw new Error("When grouping, rank by an aggregate (for example Total CO2), not a raw column.");
            }
            if (rank.partition && group.by.length && !group.by.includes(rank.partition[0])) {
                throw new Error("The partition must be one of the Group by attributes.");
            }
        }

        if (sort && grouped) {
            const aggregates = group.aggregate.map(([fn, field]) => `${fn}_${field}`);
            if (!group.by.includes(sort.key) && !aggregates.includes(sort.key)) {
                throw new Error("When grouping, sort by a Group by attribute or an aggregate.");
            }
        }

        const format = {};
        if (grouped) {
            format.group = group;
        }
        if (rank) {
            format.rank = rank;
        }
        if (limits.length) {
            format.n = Math.min(...limits);
        }
        return sort ? { args: args, format: format, sort: sort } : { args: args, format: format };
    }

    function specToConditions(spec) {
        const out = [];
        (spec.args || []).forEach((arg) =>
            out.push({ type: "Filter", field: arg.field, operator: arg.op, value: Array.isArray(arg.value) ? arg.value.join(", ") : String(arg.value) })
        );
        const format = spec.format || {};
        if (format.group) {
            (format.group.by || []).forEach((field) => out.push({ type: "Group by", field: field }));
            (format.group.aggregate || []).forEach(([fn, field]) => out.push({ type: "Aggregate", fn: fn, field: field }));
        }
        if (format.rank) {
            const rank = format.rank;
            if (rank.partition) {
                out.push({ type: "Top / Bottom in", direction: rank.direction, metric: rank.metric, n: rank.n || 1, partition: [].concat(rank.partition)[0] });
            } else {
                out.push({ type: "Top / Bottom by", direction: rank.direction, metric: rank.metric, n: format.n || 10 });
            }
        }
        if (format.n !== undefined && !(format.rank && !format.rank.partition)) {
            out.push({ type: "Limit", n: format.n });
        }
        if (spec.sort) {
            out.push({ type: "Sort by", field: spec.sort.key, direction: spec.sort.direction });
        }
        return out;
    }

    function preview() {
        try {
            jsonEl.textContent = JSON.stringify(getSpec(), null, 2);
        } catch (error) {
            jsonEl.textContent = `// ${error.message}`;
        }
    }

    /* ---- events ---- */
    function add(type, initial = {}) {
        conditions.push({ id: nextId++, type: type, ...defaults[type](), ...initial });
        render();
    }

    function update(element) {
        const card = element.closest(".qb-card");
        const c = card && conditions.find((item) => item.id === Number(card.dataset.id));
        if (!c || !element.dataset.key) {
            return;
        }
        c[element.dataset.key] = element.value;

        if (c.type === "Filter" && element.dataset.key === "field") {
            const operators = kindOf(c.field) === "text" ? textOperators : numberOperators;
            if (!operators.some(([value]) => value === c.operator)) {
                c.operator = "=";
            }
        }
        const rebuild =
            c.type === "Aggregate" || c.type === "Group by" || (c.type === "Filter" && ["field", "operator"].includes(element.dataset.key));
        if (rebuild) {
            render();
        } else {
            preview();
        }
    }

    form.querySelector('[data-qb="shortcuts"]').innerHTML = types
        .map((type) => `<button type="button" class="chip-button" data-add="${type}">＋ ${type}</button>`)
        .join("");

    form.addEventListener("click", (event) => {
        const addButton = event.target.closest("[data-add]");
        if (addButton) {
            add(addButton.dataset.add);
        }
    });
    listEl.addEventListener("click", (event) => {
        const remove = event.target.closest("[data-remove]");
        if (remove) {
            const id = Number(remove.closest(".qb-card").dataset.id);
            conditions = conditions.filter((c) => c.id !== id);
            render();
        }
    });
    listEl.addEventListener("change", (event) => update(event.target));
    listEl.addEventListener("input", (event) => {
        if (event.target.tagName === "INPUT" && event.target.type !== "number") {
            update(event.target);
        }
    });

    form.querySelector('[data-qb="clear"]').addEventListener("click", () => {
        conditions = [];
        render();
    });
    const copy = form.querySelector('[data-qb="copy"]');
    copy.addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(jsonEl.textContent);
            copy.textContent = "Copied!";
            setTimeout(() => (copy.textContent = "Copy JSON"), 1200);
        } catch (error) {
            showMessage("Could not copy. Select the JSON text instead.", true);
        }
    });

    form.addEventListener("submit", (event) => {
        event.preventDefault();
        try {
            cfg.onRun(getSpec());
        } catch (error) {
            showMessage(error.message, true);
        }
    });

    add("Filter");

    return {
        getSpec: getSpec,
        setSpec(spec) {
            conditions = specToConditions(spec).map((c) => ({ id: nextId++, ...c }));
            render();
        },
        clear() {
            conditions = [];
            render();
        }
    };
}

/* ---------- Describe-it wiring (same behaviour as the facilities tab) ---------- */

// cfg: { group, form, input, interp, hint, interpret(text), describe(spec), run(spec), builder }
function setupDescribe(cfg) {
    let last = null;

    cfg.form.addEventListener("submit", (event) => {
        event.preventDefault();
        const spec = cfg.interpret(cfg.input.value);
        cfg.interp.hidden = false;

        if (!spec.args.length && !Object.keys(spec.format).length && !spec.sort) {
            last = null;
            cfg.interp.innerHTML = `<span class="err">${escapeHtml(cfg.hint)}</span>`;
            return;
        }
        last = spec;
        cfg.interp.innerHTML =
            `<span class="muted">Interpreted as:</span>` +
            cfg.describe(spec).map((part) => `<span class="chip">${escapeHtml(part)}</span>`).join("") +
            `<button type="button" class="chip-button" data-action="edit">Edit in Advanced</button>` +
            `<button type="button" class="chip-button" data-action="json">Show query</button>` +
            `<pre class="json-view" hidden>${escapeHtml(JSON.stringify(spec, null, 2))}</pre>`;
        cfg.run(spec);
    });

    cfg.interp.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-action]");
        if (!button) {
            return;
        }
        if (button.dataset.action === "json") {
            const view = cfg.interp.querySelector(".json-view");
            view.hidden = !view.hidden;
        } else if (last) {
            cfg.builder.setSpec(last);
            activateScopedTab(cfg.group, "advanced");
        }
    });

    cfg.form.addEventListener("click", (event) => {
        const example = event.target.closest("button[data-example]");
        if (example) {
            cfg.input.value = example.dataset.example;
            cfg.form.requestSubmit();
        }
    });
}

/* =====================================================================
   SEARCH DATABASE: Advanced + Describe (Basic stays in script.js)
   ===================================================================== */

const dbSummary = document.getElementById("dbSummary");
const dbKind = (key) => columnFor(key).kind;
const dbLabel = (key) => (key === "key" ? "Records" : columnFor(key).label);
const dbGroupFields = [
    "state", "county", "category", "facility_id", "facility_name", "unit_id", "type",
    "primary_fuel", "secondary_fuel", "year", "program_code", "source"
];

// API: POST /searchAdvanced, form field conditions = JSON of the spec
async function runDbSpec(spec) {
    const requestId = ++dbRequestId;
    const { sort, ...request } = spec; // sorting is done in the browser, the back end never sees it
    dbEmpty.hidden = true;
    renderChips(dbSummary, describeSpecFor(spec, dbLabel, dbKind));
    dbControl.setMessage("Searching…", "muted");
    try {
        const data = await apiRequest("/searchAdvanced", { form: formWith({ conditions: JSON.stringify(request) }) });
        if (requestId !== dbRequestId) {
            return;
        }
        const keys = data.items.length ? Object.keys(data.items[0]) : specKeys(spec, catalogKeys);
        dbControl.setData(data.items, orderedKeys(keys).map(columnFor), sort || null, true);
    } catch (error) {
        if (requestId !== dbRequestId) {
            return;
        }
        dbControl.setMessage(error.message, "err");
        showMessage(error.message, true);
    }
}

const dbBuilder = createQueryBuilder({
    form: document.getElementById("dbAdvForm"),
    filterGroups: advancedFields, // from script.js (dates are left out, see BACKEND NOTE 3)
    groupFields: dbGroupFields,
    metricFields: metricFields, // from script.js
    aggFields: [...metricFields, "key"],
    sortFields: catalogKeys.filter((key) => key !== "key"),
    countField: "key",
    labelOf: dbLabel,
    kindOf: dbKind,
    listPrefix: "dl-",
    onRun: runDbSpec
});

// The Basic tab is still driven by script.js. It asks this file for the chosen sort
// (script.js calls currentDbSort() when it fills the table).
const dbSortBy = document.getElementById("dbSortBy");
const dbSortDir = document.getElementById("dbSortDir");
dbSortBy.insertAdjacentHTML(
    "beforeend",
    catalogKeys.filter((key) => key !== "key").map((key) => `<option value="${key}">${escapeHtml(columnCatalog[key].label)}</option>`).join("")
);

function currentDbSort() {
    return dbSortBy.value ? { key: dbSortBy.value, direction: dbSortDir.value } : null;
}

document.getElementById("dbSearchForm").addEventListener("submit", () => {
    const text = document.getElementById("dbQuery").value.trim();
    const scope = { names: "name, ID or unit ID", all: "any column", custom: "the chosen columns" }[dbScope.value];
    const parts = [text ? `"${text}" in ${scope}` : "All records"];
    if (dbSortBy.value) {
        parts.push(`Sorted by ${dbLabel(dbSortBy.value)} ${dbSortDir.value === "asc" ? "ascending" : "descending"}`);
    }
    renderChips(dbSummary, parts);
});
document.getElementById("dbSearchForm").addEventListener("reset", () => {
    dbSummary.innerHTML = "";
});

// Extra phrases for the whole database on top of the facilities parser in script.js
function interpretDatabaseDescription(text) {
    const spec = interpretDescription(text);
    const dataset = text.match(/dataset\s+"([^"]+)"/i);
    if (dataset) {
        spec.args.push({ field: "source", op: "=", value: dataset[1] });
    }
    const county = text.match(/\b([A-Z][a-z]+(?: [A-Z][a-z]+)?)\s+County\b/);
    if (county) {
        spec.args.push({ field: "county", op: "contains", value: county[1] });
    }

    // "sorted by CO2", "order by year descending", "sort by state asc"
    const phrase = text.toLowerCase().match(/\b(?:sort(?:ed)?|order(?:ed)?)\s+by\s+([a-z0-9 ]{1,40})/);
    if (phrase) {
        const targets = [
            [/\b(co2|carbon)\b/, "co2"], [/\b(so2|sulfur|sulphur)\b/, "so2"], [/\b(nox|nitrogen)\b/, "nox"],
            [/heat input/, "heat_input"], [/gross|generation/, "gross"], [/operating time|hours/, "operating_time"],
            [/\byear\b/, "year"], [/\bstate\b/, "state"], [/\bcounty\b/, "county"],
            [/\bfacility\b/, "facility_name"], [/\bfuel\b/, "primary_fuel"]
        ];
        const hit = targets.find(([pattern]) => pattern.test(phrase[1]));
        if (hit) {
            const asc = /\b(ascending|asc|low to high)\b/.test(phrase[1]);
            const desc = /\b(descending|desc|high to low)\b/.test(phrase[1]);
            const measure = ["co2", "so2", "nox", "heat_input", "gross", "operating_time"].includes(hit[1]);
            spec.sort = { key: hit[1], direction: asc ? "asc" : desc ? "desc" : measure ? "desc" : "asc" };
        }
    }
    return spec;
}

setupDescribe({
    group: "db",
    form: document.getElementById("dbDescForm"),
    input: document.getElementById("dbDText"),
    interp: document.getElementById("dbInterp"),
    hint: 'No search terms found. Try naming a state, fuel, year, county, dataset ("name") or emission level, e.g. "coal units in Kentucky over 500,000 tons of CO2".',
    interpret: interpretDatabaseDescription,
    describe: (spec) => describeSpecFor(spec, dbLabel, dbKind),
    run: runDbSpec,
    builder: dbBuilder
});

// Value suggestions for the Advanced filters come from the back end's "distinct" lists.
// The facilities page fills them; if it has not run yet, fetch them once here.
let catalogRequested = false;
async function ensureCatalog() {
    if (catalogRequested || Object.keys(catalog).length) {
        return;
    }
    catalogRequested = true;
    try {
        const data = await apiRequest("/searchAdvanced", { form: formWith({ conditions: "{}" }) });
        catalog = data.distinct || {};
        updateDatalists();
    } catch (error) {
        catalogRequested = false;
    }
}

/* =====================================================================
   DATASETS: Basic search only (script.js). This file only adds the CSV download.
   ===================================================================== */

// Download every annual record a dataset added.
// API: POST /datasetRecords, form field name
document.getElementById("datasetsTable").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-download]");
    if (!button) {
        return;
    }
    const name = button.dataset.download;
    button.disabled = true;
    try {
        const data = await apiRequest("/datasetRecords", { form: formWith({ name: name }) });
        if (!data.items.length) {
            showMessage(`"${name}" has no records to download.`, true);
            return;
        }
        const columns = orderedKeys(Object.keys(data.items[0])).map(columnFor);
        downloadCsv(`${name.replace(/[^\w.-]+/g, "_")}.csv`, rowsToCsv(data.items, columns));
    } catch (error) {
        showMessage(error.message, true);
    } finally {
        button.disabled = false;
    }
});

/* ---------- start ---------- */

document.getElementById("sideNav").addEventListener("click", (event) => {
    const button = event.target.closest("button");
    if (button && button.dataset.view === "dbsearch") {
        ensureCatalog();
    }
});
