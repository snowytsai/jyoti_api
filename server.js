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

// 共用：呼叫 vedic_api 取得命盤
async function fetchVedicChart({ date, time, lat, lon }) {
  if (!date || !time || lat == null || lon == null) {
    throw new Error("Missing required birth fields");
  }

  const chartUrl =
    `${VEDIC_API_BASE_URL}/api/vedic/chart-lite` +
    `?date=${encodeURIComponent(date)}` +
    `&time=${encodeURIComponent(time)}` +
    `&lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lon)}`;

  const chartRes = await fetch(chartUrl);

  if (!chartRes.ok) {
    const text = await chartRes.text();
    throw new Error(`Failed to fetch Vedic chart: ${text}`);
  }

  const chartData = await chartRes.json();

  if (!chartData.ok) {
    throw new Error("Vedic API returned error");
  }

  return chartData.chart;
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

    const chart = await fetchVedicChart({ date, time, lat, lon });

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

// 印度占星合盤解讀
app.post("/api/jyoti/synastry", checkApiKey, async (req, res) => {
  try {
    const {
      relationshipType,
      relationshipLabel,
      personA,
      personB,
      aspects,
    } = req.body;

    if (!personA || !personB) {
      return res.status(400).json({
        ok: false,
        error: "Missing personA or personB",
      });
    }

    const personAName =
      typeof personA.name === "string" && personA.name.trim()
        ? personA.name.trim()
        : "第一人";

    const personBName =
      typeof personB.name === "string" && personB.name.trim()
        ? personB.name.trim()
        : "第二人";

    const chartA = await fetchVedicChart(personA);
    const chartB = await fetchVedicChart(personB);

    const prompt = `
你是一位專業的印度占星合盤師（Jyotish Synastry）。

請直接開始分析，不要寫：
- 感謝提供資料
- 以下是合盤分析
- 我會用溫柔方式解讀
- 我將協助你
- 若你願意
- 如果你想再問
- 歡迎再詢問
- 問句結尾

請使用自然、成熟、專業的繁體中文。

風格要求：
- 像真正的印度占星師
- 不要客服感
- 不要 ChatGPT 感
- 不要過度安撫
- 不要心理諮商式開場
- 不要解釋 AI 自己
- 不要使用 emoji

請直接切入兩人的關係重點。

兩人的名字：
- ${personAName}
- ${personBName}

分析時請直接使用名字稱呼。
不要使用：
- A
- B
- A盤
- B盤
- 第一人
- 第二人
- 此人
- 對方

請依照關係類型調整解讀內容：

- 如果關係類型是「伴侶」：可以分析愛情、吸引力、親密張力、長期伴侶關係。
- 如果關係類型是「朋友」：不要使用戀愛、曖昧、親密關係、男女感情語氣，請改分析友情默契、信任感、陪伴感、溝通模式。
- 如果關係類型是「家人」：不要使用戀愛、曖昧、親密關係、男女感情語氣，請改分析家庭互動、照顧方式、情緒安全感、代際課題。
- 如果關係類型是「同事」：不要使用戀愛、曖昧、親密關係、男女感情語氣，請改分析合作默契、工作節奏、溝通效率、權責與衝突。
- 如果關係類型是「靈魂關係」：可以分析命運感、業力牽引、成長課題，但不要直接暗示一定是愛情。

請包含：

1. 兩人整體關係氣質
2. 月亮相容性：情緒、安全感、相處節奏
3. 金星與火星：依照關係類型分析吸引力、互動動力、合作張力或情感表達方式
4. 第七宮：依照關係類型分析一對一關係、合作模式、長期互動期待
5. Rahu / Ketu：業力感、命運感、容易執著或放不下的地方
6. 四項分數：
   - 關係相容度：0-100
   - 溝通理解度：0-100
   - 吸引力：0-100
   - 業力連結：0-100
7. 實際相處建議

分數請用清楚條列方式呈現。
建議要成熟、實際、有方向感。
不要保證一定會在一起，也不要說一定不適合。

最後直接結束。

關係類型：
${relationshipLabel || relationshipType || "未指定"}

兩人的主要合盤相位：
${JSON.stringify(aspects || [], null, 2)}

${personAName} 的星盤 JSON：
${JSON.stringify(chartA, null, 2)}

${personBName} 的星盤 JSON：
${JSON.stringify(chartB, null, 2)}
`;

    const gptRes = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });

    const text =
      gptRes.output_text ||
      gptRes.output?.[0]?.content?.[0]?.text ||
      "合盤解析失敗";

    return res.json({
      ok: true,
      personA: chartA,
      personB: chartB,
      reading: text,
    });
  } catch (error) {
    console.error("jyoti synastry error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Internal server error",
    });
  }
});

app.listen(PORT, () => {
  console.log(`jyoti_api running on port ${PORT}`);
});
