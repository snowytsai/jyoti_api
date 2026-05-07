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

// vedic_api Render URL
const VEDIC_API_BASE_URL =
  process.env.VEDIC_API_BASE_URL ||
  "https://vedic-api-2r5k.onrender.com";

// API Key 保護
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

// 印度占星 AI 解讀
app.post("/api/jyoti/reading", checkApiKey, async (req, res) => {
  try {
    const { date, time, lat, lon } = req.body;

    if (!date || !time || lat == null || lon == null) {
      return res.status(400).json({
        ok: false,
        error: "Missing required fields",
      });
    }

    // 呼叫 vedic_api
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

    const chart = chartData.chart;

    // GPT Prompt
    const prompt = `
你是一位專業的印度占星師（Jyotish）。

請直接開始解讀，不要寫：
- 感謝提供資料
- 我會用溫柔方式解讀
- 以下是你的分析
- 我將協助你
- 若你願意
- 如果你想再問
- 歡迎再詢問
- 問句結尾

請使用自然、成熟、專業的繁體中文。

風格要求：
- 像真正的占星師
- 不要客服感
- 不要 ChatGPT 感
- 不要過度安撫
- 不要心理諮商式開場
- 不要解釋 AI 自己

請直接切入命盤重點。

請包含：

1. 整體命盤氣質
2. 上升與人生主軸
3. 太陽與月亮性格
4. 九大行星重點
5. 目前大運與人生課題
6. 實際建議

建議要成熟、實際、有方向感。

不要使用：
- 😊
- 🙏
- ✨
- 「希望對你有幫助」
- 「你可以再問我」
- 「如果你願意」
- 「歡迎繼續詢問」

最後直接結束。

星盤資料 JSON：
${JSON.stringify(chart, null, 2)}
`;

    // 呼叫 GPT
    const gptRes = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });

    const text =
      gptRes.output_text ||
      gptRes.output?.[0]?.content?.[0]?.text ||
      "解析失敗";

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
