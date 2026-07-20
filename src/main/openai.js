// AI client. Hosted accounts use the GatherOS OpenAI proxy; personal keys can
// use either OpenAI or Gemini directly.
//
// Each public helper signs the request with the current session token
// (read on demand from licensing.js) and unwraps the proxy envelope
// before returning the OpenAI-shaped body the rest of the app expects.

const fs = require('node:fs');
const { API_BASE_URL } = require('../shared/licensing-config');
const { getSessionToken } = require('./licensing');
const OPENAI_BASE = 'https://api.openai.com/v1';
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_VISION_MODEL = 'gemini-3.1-flash-lite';
const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';

function getProvider() {
  try { return require('./settings').getPref('aiProvider', 'openai') === 'gemini' ? 'gemini' : 'openai'; }
  catch { return 'openai'; }
}

function getGeminiTextModels() {
  try {
    const settings = require('./settings');
    return [
      settings.getPref('geminiVisionModel', DEFAULT_GEMINI_VISION_MODEL),
      settings.getPref('geminiFallbackModel', 'gemini-3.5-flash'),
      settings.getPref('geminiSecondFallbackModel', 'gemini-2.5-flash'),
    ].filter((model, index, all) => typeof model === 'string' && model.trim() && all.indexOf(model) === index);
  } catch {
    return [DEFAULT_GEMINI_VISION_MODEL];
  }
}

function getGeminiImageModel() {
  try { return require('./settings').getPref('geminiImageModel', DEFAULT_GEMINI_IMAGE_MODEL); }
  catch { return DEFAULT_GEMINI_IMAGE_MODEL; }
}

function getLocalApiKey() {
  const isGemini = getProvider() === 'gemini';
  const envKey = isGemini
    ? (process.env.GATHEROS_GEMINI_API_KEY || process.env.GEMINI_API_KEY)
    : (process.env.GATHEROS_OPENAI_API_KEY || process.env.OPENAI_API_KEY);
  if (typeof envKey === 'string' && envKey.trim()) return envKey.trim();
  try {
    const settings = require('./settings');
    const prefKey = settings.getPref(isGemini ? 'geminiApiKey' : 'openAIApiKey', '');
    if (typeof prefKey === 'string' && prefKey.trim()) return prefKey.trim();
  } catch {
    // no-op
  }
  return null;
}

// Public so callers can short-circuit feature toggles without making
// a network round-trip when the user isn't signed in yet.
function hasSession() {
  return !!getLocalApiKey() || (getProvider() === 'openai' && !!getSessionToken());
}

async function postProxy(path, body) {
  const token = getSessionToken();
  if (!token) {
    const err = new Error('Not signed in');
    err.code = 'unauthenticated';
    throw err;
  }
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: ['Bearer', token].join(' '),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const reason = data.error || `http_${res.status}`;
    const err = new Error(`AI proxy ${reason}${data.detail ? `: ${data.detail}` : ''}`);
    err.code = reason;
    throw err;
  }
  return data;
}

async function postOpenAI(path, body, apiKey) {
  const res = await fetch(`${OPENAI_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: ['Bearer', apiKey].join(' '),
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.code || data?.error?.type || `http_${res.status}`;
    const err = new Error(`OpenAI ${reason}${data?.error?.message ? `: ${data.error.message}` : ''}`);
    err.code = reason;
    throw err;
  }
  return data;
}

async function postGemini(path, body, apiKey) {
  const res = await fetch(`${GEMINI_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.status || `http_${res.status}`;
    const err = new Error(`Gemini ${reason}${data?.error?.message ? `: ${data.error.message}` : ''}`);
    err.code = reason;
    err.httpStatus = res.status;
    throw err;
  }
  return data;
}

function isRetryableGeminiError(err) {
  return ['RESOURCE_EXHAUSTED', 'UNAVAILABLE', 'INTERNAL'].includes(err?.code)
    || Number(err?.httpStatus) >= 500;
}

async function generateGeminiText(body, apiKey) {
  const models = getGeminiTextModels();
  let lastError;
  for (let i = 0; i < models.length; i += 1) {
    try {
      return await postGemini(`/models/${models[i]}:generateContent`, body, apiKey);
    } catch (err) {
      lastError = err;
      if (!isRetryableGeminiError(err)) throw err;
      if (i === models.length - 1) break;
      console.warn(`[ai] Gemini model ${models[i]} unavailable; trying fallback ${models[i + 1]}`);
    }
  }
  throw new Error(`All configured Gemini text models failed (${models.join(', ')}): ${lastError?.message || 'unknown error'}`);
}

// ── Image preprocessing helpers ────────────────────────────────────

async function imageToDataUrl(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Image file not found');
  }
  const sharp = require('sharp');
  const resized = await sharp(filePath)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return `data:image/jpeg;base64,${resized.toString('base64')}`;
}

