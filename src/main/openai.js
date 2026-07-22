// Multi-provider AI backend. Supports:
//   - OpenAI via the GatherOS proxy (server-proxied, requires session)
//   - OpenAI direct (BYOK — user's own API key)
//   - Gemini via Google Generative Language API (BYOK)
//
// Each public helper routes through the active provider. When a local
// API key is configured, calls go directly to the provider; otherwise
// they fall back to the proxy (if a licensing session exists).

const fs = require('node:fs');
const { API_BASE_URL } = require('../shared/licensing-config');
const { getSessionToken } = require('./licensing');
const { getPref } = require('./settings');

// ── Provider helpers ──────────────────────────────────────────

function getProvider() {
  return getPref('aiProvider', 'openai');
}

function getLocalApiKey() {
  const provider = getProvider();
  if (provider === 'gemini') return getPref('geminiApiKey', null) || null;
  return getPref('openAIApiKey', null) || null;
}

function getGeminiTextModels() {
  return {
    primary: getPref('geminiVisionModel', 'gemini-2.0-flash'),
    fallback: getPref('geminiFallbackModel', 'gemini-2.0-flash-lite'),
    secondFallback: getPref('geminiSecondFallbackModel', null) || null,
  };
}

// True when we can make AI calls — either a proxy session or a local key.
function hasSession() {
  return !!getSessionToken() || !!getLocalApiKey();
}

// ── Timeout / abort helper ────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 60_000;

function timedFetch(url, opts, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...opts, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

// ── OpenAI proxy (server-proxied) ─────────────────────────────

async function postProxy(path, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const token = getSessionToken();
  if (!token) {
    const err = new Error('Not signed in');
    err.code = 'unauthenticated';
    throw err;
  }
  let res;
  try {
    res = await timedFetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    }, timeoutMs);
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`AI proxy timed out after ${Math.round(timeoutMs / 1000)}s`);
      e.code = 'timeout';
      throw e;
    }
    const e = new Error(`AI proxy network error: ${err.message}`);
    e.code = 'network';
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    const reason = data.error || `http_${res.status}`;
    const err = new Error(`AI proxy ${reason}${data.detail ? `: ${data.detail}` : ''}`);
    err.code = reason;
    throw err;
  }
  return data;
}

// ── OpenAI direct (BYOK) ─────────────────────────────────────

