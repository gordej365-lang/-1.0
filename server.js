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

app.use(express.static(__dirname));

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    service: "electrichesk-moscow",
    apiKeyConfigured: Boolean(API_KEY)
  });
});

async function yandexRequest(endpoint, params = {}) {
  if (!API_KEY) {
    throw new Error("YANDEX_RASP_API_KEY is not configured on Render");
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
  const found = [];
  const seen = new Set();

  function walk(value) {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item);
      return;
    }

    if (typeof value !== "object") return;

    const code = value.codes && value.codes.yandex_code;

    if (value.title && code && value.transport_type === "suburban") {
      if (!seen.has(code)) {
        seen.add(code);
        found.push({
          title: value.title,
          name: value.title,
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
  return found;
}

let cachedStations = [];
let cacheUpdatedAt = 0;
let loadingStations = null;
const CACHE_MS = 24 * 60
