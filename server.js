import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const PORT = Number(process.env.PORT || 3000);
const API_KEY = (process.env.YANDEX_RASP_API_KEY || "").trim();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.static(__dirname));

// Проверка сервера и наличия API-ключа
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "electrichesk-moscow",
    apiKeyConfigured: API_KEY.length > 0
  });
});

// Поиск расписания электричек
app.get("/api/search", async (req, res) => {
  const { from, to, date } = req.query;

  if (!API_KEY) {
    return res.status(503).json({
      error: "Render не передал YANDEX_RASP_API_KEY запущенному серверу.",
      hint: "Проверь Environment у этого Web Service и сделай Deploy latest commit. Сам ключ не публикуй."
    });
  }

  if (
    typeof from !== "string" ||
    typeof to !== "string" ||
    !from.trim() ||
    !to.trim()
  ) {
    return res.status(400).json({
      error: "Нужны коды станций from и to."
    });
  }

  if (
    typeof date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(date)
  ) {
    return res.status(400).json({
      error: "Укажи дату в формате ГГГГ-ММ-ДД."
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
    const upstream = await fetch(url, {
      headers: { Accept: "application/json" }
    });

    const body = await upstream.text();

    res.status(upstream.status);
    res.set(
      "Content-Type",
      upstream.headers.get("content-type") ||
        "application/json; charset=utf-8"
    );

    // Не выводим URL в логи: он содержит API-ключ.
    return res.send(body);
  } catch {
    return res.status(502).json({
      error: "Не удалось связаться с API расписаний. Попробуй позже."
    });
  }
});

app.listen(PORT, () => {
  console.log(`ЭЛЕКТРИЧЕК запущен на порту ${PORT}`);
});
