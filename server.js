import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = (process.env.YANDEX_RASP_API_KEY || "").trim();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "https://gordej365-lang.github.io");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "electrichesk-moscow",
    apiKeyConfigured: Boolean(API_KEY)
  });
});

async function yandexRequest(endpoint, params) {
  const url = new URL(`https://api.rasp.yandex.net/v3.0/${endpoint}/`);
  url.search = new URLSearchParams({
    apikey: API_KEY,
    format: "json",
    lang: "ru_RU",
    ...params
  }).toString();

  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  const body = await response.text();
  console.log(`Yandex ${endpoint}: HTTP ${response.status}`);

  if (!response.ok) {
    console.error(`Yandex error body: ${body.slice(0, 300)}`);
  }

  return { response, body };
}

app.get("/api/search", async (req, res) => {
  console.log("SEARCH REQUEST received");

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
      error: "Неверный формат даты."
    });
  }

  try {
    const { response, body } = await yandexRequest("search", {
      from: from.trim(),
      to: to.trim(),
      date,
      transport_types: "suburban",
      limit: "100"
    });

    res.status(response.status);
    res.set(
      "Content-Type",
      response.headers.get("content-type") ||
        "application/json; charset=utf-8"
    );

    return res.send(body);
  } catch (error) {
    console.error("SEARCH CONNECTION ERROR:", error.message);

    return res.status(502).json({
      error: "Не удалось связаться с API расписаний."
    });
  }
});

let stationsCache = [];
let stationsCacheTime = 0;
let stationsLoading = null;

async function getStations() {
  if (stationsCacheTime && Date.now() - stationsCacheTime < 86400000) {
    return stationsCache;
  }

  if (stationsLoading) return stationsLoading;

  stationsLoading = (async () => {
    const { response, body } = await yandexRequest("stations_list", {});

    if (!response.ok) {
      throw new Error(`Yandex stations HTTP ${response.status}`);
    }

    const data = JSON.parse(body);
    const found = new Map();

    function walk(node, region = "") {
      if (!node || typeof node !== "object") return;

      const currentRegion = node.title || region;

      if (
        node.codes?.yandex_code &&
        node.title &&
        (!node.transport_type || node.transport_type === "suburban")
      ) {
        const code = node.codes.yandex_code;

        found.set(code, {
          name: node.title,
          code,
          region: currentRegion,
          direction: node.direction || ""
        });
      }

      for (const [key, value] of Object.entries(node)) {
        if (key === "codes" || key === "title") continue;

        if (Array.isArray(value)) {
          for (const item of value) walk(item, currentRegion);
        } else if (value && typeof value === "object") {
          walk(value, currentRegion);
        }
      }
    }

    walk(data);

    stationsCache = [...found.values()];
    stationsCacheTime = Date.now();

    console.log("Stations loaded:", stationsCache.length);
    return stationsCache;
  })();

  try {
    return await stationsLoading;
  } finally {
    stationsLoading = null;
  }
}

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

    const stations = allStations
      .filter(station =>
        `${station.name} ${station.region} ${station.direction}`
          .toLocaleLowerCase("ru")
          .includes(q)
      )
      .sort((a, b) => a.name.localeCompare(b.name, "ru"))
      .slice(0, 50);

    return res.json({ stations });
  } catch (error) {
    console.error("STATIONS ERROR:", error.message);

    return res.status(502).json({
      error: "Не удалось загрузить список станций."
    });
  }
});

app.listen(PORT, () => {
  console.log(`ЭЛЕКТРИЧЕК запущен на порту ${PORT}`);
});
