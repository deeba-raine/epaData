// Replace this hardcoded array with the database/API response when it is available.
const emissionsData = [
    { year: "2021", co2: 22800, so2: 245 },
    { year: "2022", co2: 24150, so2: 218 },
    { year: "2023", co2: 23680, so2: 202 },
    { year: "2024", co2: 25240, so2: 191 },
    { year: "2025", co2: 24680, so2: 184 }
];

const chartData = {
    labels: emissionsData.map((entry) => entry.year),
    datasets: [
        {
            label: "CO2 (t)",
            data: emissionsData.map((entry) => entry.co2),
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
            data: emissionsData.map((entry) => entry.so2),
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

new Chart(document.getElementById("trendChart"), {
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
