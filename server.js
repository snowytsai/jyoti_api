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

// 共用：安全取得行星資料
function findPlanet(chart, keyOrName) {
  const target = String(keyOrName).toLowerCase();

  if (chart?.main_planets && typeof chart.main_planets === "object") {
    const planetsObject = chart.main_planets;

    if (planetsObject[target]) {
      return planetsObject[target];
    }

    const found = Object.values(planetsObject).find((p) => {
      return (
        String(p?.key || "").toLowerCase() === target ||
        String(p?.name || "").toLowerCase() === target
      );
    });

    if (found) return found;
  }

  if (Array.isArray(chart?.planets)) {
    return (
      chart.planets.find((p) => String(p.key || "").toLowerCase() === target) ||
      chart.planets.find((p) => String(p.name || "").toLowerCase() === target) ||
      null
    );
  }

  return null;
}

// 共用：取得月亮 Nakshatra
function extractMoonNakshatra(chart) {
  const moon =
    chart?.main_planets?.moon ||
    findPlanet(chart, "moon") ||
    findPlanet(chart, "月亮");

  if (!moon) {
    return {
      name: "未知",
      pada: null,
      lord: null,
      sign: null,
      degree: null,
      house: null,
      navamsa: null,
      raw: null,
    };
  }

  return {
    name: moon.nakshatra || moon.nakshatraName || "未知",
    pada: moon.pada || moon.nakshatraPada || null,
    lord: moon.nakshatraLord || moon.lord || null,
    sign: moon.sign || null,
    degree: moon.degree ?? null,
    house: moon.house ?? null,
    navamsa: moon.navamsa || null,
    raw: moon,
  };
}

