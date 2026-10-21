
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = (process.env.YANDEX_RASP_API_KEY || "").trim();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(__dirname));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "electrichesk-moscow",
    apiKeyConfigured: API_KEY.length > 0
  });
});

// Кэш полного списка станций
let stationsCache = null;
let stationsCacheTime = 0;
let stationsLoading = null;

async function getStations() {
  // Обновляем кэш раз в сутки
  if (stationsCache && Date.now() - stationsCacheTime < 86400000) {
    return stationsCache;
  }

  // Не скачиваем список несколько раз одновременно
  if (stationsLoading) return stationsLoading;

  stationsLoading = (async () => {
    const url = new URL(
      "https://api.rasp.yandex-net.ru/v3.0/stations_list/"
    );

    url.search = new URLSearchParams({
      apikey: API_KEY,
      format: "json",
      lang: "ru_RU"
    }).toString();

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error("Не удалось получить список станций");
    }

    const data = await response.json();
    const stations = [];

    function walk(node, region = "", settlement = "") {
      if (!node || typeof node !== "object") return;

      const currentRegion = node.regions
        ? region
        : node.title || region;

      if (Array.isArray(node.settlements)) {
        for (const item of node.settlements) {
          walk(item, currentRegion, item.title || "");
        }
      }

      if (Array.isArray(node.stations)) {
        for (const station of node.stations) {
          if (
            station.codes?.yandex_code &&
            station.transport_type === "suburban"
          ) {
            stations.push({
              name: station.title || "",
              code: station.codes.yandex_code,
              region: currentRegion,
              settlement,
              direction: station.direction || ""
            });
          }
        }
      }

      if (Array.isArray(node.countries)) {
        for (const item of node.countries) {
          walk(item, currentRegion, settlement);
        }
      }

      if (Array.isArray(node.regions)) {
        for (const item of node.regions) {
          walk(item, item.title || currentRegion, settlement);
        }
      }
    }

    walk(data);

    stationsCache = stations;
    stationsCacheTime = Date.now();
    return stations;
  })();

  try {
    return await stationsLoading;
  } finally {
    stationsLoading = null;
  }
}

// Поиск станций по названию
app.get("/api/stations", async (req, res) => {
  const q = typeof req.query.q === "string"
    ? req.query.q.trim().toLocaleLowerCase("ru")
    : "";

  if (q.length < 2) {
    return res.json({ stations: [] });
  }

  if (!API_KEY) {
    return res.status(503).json({
      error: "API-ключ не настроен в Render."
    });
  }

  try {
    const allStations = await getStations();

    const found = allStations
      .filter(station => {
        const text = [
          station.name,
          station.settlement,
          station.direction,
          station.region
        ].join(" ").toLocaleLowerCase("ru");

        return text.includes(q);
      })
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .slice(0, 50);

    res.json({ stations: found });
  } catch {
    res.status(502).json({
      error: "Не удалось загрузить станции. Попробуй позже."
    });
  }
});

// Расписание между двумя станциями
app.get("/api/search", async (req, res) => {
  const { from, to, date } = req.query;

  if (!API_KEY) {
    return res.status(503).json({
      error: "API-ключ не настроен в Render."
    });
  }

  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !from.trim() ||
    !to.trim()
  ) {
    return res.status(400).json({
      error: "Укажи станции отправления и прибытия."
    });
  }

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return res.status(400).json({
      error: "Дата должна быть в формате ГГГГ-ММ-ДД."
    });
  }

  const url = new URL(
    "https://api.rasp.yandex-net.ru/v3.0/search/"
  );

  url.search = new URLSearchParams({
    apikey: API_KEY,
    format: "json",
    from: from.trim(),
    to: to.trim(),
    lang: "ru_RU",
    date,
    transport_types: "suburban",
    limit: "100"
  }).toString();

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    const body = await response.text();

    res.status(response.status);
    res.set(
      "Content-Type",
      response.headers.get("content-type") ||
        "application/json; charset=utf-8"
    );

    return res.send(body);
  } catch {
    return res.status(502).json({
      error: "Не удалось связаться с API расписаний."
    });
  }
});

app.listen(PORT, () => {
  console.log(`ЭЛЕКТРИЧЕК запущен на порту ${PORT}`);
});

