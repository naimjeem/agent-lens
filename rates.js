function rate(envKey, def) {
  const v = process.env[envKey];
  if (v == null || v === "") return def / 1e6;
  const n = parseFloat(v);
  return (Number.isFinite(n) ? n : def) / 1e6;
}

const PER_AGENT = {
  claude: {
    input: rate("RATE_INPUT", 5.0),
    output: rate("RATE_OUTPUT", 25.0),
    cacheRead: rate("RATE_CACHE_READ", 0.5),
    cacheCreate: rate("RATE_CACHE_CREATE", 6.25),
    label: "Bedrock ap-southeast-2 defaults; override with RATE_INPUT/RATE_OUTPUT/RATE_CACHE_READ/RATE_CACHE_CREATE",
  },
  codex: {
    input: rate("RATE_CODEX_INPUT", 1.25),
    output: rate("RATE_CODEX_OUTPUT", 10.0),
    cacheRead: rate("RATE_CODEX_CACHE_READ", 0.125),
    cacheCreate: rate("RATE_CODEX_CACHE_CREATE", 0),
    label: "OpenAI gpt-5/o-series approximation; override with RATE_CODEX_*",
  },
  gemini: {
    input: rate("RATE_GEMINI_INPUT", 1.25),
    output: rate("RATE_GEMINI_OUTPUT", 10.0),
    cacheRead: rate("RATE_GEMINI_CACHE_READ", 0.31),
    cacheCreate: rate("RATE_GEMINI_CACHE_CREATE", 0),
    label: "Gemini 2.5 Pro approximation; override with RATE_GEMINI_*",
  },
  opencode: {
    input: rate("RATE_OPENCODE_INPUT", 3.0),
    output: rate("RATE_OPENCODE_OUTPUT", 15.0),
    cacheRead: rate("RATE_OPENCODE_CACHE_READ", 0.3),
    cacheCreate: rate("RATE_OPENCODE_CACHE_CREATE", 3.75),
    label: "OpenCode multi-provider; uses message.cost when present, otherwise RATE_OPENCODE_*",
  },
  kimi: {
    input: rate("RATE_KIMI_INPUT", 0.55),
    output: rate("RATE_KIMI_OUTPUT", 2.20),
    cacheRead: rate("RATE_KIMI_CACHE_READ", 0.15),
    cacheCreate: rate("RATE_KIMI_CACHE_CREATE", 0),
    label: "Kimi K2 approximation; override with RATE_KIMI_*",
  },
  cursor: {
    input: rate("RATE_CURSOR_INPUT", 0),
    output: rate("RATE_CURSOR_OUTPUT", 0),
    cacheRead: rate("RATE_CURSOR_CACHE_READ", 0),
    cacheCreate: rate("RATE_CURSOR_CACHE_CREATE", 0),
    label: "Cursor stores chats as opaque blobs — token usage not derivable",
  },
  antigravity: {
    input: rate("RATE_ANTIGRAVITY_INPUT", 0),
    output: rate("RATE_ANTIGRAVITY_OUTPUT", 0),
    cacheRead: rate("RATE_ANTIGRAVITY_CACHE_READ", 0),
    cacheCreate: rate("RATE_ANTIGRAVITY_CACHE_CREATE", 0),
    label: "Antigravity stores conversations as protobuf — token usage not derivable",
  },
  copilot: {
    input: rate("RATE_COPILOT_INPUT", 0),
    output: rate("RATE_COPILOT_OUTPUT", 0),
    cacheRead: rate("RATE_COPILOT_CACHE_READ", 0),
    cacheCreate: rate("RATE_COPILOT_CACHE_CREATE", 0),
    label: "GitHub Copilot bills via subscription; chat session JSON has no per-request token counts",
  },
};

function rateFor(agent) {
  return PER_AGENT[agent] || PER_AGENT.claude;
}

function costFor(agent, tokens) {
  const r = rateFor(agent);
  return (
    (tokens.input || 0) * r.input +
    (tokens.output || 0) * r.output +
    (tokens.cacheRead || 0) * r.cacheRead +
    (tokens.cacheCreate || 0) * r.cacheCreate
  );
}

module.exports = { PER_AGENT, rateFor, costFor };