// 簡單分數：先給 GPT 參考用，不當成絕對命運判斷
function calculateBasicNakshatraScore(nakA, nakB) {
  let score = 70;

  if (!nakA?.name || !nakB?.name || nakA.name === "未知" || nakB.name === "未知") {
    return {
      score: 60,
      level: "資料不足",
    };
  }

  if (nakA.name === nakB.name) {
    score += 8;
  }

  if (nakA.lord && nakB.lord && nakA.lord === nakB.lord) {
    score += 6;
  }

  if (nakA.pada && nakB.pada && nakA.pada === nakB.pada) {
    score += 3;
  }

  if (score > 100) score = 100;

  if (score >= 85) {
    return { score, level: "高度契合" };
  }

  if (score >= 75) {
    return { score, level: "良好" };
  }

  if (score >= 65) {
    return { score, level: "中等偏穩" };
  }

  return { score, level: "需要磨合" };
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

// 伴侶 Nakshatra 配對解讀
app.post("/api/jyoti/nakshatra-match", checkApiKey, async (req, res) => {
  try {
    const {
      relationshipType,
      relationshipLabel,
      personA,
      personB,
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

    const moonNakshatraA = extractMoonNakshatra(chartA);
    const moonNakshatraB = extractMoonNakshatra(chartB);

    const basicMatch = calculateBasicNakshatraScore(
      moonNakshatraA,
      moonNakshatraB
    );

    const prompt = `
你是一位專業的印度占星師，擅長用 Moon Nakshatra 分析伴侶關係。

請直接開始分析，不要寫：
- 感謝提供資料
- 以下是分析
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

這是一個「月亮星宿 Nakshatra 伴侶配對」功能。
請以兩人的 Moon Nakshatra 為核心，分析情緒節奏、安全感、吸引力、長期相處與關係課題。

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

關係類型：
${relationshipLabel || relationshipType || "伴侶"}

月亮 Nakshatra 資料：

${personAName}：
${JSON.stringify(moonNakshatraA, null, 2)}

${personBName}：
${JSON.stringify(moonNakshatraB, null, 2)}

系統初步參考分數：
${JSON.stringify(basicMatch, null, 2)}

請輸出以下內容：

1. 月亮星宿配對總評
2. 情緒相容性
3. 安全感與依附模式
4. 吸引力與親密節奏
5. 長期相處優勢
6. 容易摩擦的地方
7. 四項分數：
   - 情緒契合度：0-100
   - 安全感穩定度：0-100
   - 吸引力：0-100
   - 長期相處潛力：0-100
8. 實際相處建議

分數請用清楚條列方式呈現。
可以參考系統初步分數，但請依照兩人的星宿特質做合理調整。
不要保證一定會在一起，也不要說一定不適合。
不要恐嚇式斷言。
最後直接結束。

完整星盤資料也提供給你輔助判斷，但請不要寫得像完整合盤，重點放在 Moon Nakshatra。

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
      "Nakshatra 配對解析失敗";

    return res.json({
      ok: true,
      matchType: "moon_nakshatra_partner_match",
      personA: {
        name: personAName,
        chart: chartA,
        moonNakshatra: moonNakshatraA,
      },
      personB: {
        name: personBName,
        chart: chartB,
        moonNakshatra: moonNakshatraB,
      },
      basicMatch,
      reading: text,
    });
  } catch (error) {
    console.error("jyoti nakshatra match error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Internal server error",
    });
  }
});

app.post("/api/jyoti/transit-reading", checkApiKey, async (req, res) => {
  try {
    const { natal, transit } = req.body;

    if (!natal || !transit) {
      return res.status(400).json({
        ok: false,
        error: "缺少 natal 或 transit 資料",
      });
    }

    const prompt = `
const prompt = `
你是一位專業的印度占星師（Jyotish）。

請根據本命盤與 transit planets，
用繁體中文寫出自然、成熟、專業的流年分析。

請直接開始解讀，不要寫：
- 感謝提供資料
- 以下是分析
- 我會幫你分析
- 如果你願意
- 歡迎再詢問
- 問句結尾

風格要求：
- 像真正的占星師
- 不要客服感
- 不要 ChatGPT 感
- 不要過度安撫
- 不要太玄
- 不要使用 emoji

請重點分析以下行星：

【短期影響行星】

1. 太陽 Sun
- 事業曝光
- 自我定位
- 被看見的機會
- 權威關係

2. 月亮 Moon
- 情緒狀態
- 安全感
- 內在需求
- 家庭感受

3. 水星 Mercury
- 溝通
- 人際互動
- 思考方式
- 學習與訊息

4. 金星 Venus
- 感情
- 吸引力
- 人緣
- 享受與消費

5. 火星 Mars
- 壓力
- 行動力
- 衝突
- 急躁與競爭感

【長期影響行星】

6. 木星 Jupiter
- 成長
- 貴人
- 機會
- 擴張與信念

7. 土星 Saturn
- 壓力
- 責任
- 限制
- 成熟課題

8. Rahu
- 執著
- 放大
- 突破
- 非典型機會

9. Ketu
- 放下
- 疏離
- 靈性
- 舊模式結束

請包含：

1. 今日流年主題
2. 工作與金錢
3. 感情與人際
4. 情緒與內在狀態
5. 今日主要影響行星
6. 今日建議

請說明：
- 哪些行星影響最大
- 哪些事情容易發生
- 哪些地方需要注意
- 可以怎麼調整

內容約 700 字內。

本命盤：
${JSON.stringify(natal, null, 2)}

年度流年：
${JSON.stringify(transit, null, 2)}
`;

    const completion = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });

    const reading =
      completion.output_text ||
      completion.output?.[0]?.content?.[0]?.text ||
      "沒有取得流年解讀內容";

    res.json({
      ok: true,
      reading,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({
      ok: false,
      error: "transit-reading failed",
    });
  }
});

// 年度流年 AI 解讀
app.post("/api/jyoti/yearly-reading", checkApiKey, async (req, res) => {
  try {
    const { natal, yearlyForecast } = req.body;

    if (!natal || !yearlyForecast) {
      return res.status(400).json({
        ok: false,
        error: "缺少 natal 或 yearlyForecast 資料",
      });
    }

    const prompt = `
你是一位專業的印度占星師（Jyotish），擅長年度流年、大運、木星土星行運與 Rahu/Ketu 軸線分析。

請根據「本命盤」與「年度流年資料」，寫一份繁體中文年度流年解讀。

請直接開始解讀，不要寫：
- 感謝提供資料
- 以下是分析
- 我會幫你分析
- 如果你願意
- 歡迎再詢問
- 問句結尾

風格要求：
- 像真正 App 裡的個人化年度運勢
- 成熟、清楚、實用
- 不要太玄
- 不要客服感
- 不要 ChatGPT 感
- 不要使用 emoji
- 不要恐嚇式斷言

請包含以下段落：

1. 今年整體主題
   - 根據本命盤、大運與年度行運，說明今年主要人生課題。

2. 事業與金錢
   - 分析今年適合推進、轉型、穩定累積或需要保守的地方。

3. 感情與人際
   - 分析關係、人際、合作、伴侶互動上的年度傾向。

4. 情緒與內在狀態
   - 分析今年壓力、焦慮、內在轉變、安全感與精神狀態。

5. 重要月份提醒
   - 請依照 1～12 月資料，挑出比較明顯的月份。
   - 請用條列方式，例如：
     - 3月：……
     - 6月：……
     - 10月：……

6. 太陽 / 月亮 / 水星 / 金星 / 火星 重點
   - 太陽：今年的事業曝光、自我定位
   - 月亮：情緒與安全感變化
   - 水星：溝通、人際、學習與合作
   - 金星：感情、人緣、享受與吸引力
   - 火星：壓力、衝突、競爭與推進力
   - 請說明哪些短期行星會成為事件觸發點。

7. Jupiter / Saturn / Rahu / Ketu 重點
   - 木星代表成長與機會
   - 土星代表壓力、責任與成熟
   - Rahu/Ketu 代表執著、轉折與放下
   - 請結合每月流年資料分析。

8. 今年建議
   - 給出實際、可執行的生活建議。
   - 不要空泛。

字數約 900～1300 字。
最後直接結束，不要問問題。

本命盤 JSON：
${JSON.stringify(natal, null, 2)}

年度流年 JSON：
${JSON.stringify(yearlyForecast, null, 2)}
`;

    const gptRes = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });

    const reading =
      gptRes.output_text ||
      gptRes.output?.[0]?.content?.[0]?.text ||
      "沒有取得年度流年解讀內容";

    return res.json({
      ok: true,
      reading,
    });
  } catch (error) {
    console.error("jyoti yearly-reading error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "yearly-reading failed",
    });
  }
});


