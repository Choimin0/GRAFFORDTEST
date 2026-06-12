import { createSign } from "node:crypto";
import { json } from "./admin-common.js";
import { fetchAnalyzeContext } from "./bigquery-analyze-context.js";

/** v1 ListModels 기준 generateContent 지원 (1.5 계열은 v1에서 미제공) */
const AI_STUDIO_DEFAULT_MODEL = "gemini-2.0-flash";
const AI_STUDIO_FALLBACK_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
];
const AI_STUDIO_DEPRECATED_MODEL_PREFIX = /^gemini-1\.5-/i;
const VERTEX_DEFAULT_MODEL = "gemini-1.5-flash";
const MAX_QUESTION_LENGTH = 2000;
const MAX_CONTEXT_CHARS = 120000;

function trimEnv(name) {
  return String(process.env[name] || "").trim();
}

/**
 * google-ai-studio | vertex-ai
 * - GEMINI_API_KEY 있음 → Google AI Studio (현재 .env 구성)
 * - GEMINI_PROVIDER=vertex-ai 또는 API 키 없이 GCP 서비스 계정만 → Vertex AI
 */
export function detectGeminiProvider() {
  var explicit = trimEnv("GEMINI_PROVIDER").toLowerCase();
  if (
    explicit === "vertex" ||
    explicit === "vertex-ai" ||
    explicit === "vertex_ai"
  ) {
    return "vertex-ai";
  }
  if (
    explicit === "ai-studio" ||
    explicit === "google-ai-studio" ||
    explicit === "studio"
  ) {
    return "google-ai-studio";
  }

  if (trimEnv("GEMINI_API_KEY")) {
    return "google-ai-studio";
  }

  if (
    trimEnv("GOOGLE_PROJECT_ID") &&
    trimEnv("GOOGLE_CLIENT_EMAIL") &&
    trimEnv("GOOGLE_PRIVATE_KEY")
  ) {
    return "vertex-ai";
  }

  return "google-ai-studio";
}

function normalizeModelId(raw) {
  var id = String(raw || "").trim();
  if (id.startsWith("models/")) {
    id = id.slice("models/".length);
  }
  return id;
}

function isAiStudioModelNotFoundError(message, status) {
  var msg = String(message || "");
  return (
    status === 404 ||
    /not found/i.test(msg) ||
    /not supported for generateContent/i.test(msg)
  );
}

/** Google AI Studio v1에서 시도할 모델 ID 목록 (중복 제거) */
function getAiStudioModelsToTry() {
  var ordered = [];
  var seen = {};

  function push(id) {
    var normalized = normalizeModelId(id);
    if (!normalized || seen[normalized]) {
      return;
    }
    seen[normalized] = true;
    ordered.push(normalized);
  }

  var configured = normalizeModelId(trimEnv("GEMINI_MODEL"));
  if (configured && !AI_STUDIO_DEPRECATED_MODEL_PREFIX.test(configured)) {
    push(configured);
  } else if (configured) {
    console.warn(
      "[sales-analyze] GEMINI_MODEL=" +
        configured +
        " is not available on API v1; using " +
        AI_STUDIO_DEFAULT_MODEL,
    );
  }

  push(AI_STUDIO_DEFAULT_MODEL);
  AI_STUDIO_FALLBACK_MODELS.forEach(push);

  return ordered;
}

function getVertexModel() {
  var raw = trimEnv("GEMINI_MODEL") || VERTEX_DEFAULT_MODEL;
  if (raw.includes("publishers/google/models/")) {
    return raw.split("publishers/google/models/").pop();
  }
  if (raw.startsWith("models/")) {
    return raw.slice("models/".length);
  }
  return raw;
}

function getVertexLocation() {
  return trimEnv("GOOGLE_VERTEX_LOCATION") || trimEnv("GEMINI_VERTEX_LOCATION") || "us-central1";
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

function buildGenerateContentBody(systemPrompt, question) {
  return {
    contents: [
      {
        role: "user",
        parts: [
          { text: systemPrompt + "\n\n=== 사용자 질문 ===\n" + question },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 4096,
    },
  };
}

function parseGeminiResponse(data, response) {
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

  return text;
}

async function callGoogleAiStudioWithModel(
  apiKey,
  systemPrompt,
  question,
  model,
) {
  var url =
    "https://generativelanguage.googleapis.com/v1/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(apiKey);

  var response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildGenerateContentBody(systemPrompt, question)),
  });

  var data = await response.json().catch(function () {
    return {};
  });

  try {
    var text = parseGeminiResponse(data, response);
    return {
      text: text,
      model: model,
      provider: "google-ai-studio",
      endpoint: "generativelanguage.googleapis.com/v1",
    };
  } catch (e) {
    e.attemptedModel = model;
    e.httpStatus = response.status;
    throw e;
  }
}

