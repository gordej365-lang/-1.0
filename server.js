const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.YANDEX_RASP_API_KEY;
const API_BASE = "https://api.rasp.yandex-net.ru/v3.0";

app.use(express.static(__dirname));

app.use((req, res, next) => {
res.setHeader(
"Access-Control-Allow-Origin",
"https://gordej365-lang.github.io"
);
res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
res.setHeader("Access-Control-Allow-Headers", "Content-Type");

if (req.method === "OPTIONS") {
return res.sendStatus(204);
}

next();
});

let stationCache = [];
let stationCacheTime = 0;
let stationLoadPromise = null;

app.get("/api/health", (req, res) => {
res.json({
ok: true,
service: "electrichesk-moscow",
apiKeyConfigured: Boolean(API_KEY)
});
});

async function yandexRequest(endpoint, params = {}) {
if (!API_KEY) {
throw new Error("На сервере не настроен API-ключ Яндекса");
}

const url = new URL("${API_BASE}/${endpoint}/");
url.searchParams.set("apikey", API_KEY);
url.searchParams.set("format", "json");
url.searchParams.set("lang", "ru_RU");

for (const [key, value] of Object.entries(params)) {
if (value !== undefined && value !== null && value !== "") {
url.searchParams.set(key, String(value));
}
}

const response = await fetch(url);

if (!response.ok) {
throw new Error("Яндекс API: HTTP ${response.status}");
}

return response.json();
}

function collectStations(data) {
const result = [];
const seen = new Set();

function walk(value) {
if (!value) return;

if (Array.isArray(value)) {
  value.forEach(walk);
  return;
}

if (typeof value !== "object") return;

if (
  value.title &&
  value.codes &&
  value.codes.yandex_code &&
  value.transport_type === "suburban"
) {
  const code = value.codes.yandex_code;

  if (!seen.has(code)) {
    seen.add(code);
    result.push({
      title: value.title,
      code,
      codes: value.codes,
      transport_type: value.transport_type,
      station_type: value.station_type || ""
    });
  }
}

for (const [key, child] of Object.entries(value)) {
  if (key !== "codes") walk(child);
}

}

walk(data);
return result;
}

async function getStations() {
const cacheValid =
stationCache.length > 0 &&
Date.now() - stationCacheTime < 24 * 60 * 60 * 1000;

if (cacheValid) return stationCache;
if (stationLoadPromise) return stationLoadPromise;

stationLoadPromise = (async () => {
try {
const data = await yandexRequest("stations_list");
const stations = collectStations(data);

  if (!stations.length) {
    throw new Error("Яндекс API не вернул станции электричек");
  }

  stationCache = stations;
  stationCacheTime = Date.now();

  console.log("Stations loaded:", stations.length);
  return stationCache;
} finally {
  stationLoadPromise = null;
}

})();

return stationLoadPromise;
}

app.get("/api/stations", async (req, res) => {
try {
const query = String(req.query.q || "")
.trim()
.toLocaleLowerCase("ru");

const stations = await getStations();

const filtered = query
  ? stations.filter(station =>
      station.title.toLocaleLowerCase("ru").includes(query)
    )
  : stations;

res.json({
  stations: filtered,
  total: filtered.length
});

} catch (error) {
console.error("Stations error:", error.message);
res.status(502).json({
error: "Не удалось загрузить станции",
details: error.message
});
}
});

app.get("/api/search", async (req, res) => {
try {
const { from, to, date } = req.query;

if (!from || !to) {
  return res.status(400).json({
    error: "Укажи станции отправления и прибытия"
  });
}

const params = {
  from,
  to,
  transport_types: "suburban",
  transfers: false,
  limit: 100
};

if (date) params.date = date;

const data = await yandexRequest("search", params);
res.json(data);

} catch (error) {
console.error("Search error:", error.message);
res.status(502).json({
error: "Не удалось получить расписание",
details: error.message
});
}
});

app.listen(PORT, () => {
console.log("Server listening on port ${PORT}");
});