// 三年流年 AI 解讀
app.post("/api/jyoti/three-year-reading", checkApiKey, async (req, res) => {
  try {
    const { natal, threeYearForecast } = req.body;

    if (!natal || !threeYearForecast) {
      return res.status(400).json({
        ok: false,
        error: "缺少 natal 或 threeYearForecast 資料",
      });
    }

    const prompt = `
你是一位專業的印度占星師（Jyotish），擅長三年流年、大運、木星土星行運與 Rahu/Ketu 軸線分析。

請根據「本命盤」與「三年流年資料」，寫一份繁體中文三年流年解讀。

請直接開始解讀，不要寫：
- 感謝提供資料
- 以下是分析
- 我會幫你分析
- 如果你願意
- 歡迎再詢問
- 問句結尾

風格要求：
- 像真正 App 裡的個人化三年運勢
- 成熟、清楚、實用
- 不要太玄
- 不要客服感
- 不要 ChatGPT 感
- 不要使用 emoji
- 不要恐嚇式斷言

請包含以下段落：

1. 三年整體主題
   - 根據本命盤、大運與三年行運，說明接下來三年的主要人生課題。

2. 第一階段
   - 分析第一年的主軸、壓力、機會與需要穩住的地方。

3. 第二階段
   - 分析第二年的轉折、成長、關係或事業變化。

4. 第三階段
   - 分析第三年的收斂、成熟、成果與下一階段準備。

5. 事業與金錢
   - 分析三年內適合推進、轉型、累積或保守的地方。

6. 感情與人際
   - 分析關係、人際、合作、伴侶互動上的三年傾向。

7. 情緒與內在狀態
   - 分析三年內壓力、安全感、內在轉變與精神狀態。

8. 重要時間點提醒
   - 請依照資料挑出比較明顯的時間點。
   - 請用條列方式，例如：
     - 2026 上半年：……
     - 2027 下半年：……
     - 2028：……

9. Jupiter / Saturn / Rahu / Ketu 重點
   - 木星代表成長與機會
   - 土星代表壓力、責任與成熟
   - Rahu/Ketu 代表執著、轉折與放下
   - 請結合三年流年資料分析。

10. 三年建議
   - 給出實際、可執行的生活建議。
   - 不要空泛。

字數約 1100～1600 字。
最後直接結束，不要問問題。

本命盤 JSON：
${JSON.stringify(natal, null, 2)}

三年流年 JSON：
${JSON.stringify(threeYearForecast, null, 2)}
`;

    const gptRes = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });

    const reading =
      gptRes.output_text ||
      gptRes.output?.[0]?.content?.[0]?.text ||
      "沒有取得三年流年解讀內容";

    return res.json({
      ok: true,
      reading,
    });
  } catch (error) {
    console.error("jyoti three-year-reading error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "three-year-reading failed",
    });
  }
});


