import express from "express";

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.YANDEX_RASP_API_KEY;
const API_BASE = "https://api.rasp.yandex.net/v3.0";

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

app.use(express.static(process.cwd()));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "electrichesk-moscow",
    apiKeyConfigured: Boolean(API_KEY)
  });
});

async function yandexRequest(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error("YANDEX_RASP_API_KEY не настроен в Render");
  }

  const url = new URL(`${API_BASE}/${endpoint}/`);
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
    const details = await response.text().catch(() => "");
    throw new Error(
      `Yandex API HTTP ${response.status}: ${details.slice(0, 300)}`
    );
  }

  return response.json();
}

function collectStations(data) {
  const stations = [];
  const seen = new Set();

  function walk(value) {
    if (!value) return;

    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }

    if (typeof value !== "object") return;

    const code = value.codes?.yandex_code;

    if (
      value.title &&
      code &&
      value.transport_type === "suburban" &&
      !seen.has(code)
    ) {
      seen.add(code);
      stations.push({
        title: value.title,
        name: value.title,
        code,
        codes: value.codes,
        transport_type: value.transport_type,
        station_type: value.station_type || ""
      });
    }

    for (const [key, child] of Object.entries(value)) {
      if (key !== "codes") walk(child);
    }
  }

  walk(data);
  return stations;
}

let cachedStations = [];
let cacheUpdatedAt = 0;
let loadingStations = null;

async function getStations() {
  if (
    cachedStations.length &&
    Date.now() - cacheUpdatedAt < 86400000
  ) {
    return cachedStations;
  }

  if (loadingStations) return loadingStations;

  loadingStations = (async () => {
    try {
      const data = await yandexRequest("stations_list");
      const stations = collectStations(data);

      if (!stations.length) {
        throw new Error("Список электричек пуст или имеет другой формат");
      }

      cachedStations = stations;
      cacheUpdatedAt = Date.now();
      console.log("Stations loaded:", stations.length);

      return stations;
    } finally {
      loadingStations = null;
    }
  })();

  return loadingStations;
}

app.get("/api/stations", async (req, res) => {
  try {
    const query = String(req.query.q || "")
      .trim()
      .toLocaleLowerCase("ru");

    const allStations = await getStations();

    const filtered = query
      ? allStations.filter(station =>
          station.title.toLocaleLowerCase("ru").includes(query)
        )
      : allStations;

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

    res.json(await yandexRequest("search", params));
  } catch (error) {
    console.error("Search error:", error.message);
    res.status(502).json({
      error: "Не удалось получить расписание",
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
