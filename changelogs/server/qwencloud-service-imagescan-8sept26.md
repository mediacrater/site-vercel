Grok chat: https://grok.com/share/c2hhcmQtNA_2372e4cb-39cd-4be8-8bda-721ef8a9482a

# Image pipeline: OpenRouter → QwenCloud

Working record of the 2026-09-08 cutover. Image scans go to QwenCloud.
Video scans stay on OpenRouter. Copy this file onto the VPS next to the
three source files it describes.

## File index

| File | Role |
|---|---|
| [`server.js`](./server.js) | Split provider configs. `/scan-image` gets `qwenCloudConfig`. `/scan-video` still gets `openRouterConfig`. |
| [`helpers.js`](./helpers.js) | Two fetch helpers. Image request body uses QwenCloud fields. Video request body unchanged. |
| [`routes/scanImage.js`](./routes/scanImage.js) | Accepts `qwenCloudConfig` and passes it into `analyzeImageWithAI`. |

Env: `QWENCLOUD_API_KEY` (already on the VPS). Video still uses `OPENROUTER_KEY`. `IMAGE_MODEL` and `VIDEO_MODEL`

## Routing

| Route | Provider | Config object | Model | Fetch helper |
|---|---|---|---|---|
| `POST /scan-image` | QwenCloud | `qwenCloudConfig` | `qwen3.7-flash` | `fetchQwenCloudCompletion` |
| `POST /scan-video` | OpenRouter | `openRouterConfig` | `google/gemini-2.5-flash-lite` | `fetchOpenRouterCompletion` |

Both helpers must exist in `helpers.js`. Do not rename one into the other.

---

## 1. `server.js`

### Config (section 4)

**Before:** one object owned both models.

```javascript
const openRouterConfig = {
  apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKey: process.env.OPENROUTER_KEY,
  imagemodel: 'qwen/qwen3.7-flash',
  videomodel: 'google/gemini-2.5-flash-lite',
};
```

**After (working):**

```javascript
const openRouterConfig = {
  apiUrl: 'https://openrouter.ai/api/v1/chat/completions',
  apiKey: process.env.OPENROUTER_KEY,
  videomodel: 'google/gemini-2.5-flash-lite',
};

const qwenCloudConfig = {
  apiUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
  apiKey: process.env.QWENCLOUD_API_KEY,
  imagemodel: 'qwen3.7-flash',
};
```

Notes:

- QwenCloud model id has no `qwen/` prefix (`qwen3.7-flash`, not `qwen/qwen3.7-flash`).
- Endpoint is DashScope compatible-mode chat completions (intl).

### Route wiring

**Before:** both routes passed `openRouterConfig`.

**After (working):**

```javascript
app.post('/scan-video', authenticateUser,
  requestLimit({ maxRequests: 5, windowMs: 60_000 }),
  logRequestOrigin,
  (req, res) => handleScanVideo(req, res, supabase, openRouterConfig, helpers, queueManager)
);

app.post('/scan-image', authenticateUser,
  requestLimit({ maxRequests: 7, windowMs: 60_000 }),
  logRequestOrigin,
  (req, res) => handleScanImage(req, res, supabase, qwenCloudConfig, helpers, queueManager)
);
```

Auth, CORS, queue, rate limits, checkout: unchanged.

---

## 2. `routes/scanImage.js`

**Before:**

```javascript
async function handleScanImage(req, res, supabase, openRouterConfig, helpers, queueManager) {
  // ...
  const result = await helpers.analyzeImageWithAI(imageData, policy, openRouterConfig);
```

**After (working):**

```javascript
async function handleScanImage(req, res, supabase, qwenCloudConfig, helpers, queueManager) {
  // ...
  const result = await helpers.analyzeImageWithAI(imageData, policy, qwenCloudConfig);
```

Auth, profile lock, rate limit, queue, deduction, `logScan`: unchanged.

---

## 3. `helpers.js`

This is the actual request swap. Four pieces all have to be present.

### 3a. `isRateLimitError`

Extended so QwenCloud HTTP 429 / DashScope throttle codes retry the same way OpenRouter embedded 429s did.

```javascript
function isRateLimitError(err, httpStatus) {
  if (httpStatus === 429) return true;
  if (err?.code === 429 || err?.metadata?.error_type === 'rate_limit_exceeded') return true;
  const code = String(err?.code || '');
  const message = String(err?.message || '').toLowerCase();
  return /throttling|limit_requests|limit_burst_rate|insufficient_quota/i.test(code)
    || message.includes('rate limit')
    || message.includes('throttling')
    || message.includes('too many requests');
}
```

### 3b. `fetchOpenRouterCompletion` — KEEP for video

Unchanged from the original. Video still uses it. Headers still include `X-Title: Redacted`.

Must remain as `async function fetchOpenRouterCompletion(...)`.

`analyzeWithAI` still calls:

```javascript
const aiData = await fetchOpenRouterCompletion(requestBody, openRouterConfig, 'video scan');
```

Video request body is unchanged:

```javascript
{
  model: openRouterConfig.videomodel,
  messages: [system, { role: 'user', content }],
  temperature: 0,
  max_tokens: 8000,
  reasoning: { effort: 'none' }
}
```

### 3c. `fetchQwenCloudCompletion` — ADD for images

New function. Do not replace (3b) with this.

- URL / key come from `qwenCloudConfig`
- No `X-Title` header (OpenRouter-only)
- Retries HTTP 429 once after 1500ms (QwenCloud returns real 429s)
- Error strings say `QwenCloud`