// 十年流年 AI 解讀
app.post("/api/jyoti/ten-year-reading", checkApiKey, async (req, res) => {
  try {
    const { natal, tenYearForecast } = req.body;

    if (!natal || !tenYearForecast) {
      return res.status(400).json({
        ok: false,
        error: "缺少 natal 或 tenYearForecast 資料",
      });
    }

    const prompt = `
你是一位專業的印度占星師（Jyotish），擅長長期人生週期、大運、木星土星行運與 Rahu/Ketu 軸線分析。

請根據「本命盤」與「十年流年資料」，寫一份繁體中文十年流年解讀。

請直接開始解讀，不要寫：
- 感謝提供資料
- 以下是分析
- 我會幫你分析
- 如果你願意
- 歡迎再詢問
- 問句結尾

風格要求：
- 像真正 App 裡的高階長期人生分析
- 成熟、清楚、實用
- 不要太玄
- 不要客服感
- 不要 ChatGPT 感
- 不要使用 emoji
- 不要恐嚇式斷言

請包含以下段落：

1. 十年整體人生主題
   - 根據本命盤、大運與十年行運，分析接下來十年的主要人生方向。

2. 前三年
   - 分析起始階段的重要課題、壓力與機會。

3. 中期轉折
   - 分析中段幾年的重要轉變、成長與人生變化。

4. 後期成熟期
   - 分析後段幾年的穩定、收穫與人生定位。

5. 事業與財富
   - 分析十年內事業發展、財務累積與適合的方向。

6. 感情與關係
   - 分析長期感情、人際與合作關係的變化。

7. 情緒與內在成長
   - 分析十年間的心理成熟、壓力來源與內在轉變。

8. 關鍵年份提醒
   - 請列出重要年份。
   - 例如：
     - 2027：……
     - 2030：……
     - 2033：……
9. 太陽 / 月亮 / 水星 / 金星 / 火星
   會作為事件觸發點與人生階段變化催化劑，
   請分析它們如何影響：
   - 人際
   - 關係
   - 情緒
   - 壓力
   - 行動力
   - 人生方向

10. Jupiter / Saturn / Rahu / Ketu 重點
   - 木星代表成長與機會
   - 土星代表責任與成熟
   - Rahu/Ketu 代表人生轉向與執著
   - 請結合十年資料分析。

11. 十年建議
   - 給出成熟、實際、可執行的人生建議。
   - 不要空泛。

字數約 1400～2200 字。
最後直接結束，不要問問題。

本命盤 JSON：
${JSON.stringify(natal, null, 2)}

十年流年 JSON：
${JSON.stringify(tenYearForecast, null, 2)}
`;

    const gptRes = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });

    const reading =
      gptRes.output_text ||
      gptRes.output?.[0]?.content?.[0]?.text ||
      "沒有取得十年流年解讀內容";

    return res.json({
      ok: true,
      reading,
    });
  } catch (error) {
    console.error("jyoti ten-year-reading error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "ten-year-reading failed",
    });
  }
});