async function postOpenAI(apiKey, path, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let res;
  try {
    res = await timedFetch(`https://api.openai.com${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    }, timeoutMs);
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`OpenAI timed out after ${Math.round(timeoutMs / 1000)}s`);
      e.code = 'timeout';
      throw e;
    }
    const e = new Error(`OpenAI network error: ${err.message}`);
    e.code = 'network';
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.message || `http_${res.status}`;
    const err = new Error(`OpenAI ${reason}`);
    err.code = data?.error?.code || `http_${res.status}`;
    throw err;
  }
  return data;
}

// ── Gemini direct (BYOK) ─────────────────────────────────────

async function postGemini(apiKey, model, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  let res;
  try {
    res = await timedFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }, timeoutMs);
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error(`Gemini timed out after ${Math.round(timeoutMs / 1000)}s`);
      e.code = 'timeout';
      throw e;
    }
    const e = new Error(`Gemini network error: ${err.message}`);
    e.code = 'network';
    throw e;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = data?.error?.message || `http_${res.status}`;
    const err = new Error(`Gemini ${reason}`);
    err.code = data?.error?.status || `http_${res.status}`;
    throw err;
  }
  return data;
}

// ── Gemini text generation with 3-model fallback ──────────────

async function generateGeminiText(parts, { responseMimeType, maxOutputTokens, timeoutMs } = {}) {
  const apiKey = getLocalApiKey();
  if (!apiKey) throw new Error('No Gemini API key configured');

  const models = getGeminiTextModels();
  const candidates = [models.primary, models.fallback, models.secondFallback].filter(Boolean);

  const body = {
    contents: [{ parts }],
    generationConfig: {},
  };
  if (responseMimeType) body.generationConfig.responseMimeType = responseMimeType;
  if (maxOutputTokens) body.generationConfig.maxOutputTokens = maxOutputTokens;

  let lastError = null;
  for (const model of candidates) {
    try {
      const data = await postGemini(apiKey, model, body, { timeoutMs });
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty Gemini response');
      return text;
    } catch (err) {
      lastError = err;
      // Only retry on retryable errors (429, 503, timeouts, networks)
      if (err.code === 'timeout' || err.code === 'network'
        || /429|503|rate|unavailable/i.test(String(err.code || err.message))) {
        continue;
      }
      throw err;
    }
  }
  throw lastError || new Error('All Gemini models failed');
}

// ── JSON parsing helper ───────────────────────────────────────

function parseJsonResponse(text) {
  if (!text) throw new Error('Empty response');
  // Try direct parse first
  try { return JSON.parse(text); } catch { /* continue */ }
  // Strip markdown code fences
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  }
  // Find first { ... } or [ ... ]
  const braceMatch = text.match(/(\{[\s\S]*\})/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[1]); } catch { /* continue */ }
  }
  throw new Error('Could not parse JSON from AI response');
}

// ── Image preprocessing ───────────────────────────────────────

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

// ── Provider-aware chat routing ───────────────────────────────

async function chat({ messages, model, responseFormat, maxTokens }) {
  const provider = getProvider();
  const localKey = getLocalApiKey();

  // Gemini BYOK path
  if (provider === 'gemini' && localKey) {
    const geminiModel = model || getGeminiTextModels().primary;
    // Convert OpenAI message format to Gemini parts
    const parts = [];
    for (const msg of messages) {
      if (typeof msg.content === 'string') {
        parts.push({ text: msg.content });
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.type === 'text') {
            parts.push({ text: part.text });
          } else if (part.type === 'image_url') {
            const dataUrl = part.image_url?.url || '';
            const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
            if (match) {
              parts.push({ inlineData: { mimeType: match[1], data: match[2] } });
            }
          }
        }
      }
    }
    const responseMimeType = responseFormat?.type === 'json_object'
      ? 'application/json' : undefined;
    const text = await generateGeminiText(parts, {
      responseMimeType,
      maxOutputTokens: maxTokens,
    });
    return text;
  }

  // OpenAI BYOK path
  if (localKey && provider === 'openai') {
    const body = { model: model || 'gpt-4o-mini', messages };
    if (responseFormat) body.response_format = responseFormat;
    if (maxTokens) body.max_tokens = maxTokens;
    const data = await postOpenAI(localKey, '/v1/chat/completions', body);
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('No content in OpenAI response');
    return content;
  }

  // Proxy path (server-proxied OpenAI)
  const body = { model: model || 'gpt-4o-mini', messages };
  if (responseFormat) body.response_format = responseFormat;
  if (maxTokens) body.max_tokens = maxTokens;
  const data = await postProxy('/ai/chat', body);
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('No content in proxy response');
  return content;
}

// ── Vision + tagging ──────────────────────────────────────────

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
    maxTokens: 280,
  });
  const parsed = parseJsonResponse(content);
  const prompt = typeof parsed.prompt === 'string'
    ? parsed.prompt.trim().replace(/^["'`]+|["'`]+$/g, '')
    : '';
  return prompt || null;
}

// ── Embedding ─────────────────────────────────────────────────

async function embedText(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) throw new Error('Cannot embed empty text');

  const provider = getProvider();
  const localKey = getLocalApiKey();

  // Gemini BYOK path
  if (provider === 'gemini' && localKey) {
    const model = 'text-embedding-004';
    const data = await postGemini(localKey, model, {
      content: { parts: [{ text: trimmed.slice(0, 8000) }] },
    });
    const vec = data?.embedding?.values;
    if (!Array.isArray(vec)) throw new Error('No embedding in Gemini response');
    return vec;
  }

  // OpenAI BYOK path
  if (localKey && provider === 'openai') {
    const data = await postOpenAI(localKey, '/v1/embeddings', {
      model: 'text-embedding-3-small',
      input: trimmed.slice(0, 8000),
    });
    const vec = data?.data?.[0]?.embedding;
    if (!Array.isArray(vec)) throw new Error('No embedding in OpenAI response');
    return vec;
  }

  // Proxy path
  const data = await postProxy('/ai/embed', {
    input: trimmed.slice(0, 8000),
  });
  const vec = data.data?.[0]?.embedding;
  if (!Array.isArray(vec)) throw new Error('No embedding in proxy response');
  return vec;
}

// ── Usage / quota ─────────────────────────────────────────────

async function getUsage() {
  // BYOK users don't have proxy quotas
  const localKey = getLocalApiKey();
  if (localKey) {
    return {
      ok: true,
      total_tokens: 0,
      soft_cap: 0,
      over_cap: false,
      request_count: 0,
    };
  }

  const token = getSessionToken();
  if (!token) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(`${API_BASE_URL}/ai/usage`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) return null;
    return data;
  } catch (err) {
    console.error('[ai] getUsage failed:', err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ── Model test ────────────────────────────────────────────────

async function testTextModel() {
  const start = Date.now();
  const provider = getProvider();
  const localKey = getLocalApiKey();

  try {
    if (provider === 'gemini' && localKey) {
      const models = getGeminiTextModels();
      await generateGeminiText([{ text: 'Say "ok" and nothing else.' }], {
        maxOutputTokens: 10,
      });
      return { ok: true, model: models.primary, latency: Date.now() - start };
    }

    if (localKey && provider === 'openai') {
      await postOpenAI(localKey, '/v1/chat/completions', {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
        max_tokens: 10,
      });
      return { ok: true, model: 'gpt-4o-mini', latency: Date.now() - start };
    }

    // Proxy path
    await postProxy('/ai/chat', {
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "ok" and nothing else.' }],
      max_tokens: 10,
    });
    return { ok: true, model: 'gpt-4o-mini (proxy)', latency: Date.now() - start };
  } catch (err) {
    return { ok: false, error: err.message, model: provider, latency: Date.now() - start };
  }
}

module.exports = {
  hasSession,
  getProvider,
  getLocalApiKey,
  getGeminiTextModels,
  autoTagImage,
  analyzeImage,
  generateImagePrompt,
  embedText,
  getUsage,
  testTextModel,
  parseJsonResponse,
};