### 3d. `analyzeImageWithAI` — the migrated request

Third argument **must** be named `qwenCloudConfig`.

**Before (OpenRouter):**

```javascript
{
  model: openRouterConfig.imagemodel, // qwen/qwen3.7-flash
  messages: [system, { role: 'user', content: [text, image_url] }],
  temperature: 0,
  max_tokens: 2000,
  reasoning: { effort: 'none' }
}
// then: fetchOpenRouterCompletion(requestBody, openRouterConfig, 'image scan')
```

**After (working QwenCloud):**

```javascript
async function analyzeImageWithAI(imageData, policy, qwenCloudConfig) {
  const prompt = buildImageAnalysisPrompt(policy);
  const base64Data = imageData.includes(',') ? imageData.split(',')[1] : imageData;

  const content = [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64Data}` } }
  ];

  const requestBody = {
    model: qwenCloudConfig.imagemodel,
    messages: [
      {
        role: 'system',
        content: 'You are a strict advertising policy compliance analyst. Your role is to analyze media content against platform-specific advertising policies and identify violations. Always respond with valid JSON only. Be consistent, thorough, and objective in your analysis. Do not hallucinate violations - only flag genuine policy breaches based on what you can observe in the content.'
      },
      { role: 'user', content: content }
    ],
    temperature: 0,
    max_tokens: 2000,
    enable_thinking: false,
    max_input_tokens: 32000
  };

  const aiData = await fetchQwenCloudCompletion(requestBody, qwenCloudConfig, 'image scan');
  const aiResponse = aiData.choices?.[0]?.message?.content;
  if (!aiResponse) throw new Error('No response given');
  return parseAIResponse(aiResponse, policy.platform);
}
```

Carried over from OpenRouter: system prompt, user content (`text` + JPEG data URI), `temperature: 0`, `max_tokens: 2000`, non-streaming.

### 3e. `module.exports`

Must list **both** fetch helpers:

```javascript
module.exports = {
  optimizeFramePayload,
  loadPlatformPolicy,
  buildAnalysisPrompt,
  buildImageAnalysisPrompt,
  parseAIResponse,
  inferMissingEventIds,
  mergeOverlappingViolations,
  fetchOpenRouterCompletion,
  fetchQwenCloudCompletion,
  analyzeWithAI,
  analyzeImageWithAI,
  logScan
};
```

---

## Request field mapping (image only)

| OpenRouter | QwenCloud |
|---|---|
| `https://openrouter.ai/api/v1/chat/completions` | `https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions` |
| `OPENROUTER_KEY` | `QWENCLOUD_API_KEY` |
| `qwen/qwen3.7-flash` | `qwen3.7-flash` |
| `reasoning: { effort: "none" }` | `enable_thinking: false` |
| *(none)* | `max_input_tokens: 32000` |
| `X-Title: Redacted` | omit |

---

## What we did **not** change

- `buildImageAnalysisPrompt` / `buildAnalysisPrompt`
- `parseAIResponse`, eventId infer/merge
- Video path (`analyzeWithAI`, `scanVideo.js`, OpenRouter + Gemini)
- Queue, abuse detection, CORS, checkout, rate limiter

---

## Pitfalls that actually broke the VPS

These are the three errors we hit, in order. All were copy mistakes, not API failures.

### 1. `ReferenceError: fetchOpenRouterCompletion is not defined` at `helpers.js` load (`server.js` require)

**Cause:** `fetchOpenRouterCompletion` was renamed in place to `fetchQwenCloudCompletion`, but `module.exports` still listed the old name.

**Fix:** keep both functions. Add QwenCloud; do not replace OpenRouter.

### 2. `ReferenceError: qwenCloudConfig is not defined` at `analyzeImageWithAI`

**Cause:** function body used `qwenCloudConfig.imagemodel` but the third parameter was still `openRouterConfig` (or missing). Same name must exist in all three places: defined in `server.js`, accepted by `handleScanImage`, accepted by `analyzeImageWithAI`.

**Fix:**

```javascript
const qwenCloudConfig = { ... };                          // server.js
handleScanImage(..., qwenCloudConfig, helpers, ...)       // server.js route
async function handleScanImage(..., qwenCloudConfig, ...) // scanImage.js
analyzeImageWithAI(imageData, policy, qwenCloudConfig)    // scanImage.js call
async function analyzeImageWithAI(imageData, policy, qwenCloudConfig) // helpers.js
```

### 3. `ReferenceError: fetchOpenRouterCompletion is not defined` at `analyzeWithAI` (video scan)

**Cause:** same as (1), but now at call time. Image worked (QwenCloud fetch existed). Video still called the deleted OpenRouter fetch.

**Fix:** paste `async function fetchOpenRouterCompletion` back above `analyzeWithAI`. Confirm all four of these exist:

| Search in `helpers.js` | Required |
|---|---|
| `async function fetchOpenRouterCompletion` | yes — video |
| `async function fetchQwenCloudCompletion` | yes — image |
| `fetchOpenRouterCompletion(requestBody, openRouterConfig, 'video scan')` | inside `analyzeWithAI` |
| `fetchQwenCloudCompletion(requestBody, qwenCloudConfig, 'image scan')` | inside `analyzeImageWithAI` |

---

## Sanity check after a restart

1. `node -e "require('./helpers')"` from the API root — must not throw.
2. Image scan → QwenCloud (`enable_thinking: false`, 32k input cap).
3. Video scan → OpenRouter (`reasoning: { effort: 'none' }`).