// 本週運勢 AI 解讀
app.post("/api/jyoti/weekly-reading", checkApiKey, async (req, res) => {
  try {
    const { natal, weeklyFortune } = req.body;

    if (!natal || !weeklyFortune) {
      return res.status(400).json({
        ok: false,
        error: "缺少 natal 或 weeklyFortune 資料",
      });
    }

    const prompt = `
你是一位專業、溫柔但直接的印度占星師。
請根據以下本命盤與本週 7 天行運資料，寫一份繁體中文本週運勢解讀。

請直接開始解讀，不要寫感謝提供資料、以下是分析、歡迎再詢問，也不要用問句結尾。

請包含：
1. 本週整體主題
2. 工作與金錢
3. 感情與人際
4. 情緒與內在狀態
5. 本週每日提醒
6. 本週建議

請同時分析：
- 太陽：事業曝光、自我定位
- 月亮：情緒、安全感
- 水星：溝通、人際、思考
- 金星：感情、吸引力、人緣
- 火星：壓力、衝突、行動力

並保留：
- 木星：成長與機會
- 土星：責任與壓力
- Rahu/Ketu：執著、轉折與放下

請指出本週主要影響行星與事件傾向。
語氣要像 App 裡的專屬占星分析，不要太玄，不要客服感，不要使用 emoji。
內容約 800～1200 字。

本命盤 JSON：
${JSON.stringify(natal, null, 2)}

本週行運 JSON：
${JSON.stringify(weeklyFortune, null, 2)}
`;

    const gptRes = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });

    const reading =
      gptRes.output_text ||
      gptRes.output?.[0]?.content?.[0]?.text ||
      "沒有取得本週運勢解讀內容";

    return res.json({
      ok: true,
      reading,
    });
  } catch (error) {
    console.error("jyoti weekly-reading error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "weekly-reading failed",
    });
  }
});


// 本月運勢 AI 解讀
app.post("/api/jyoti/monthly-reading", checkApiKey, async (req, res) => {
  try {
    const { natal, monthlyFortune } = req.body;

    if (!natal || !monthlyFortune) {
      return res.status(400).json({
        ok: false,
        error: "缺少 natal 或 monthlyFortune 資料",
      });
    }

    const prompt = `
你是一位專業、溫柔但直接的印度占星師。
請根據以下本命盤與本月每週行運資料，寫一份繁體中文本月運勢解讀。

請直接開始解讀，不要寫感謝提供資料、以下是分析、歡迎再詢問，也不要用問句結尾。

請包含：
1. 本月整體主題
2. 工作與金錢
3. 感情與人際
4. 情緒與內在狀態
5. 每週重點提醒
6. 本月建議

請同時分析：
- 太陽：事業曝光、自我定位
- 月亮：情緒、安全感
- 水星：溝通、人際、思考
- 金星：感情、吸引力、人緣
- 火星：壓力、衝突、行動力

並保留：
- 木星：成長與機會
- 土星：責任與壓力
- Rahu/Ketu：執著、轉折與放下

請說明本月哪些行星影響最強。
    
語氣要像 App 裡的專屬占星分析，不要太玄，不要客服感，不要使用 emoji。
內容約 1000～1400 字。

本命盤 JSON：
${JSON.stringify(natal, null, 2)}

本月行運 JSON：
${JSON.stringify(monthlyFortune, null, 2)}
`;

    const gptRes = await openai.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5-mini",
      input: prompt,
    });

    const reading =
      gptRes.output_text ||
      gptRes.output?.[0]?.content?.[0]?.text ||
      "沒有取得本月運勢解讀內容";

    return res.json({
      ok: true,
      reading,
    });
  } catch (error) {
    console.error("jyoti monthly-reading error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "monthly-reading failed",
    });
  }
});


app.listen(PORT, () => {
  console.log(`jyoti_api running on port ${PORT}`);
});