// ── Chat / vision helpers ──────────────────────────────────────────

// Gemini normally honors responseMimeType, but it can still surround a JSON
// object with a Markdown fence. Keep the application-level contract strict
// while accepting that harmless presentation wrapper from either provider.
function parseJsonResponse(content) {
  const cleaned = String(content || '')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try { return JSON.parse(cleaned); }
  catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(cleaned.slice(start, end + 1)); }
      catch { /* fall through to the standard error */ }
    }
    throw new Error('AI response was not valid JSON');
  }
}

async function chat({ messages, model = 'gpt-4o-mini', responseFormat, responseSchema, maxTokens }) {
  const localKey = getLocalApiKey();
  if (localKey && getProvider() === 'gemini') {
    const system = messages.find((message) => message.role === 'system')?.content;
    const user = messages.find((message) => message.role === 'user')?.content;
    const parts = (Array.isArray(user) ? user : [{ type: 'text', text: user }]).map((part) => {
      if (part.type === 'image_url') {
        const match = /^data:([^;]+);base64,(.+)$/.exec(part.image_url?.url || '');
        if (!match) throw new Error('Gemini requires an inline base64 image');
        return { inline_data: { mime_type: match[1], data: match[2] } };
      }
      return { text: part.text || '' };
    });
    const body = {
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: maxTokens || 1024 },
    };
    if (system) body.system_instruction = { parts: [{ text: system }] };
    if (responseFormat?.type === 'json_object') {
      body.generationConfig.responseMimeType = 'application/json';
      if (responseSchema) body.generationConfig.responseSchema = responseSchema;
    }
    const data = await generateGeminiText(body, localKey);
    const content = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('');
    if (!content) {
      const reason = data.candidates?.[0]?.finishReason || data.promptFeedback?.blockReason;
      throw new Error(`No content in Gemini response${reason ? `: ${reason}` : ''}`);
    }
    return content;
  }
  const body = { model, messages };
  if (responseFormat) body.response_format = responseFormat;
  if (maxTokens) body.max_tokens = maxTokens;
  const data = localKey
    ? await postOpenAI('/chat/completions', body, localKey)
    : await postProxy('/ai/chat', body);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in proxy response');
  return content;
}

