const claude = require("./claude");
const codex = require("./codex");
const gemini = require("./gemini");
const opencode = require("./opencode");
const kimi = require("./kimi");
const cursor = require("./cursor");
const antigravity = require("./antigravity");
const copilot = require("./copilot");

const ADAPTERS = [claude, codex, gemini, opencode, kimi, cursor, antigravity, copilot];

function getAdapter(name) {
  return ADAPTERS.find((a) => a.name === name);
}

function listAdapters() {
  return ADAPTERS.map((a) => ({
    name: a.name,
    displayName: a.displayName,
    enabled: a.enabled(),
    dataDir: a.dataDir(),
  }));
}

async function collectEvents(filterAgent) {
  const events = [];
  const targets = filterAgent
    ? ADAPTERS.filter((a) => a.name === filterAgent)
    : ADAPTERS;

  for (const adapter of targets) {
    if (!adapter.enabled()) continue;
    try {
      await adapter.getEvents((e) => events.push(e));
    } catch (err) {
      console.warn(`[${adapter.name}] error collecting events: ${err.message}`);
    }
  }
  return events;
}

module.exports = { ADAPTERS, getAdapter, listAdapters, collectEvents };
