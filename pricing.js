const ENDPOINT = process.env.OPENROUTER_MODELS_URL || "https://openrouter.ai/api/v1/models";
const TTL_MS = parseInt(
  process.env.OPENROUTER_PRICING_TTL_MS || String(6 * 60 * 60 * 1000),
  10,
);
const ENABLED = process.env.DISABLE_OPENROUTER_PRICING !== "1";

const state = {
  byId: new Map(),
  ts: 0,
  fetching: null,
  lastError: null,
};

function num(v) {
  if (v == null) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function normalize(model) {
  const p = model.pricing || {};
  return {
    input: num(p.prompt),
    output: num(p.completion),
    cacheRead: num(p.input_cache_read),
    cacheCreate: num(p.input_cache_write),
  };
}

async function fetchPricing() {
  if (typeof fetch !== "function") {
    throw new Error("global fetch unavailable; requires Node >=18");
  }
  const res = await fetch(ENDPOINT, {
    headers: { "user-agent": "agent-lens/2" },
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}`);
  const json = await res.json();
  const byId = new Map();
  for (const m of json.data || []) {
    if (!m || !m.id) continue;
    byId.set(m.id, normalize(m));
  }
  state.byId = byId;
  state.ts = Date.now();
  state.lastError = null;
  return byId;
}

function refreshIfStale() {
  if (!ENABLED) return null;
  if (state.fetching) return state.fetching;
  const fresh = state.byId.size > 0 && Date.now() - state.ts < TTL_MS;
  if (fresh) return Promise.resolve(state.byId);
  state.fetching = fetchPricing()
    .catch((err) => {
      state.lastError = err.message;
      console.warn(`[openrouter pricing] fetch failed: ${err.message}`);
      return state.byId.size ? state.byId : null;
    })
    .finally(() => {
      state.fetching = null;
    });
  return state.fetching;
}

const AGENT_PROVIDER = {
  claude: "anthropic",
  codex: "openai",
  gemini: "google",
  kimi: "moonshotai",
};

function slugify(model) {
  if (!model) return "";
  let s = String(model).toLowerCase().trim();
  s = s.replace(/@.*$/, "");
  s = s.replace(/-(\d{8}|\d{4}-\d{2}-\d{2})$/, "");
  s = s.replace(/-(latest|preview|exp)$/, "");
  return s;
}

function lookup(agent, model) {
  if (!ENABLED || !model || state.byId.size === 0) return null;
  if (state.byId.has(model)) return state.byId.get(model);

  const slug = slugify(model);
  if (model.includes("/")) {
    const slugged = slugify(model);
    if (state.byId.has(slugged)) return state.byId.get(slugged);
  } else {
    const provider = AGENT_PROVIDER[agent];
    if (provider) {
      const id = `${provider}/${slug}`;
      if (state.byId.has(id)) return state.byId.get(id);
    }
  }

  const provider = AGENT_PROVIDER[agent];
  let best = null;
  let bestLen = -1;
  for (const [id, p] of state.byId) {
    if (provider && !id.startsWith(provider + "/")) continue;
    const tail = id.split("/").pop();
    if (tail === slug) return p;
    if (tail.startsWith(slug) || slug.startsWith(tail)) {
      const overlap = Math.min(tail.length, slug.length);
      if (overlap > bestLen) {
        best = p;
        bestLen = overlap;
      }
    }
  }
  return best;
}

function priceFor(agent, model) {
  refreshIfStale();
  return lookup(agent, model);
}

function snapshot() {
  const out = {};
  for (const [id, p] of state.byId) {
    out[id] = {
      input: p.input * 1e6,
      output: p.output * 1e6,
      cacheRead: p.cacheRead * 1e6,
      cacheCreate: p.cacheCreate * 1e6,
    };
  }
  return {
    enabled: ENABLED,
    fetchedAt: state.ts ? new Date(state.ts).toISOString() : null,
    ttlMs: TTL_MS,
    count: state.byId.size,
    error: state.lastError,
    models: out,
  };
}

module.exports = { priceFor, refreshIfStale, snapshot };