async function callGoogleAiStudio(apiKey, systemPrompt, question) {
  var models = getAiStudioModelsToTry();
  var lastError = null;

  for (var i = 0; i < models.length; i++) {
    var model = models[i];
    try {
      return await callGoogleAiStudioWithModel(
        apiKey,
        systemPrompt,
        question,
        model,
      );
    } catch (e) {
      lastError = e;
      if (
        isAiStudioModelNotFoundError(e.message, e.httpStatus) &&
        i < models.length - 1
      ) {
        console.warn(
          "[sales-analyze] model not available on v1, retrying:",
          model,
          "→",
          models[i + 1],
        );
        continue;
      }
      throw e;
    }
  }

  throw (
    lastError ||
    new Error("사용 가능한 Gemini 모델을 찾지 못했습니다.")
  );
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function getVertexAccessToken(clientEmail, privateKey) {
  var now = Math.floor(Date.now() / 1000);
  var header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  var claimSet = base64url(
    JSON.stringify({
      iss: clientEmail,
      sub: clientEmail,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
      scope: "https://www.googleapis.com/auth/cloud-platform",
    }),
  );
  var unsigned = header + "." + claimSet;
  var signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  var signature = signer.sign(privateKey.replace(/\\n/g, "\n"));
  var jwt = unsigned + "." + base64url(signature);

  var tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=" +
      encodeURIComponent(jwt),
  });

  var tokenData = await tokenRes.json().catch(function () {
    return {};
  });
  if (!tokenRes.ok || !tokenData.access_token) {
    throw new Error(
      (tokenData.error_description || tokenData.error || "Vertex AI 인증 실패") +
        "",
    );
  }
  return tokenData.access_token;
}

async function callVertexAi(systemPrompt, question) {
  var projectId = trimEnv("GOOGLE_PROJECT_ID");
  var clientEmail = trimEnv("GOOGLE_CLIENT_EMAIL");
  var privateKey = trimEnv("GOOGLE_PRIVATE_KEY");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Vertex AI에는 GOOGLE_PROJECT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY가 필요합니다.",
    );
  }

  var location = getVertexLocation();
  var model = getVertexModel();
  var modelPath = "publishers/google/models/" + model;
  var url =
    "https://" +
    location +
    "-aiplatform.googleapis.com/v1/projects/" +
    encodeURIComponent(projectId) +
    "/locations/" +
    encodeURIComponent(location) +
    "/" +
    modelPath +
    ":generateContent";

  var accessToken = await getVertexAccessToken(clientEmail, privateKey);

  var response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildGenerateContentBody(systemPrompt, question)),
  });

  var data = await response.json().catch(function () {
    return {};
  });
  var text = parseGeminiResponse(data, response);

  return {
    text: text,
    model: modelPath,
    provider: "vertex-ai",
    endpoint: location + "-aiplatform.googleapis.com/v1",
  };
}

async function callGemini(systemPrompt, question) {
  var provider = detectGeminiProvider();

  if (provider === "vertex-ai") {
    return callVertexAi(systemPrompt, question);
  }

  var apiKey = trimEnv("GEMINI_API_KEY");
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY가 서버에 설정되지 않았습니다.");
  }
  return callGoogleAiStudio(apiKey, systemPrompt, question);
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

  var provider = detectGeminiProvider();
  if (provider === "google-ai-studio" && !trimEnv("GEMINI_API_KEY")) {
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
    geminiResult = await callGemini(buildSystemPrompt(context), question);
    console.info("[sales-analyze] provider=" + geminiResult.provider, {
      model: geminiResult.model,
      endpoint: geminiResult.endpoint,
    });
  } catch (e) {
    console.error("[sales-analyze] Gemini provider=" + provider, e);
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
    provider: geminiResult.provider,
    contextGeneratedAt: context.generatedAt,
  });
}