async function autoTagImage(filePath) {
  const dataUrl = await imageToDataUrl(filePath);
  const content = await chat({
    messages: [
      {
        role: 'system',
        content:
          'You suggest short, useful tags for visual inspiration. Return JSON only: ' +
          '{"tags": ["tag1", "tag2", ...]}. Provide 3-6 lowercase tags. ' +
          'Use single words or hyphenated phrases. Focus on style, content, ' +
          'mood, or use case. Avoid generic words like "image", "design", "art".',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Tag this image.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        ],
      },
    ],
    responseFormat: { type: 'json_object' },
    responseSchema: {
      type: 'OBJECT',
      properties: { tags: { type: 'ARRAY', items: { type: 'STRING' } } },
      required: ['tags'],
    },
    maxTokens: 120,
  });
  const parsed = parseJsonResponse(content);
  const raw = Array.isArray(parsed.tags) ? parsed.tags : [];
  return raw
    .filter((t) => typeof t === 'string')
    .map((t) => t.trim().toLowerCase().replace(/^#+/, ''))
    .filter(Boolean)
    .slice(0, 6);
}

async function analyzeImage(filePath) {
  const dataUrl = await imageToDataUrl(filePath);
  const content = await chat({
    messages: [
      {
        role: 'system',
        content:
          'You write designer-friendly metadata for visual inspiration. ' +
          'Return JSON: {"title": "...", "description": "...", "text": "..."}. ' +
          'title: 2-6 words, Title Case, capture subject/style/mood. ' +
          'description: ONE sentence packed with concrete searchable nouns ' +
          'and adjectives. Cover (a) every notable object or subject visible ' +
          '(e.g. statue, mountain, person, button, logo, sky, clouds, water, ' +
          'building, chart), (b) the visual style or art movement (e.g. ' +
          'minimalist, brutalist, Renaissance, illustration, photograph, 3D ' +
          'render, vaporwave), (c) the dominant colors, (d) the mood, and ' +
          '(e) the likely use case ("landing page", "poster", "UI screenshot"). ' +
          'Prefer concrete nouns over abstract framing. No quotes, no emoji. ' +
          'text: every word that appears IN the image — UI labels, headlines, ' +
          'body copy, button text, signage, captions. Preserve original wording ' +
          'and capitalization. Separate distinct lines with " | ". Empty string ' +
          'if no text is visible.',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Analyze this image.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        ],
      },
    ],
    responseFormat: { type: 'json_object' },
    responseSchema: {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        description: { type: 'STRING' },
        text: { type: 'STRING' },
      },
      required: ['title', 'description', 'text'],
    },
    maxTokens: 800,
  });
  const parsed = parseJsonResponse(content);

  const title = typeof parsed.title === 'string'
    ? parsed.title.trim().replace(/^["'`]+|["'`]+$/g, '').slice(0, 80)
    : '';
  const description = typeof parsed.description === 'string'
    ? parsed.description.trim().replace(/^["'`]+|["'`]+$/g, '').slice(0, 600)
    : '';
  const text = typeof parsed.text === 'string'
    ? parsed.text.trim().slice(0, 4000)
    : '';
  return {
    title: title || null,
    description: description || null,
    text: text || null,
  };
}

async function generateImagePrompt(filePath) {
  const dataUrl = await imageToDataUrl(filePath);
  const content = await chat({
    messages: [
      {
        role: 'system',
        content:
          'You write image-generation prompts that recreate the visual ' +
          'style and content of a reference image. The prompts are used ' +
          'with Midjourney, DALL-E, Stable Diffusion, and similar tools.\n\n' +
          'Return JSON: {"prompt": "..."}.\n\n' +
          'The prompt must:\n' +
          '- Be a single paragraph, 35-75 words\n' +
          '- Describe subjects, composition, camera framing, lighting, ' +
          'color palette, texture, style/medium, and mood\n' +
          '- Use flowing natural language, not comma-stuffed keyword lists\n' +
          '- Not include tool-specific parameter syntax (--ar, --v, /imagine)\n' +
          '- Not name copyrighted characters, real people, or real brands\n' +
          '- Not start with "An image of" or "A picture of" — describe directly',
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Write a prompt that recreates this image.' },
          { type: 'image_url', image_url: { url: dataUrl, detail: 'low' } },
        ],
      },
    ],
    responseFormat: { type: 'json_object' },
    responseSchema: {
      type: 'OBJECT',
      properties: { prompt: { type: 'STRING' } },
      required: ['prompt'],
    },
    maxTokens: 280,
  });
  const parsed = parseJsonResponse(content);
  const prompt = typeof parsed.prompt === 'string'
    ? parsed.prompt.trim().replace(/^["'`]+|["'`]+$/g, '')
    : '';
  return prompt || null;
}

// ── Embedding ──────────────────────────────────────────────────────

async function embedText(text) {
  const localKey = getLocalApiKey();
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Cannot embed empty text');
  if (localKey && getProvider() === 'gemini') {
    const data = await postGemini('/models/gemini-embedding-2:embedContent', {
      content: { parts: [{ text: trimmed.slice(0, 8000) }] },
    }, localKey);
    const vec = data.embedding?.values;
    if (!Array.isArray(vec)) throw new Error('No embedding in Gemini response');
    return vec;
  }
  const data = localKey
    ? await postOpenAI('/embeddings', {
      model: 'text-embedding-3-small',
      input: trimmed.slice(0, 8000),
    }, localKey)
    : await postProxy('/ai/embed', {
      input: trimmed.slice(0, 8000),
    });
  const vec = data.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('No embedding in proxy response');
  return vec;
}

// ── Usage / quota ──────────────────────────────────────────────────

async function getUsage() {
  const localKey = getLocalApiKey();
  if (localKey) {
    return {
      ok: true,
      byok: true,
      total_tokens: 0,
      soft_cap: 0,
      over_cap: false,
      request_count: 0,
      image_count: 0,
      image_soft_cap: 0,
      image_over_cap: false,
    };
  }
  const token = getSessionToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/ai/usage`, {
      headers: { Authorization: ['Bearer', token].join(' ') },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return null;
    return data;
  } catch (err) {
    console.error('[ai] getUsage failed:', err);
    return null;
  }
}

// Resize a save's image to a server-friendly size and return raw
// base64 (no data-url prefix). Used to seed image-edit calls so
// the variant model sees the actual source pixels rather than just
// a text description. Capped at 1024×1024 since that's the output
// resolution anyway — anything larger is wasted bandwidth.
async function imageToBase64(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error('Image file not found');
  }
  const sharp = require('sharp');
  const buf = await sharp(filePath)
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return buf.toString('base64');
}

// Generate an image. If `sourceFilePath` is provided, the worker
// routes to /v1/images/edits with the source as a reference — the
// result is a true variation that preserves composition, palette,
// and subject. Without a source, falls back to text-to-image
// generation (used only by callers that genuinely have no image).
//
// `size` selects the output aspect ratio — the worker validates it
// against gpt-image-1's supported set ('1024x1024', '1536x1024',
// '1024x1536'); model + quality stay locked server-side so the
// per-image cost curve is predictable.
async function generateImage(prompt, { sourceFilePath, size } = {}) {
  const localKey = getLocalApiKey();
  const trimmed = (prompt || '').trim();
  if (!trimmed) throw new Error('Cannot generate from empty prompt');
  let data;
  if (localKey && getProvider() === 'gemini') {
    const parts = [{ text: trimmed.slice(0, 4000) }];
    if (sourceFilePath) {
      parts.unshift({ inline_data: { mime_type: 'image/jpeg', data: await imageToBase64(sourceFilePath) } });
      parts[1].text += '\n\nPreserve the core composition and visual style of the source image.';
    }
    const data = await postGemini(`/models/${getGeminiImageModel()}:generateContent`, {
      contents: [{ role: 'user', parts }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'] },
    }, localKey);
    const image = data.candidates?.[0]?.content?.parts?.find((part) => part.inline_data?.data);
    if (!image) throw new Error('No image in Gemini response');
    return { bytes: Buffer.from(image.inline_data.data, 'base64'), quota: null };
  }
  if (localKey) {
    const body = {
      model: 'gpt-image-1',
      prompt: trimmed.slice(0, 4000),
      size: size || '1024x1024',
    };
    if (sourceFilePath) {
      body.prompt = `${body.prompt}\n\nPreserve the core composition and visual style of the source image.`;
    }
    data = await postOpenAI('/images/generations', body, localKey);
  } else {
    const body = { prompt: trimmed.slice(0, 4000) };
    if (sourceFilePath) {
      body.image_b64 = await imageToBase64(sourceFilePath);
      body.image_mime = 'image/jpeg';
    }
    if (size) body.size = size;
    data = await postProxy('/ai/image', body);
  }
  const b64 = data.image?.b64_json || data.data?.[0]?.b64_json;
  if (!b64) throw new Error('No image in proxy response');
  return {
    bytes: Buffer.from(b64, 'base64'),
    quota: data.quota || null,
  };
}

async function testTextModel() {
  const apiKey = getLocalApiKey();
  if (getProvider() !== 'gemini' || !apiKey) {
    throw new Error('Add a Gemini API key before testing a Gemini model');
  }
  const data = await generateGeminiText({
    contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: OK' }] }],
    generationConfig: { maxOutputTokens: 8 },
  }, apiKey);
  const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('').trim();
  if (!text) throw new Error('Gemini returned no text');
  return { ok: true, model: getGeminiTextModels()[0], text };
}

module.exports = {
  hasSession,
  autoTagImage,
  analyzeImage,
  generateImagePrompt,
  generateImage,
  embedText,
  getUsage,
  testTextModel,
};
