import { json } from "./admin-common.js";
import { fetchAnalyzeContext } from "./bigquery-analyze-context.js";

const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";
const MAX_QUESTION_LENGTH = 2000;
const MAX_CONTEXT_CHARS = 120000;

function trimEnv(name) {
  return String(process.env[name] || "").trim();
}

function getGeminiModel() {
  return trimEnv("GEMINI_MODEL") || DEFAULT_GEMINI_MODEL;
}

function buildSystemPrompt(context) {
  var contextJson = JSON.stringify(context, null, 2);
  if (contextJson.length > MAX_CONTEXT_CHARS) {
    contextJson = contextJson.slice(0, MAX_CONTEXT_CHARS) + "\n…(truncated)";
  }

  return (
    "당신은 제주 서귀포 펜션 GRAFFORD(그라포드)의 운영·마케팅 데이터 분석가입니다.\n" +
    "아래 JSON은 Google BigQuery에 적재된 예약(grafford_reserve) 및 취소(grafford_cancel) 데이터 요약입니다.\n" +
    "숫자는 제공된 데이터만 사용하고, 추측은 '가설'로 명시하세요.\n" +
    "답변은 한국어로, 경영진이 바로 실행할 수 있도록 구체적·간결하게 작성하세요.\n" +
    "표·불릿·소제목을 활용해 읽기 쉽게 정리하세요.\n\n" +
    "=== BigQuery 데이터 ===\n" +
    contextJson
  );
}

async function callGemini(apiKey, systemPrompt, question) {
  var model = getGeminiModel();
  var url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  var response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: systemPrompt + "\n\n=== 사용자 질문 ===\n" + question }],
        },
      ],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 4096,
      },
    }),
  });

  var data = await response.json().catch(function () {
    return {};
  });

  if (!response.ok) {
    var apiMsg =
      (data.error && data.error.message) ||
      "Gemini API 오류 (HTTP " + response.status + ")";
    if (response.status === 429) {
      apiMsg =
        "Gemini 무료 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.";
    }
    throw new Error(apiMsg);
  }

  var parts = data.candidates?.[0]?.content?.parts;
  var text = (parts || [])
    .map(function (p) {
      return String(p.text || "");
    })
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini가 분석 결과를 반환하지 않았습니다.");
  }

  return { text: text, model: model };
}

/**
 * POST /api/admin  resource=sales-analyze
 * Body: { adminId, adminPw, question }
 */
export async function handleAdminSalesAnalyze(res, _pool, body) {
  var question = String(body.question || "").trim();
  if (!question) {
    json(res, 400, { ok: false, error: "분석할 질문을 입력해 주세요." });
    return;
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    json(res, 400, {
      ok: false,
      error: "질문은 " + MAX_QUESTION_LENGTH + "자 이내로 입력해 주세요.",
    });
    return;
  }

  var apiKey = trimEnv("GEMINI_API_KEY");
  if (!apiKey) {
    json(res, 503, {
      ok: false,
      error: "GEMINI_API_KEY가 서버에 설정되지 않았습니다.",
    });
    return;
  }

  var context;
  try {
    context = await fetchAnalyzeContext();
  } catch (e) {
    console.error("[sales-analyze] BigQuery", e);
    json(res, 500, {
      ok: false,
      error:
        "BigQuery 데이터 조회에 실패했습니다: " +
        (e && e.message ? e.message : String(e)),
    });
    return;
  }

  var geminiResult;
  try {
    geminiResult = await callGemini(
      apiKey,
      buildSystemPrompt(context),
      question,
    );
  } catch (e) {
    console.error("[sales-analyze] Gemini", e);
    json(res, 500, {
      ok: false,
      error: (e && e.message) || "Gemini 분석 중 오류가 발생했습니다.",
    });
    return;
  }

  json(res, 200, {
    ok: true,
    analysis: geminiResult.text,
    model: geminiResult.model,
    contextGeneratedAt: context.generatedAt,
  });
}
