import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 你的 vedic_api Render URL
const VEDIC_API_BASE_URL =
  process.env.VEDIC_API_BASE_URL || "https://vedic-api-2r5k.onrender.com";

// API Key 保護 jyoti_api
function checkApiKey(req, res, next) {
  const apiKey = req.headers["x-api-key"];

  if (!process.env.APP_API_KEY) {
    return next();
  }

  if (apiKey !== process.env.APP_API_KEY) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
    });
  }

  next();
}

// 健康檢查
app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "jyoti_api",
    message: "EZJyoti GPT API is running",
  });
});

// 星盤 + GPT 解讀
app.post("/api/jyoti/reading", checkApiKey, async (req, res) => {
  try {
    const { date, time, lat, lon, question } = req.body;

    if (!date || !time || lat == null || lon == null) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields: date, time, lat, lon",
      });
    }

    // 1. 呼叫 vedic_api
    const chartUrl =
      `${VEDIC_API_BASE_URL}/api/vedic/chart-lite` +
      `?date=${encodeURIComponent(date)}` +
      `&time=${encodeURIComponent(time)}` +
      `&lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lon)}`;

    const chartRes = await fetch(chartUrl);

    if (!chartRes.ok) {
      const text = await chartRes.text();
      return res.status(502).json({
        ok: false,
        error: "Failed to fetch Vedic chart",
        detail: text,
      });
    }

    const chartData = await chartRes.json();

    if (!chartData.ok) {
      return res.status(502).json({
        ok: false,
        error: "Vedic API returned error",
        detail: chartData,
      });
    }

    // 2. 整理給 GPT 的資料
    const chart = chartData.chart;

    const prompt = `
你是一位專業但語氣溫柔的印度占星師，請根據以下印度占星星盤資料，使用繁體中文解讀。

請用一般人看得懂的方式，不要太學術。

請包含以下段落：
1. 整體命盤氣質
2. 上升星座與人生主軸
3. 太陽、月亮與內在性格
4. 行星落宮重點
5. 目前生命課題
6. 給使用者的建議

如果使用者有問題，也請一起回答。

使用者問題：
${question || "無特定問題，請做整體命盤解析"}

星盤資料 JSON：
${JSON.stringify(chart, null, 2)}
`;

    // 3. 呼叫 GPT
    const gptRes = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });

    const text =
      gptRes.output_text ||
      gptRes.output?.[0]?.content?.[0]?.text ||
      "解析失敗，沒有取得文字內容。";

    return res.json({
      ok: true,
      chart,
      reading: text,
    });
  } catch (error) {
    console.error("jyoti reading error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Internal server error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`jyoti_api running on port ${PORT}`);
});
