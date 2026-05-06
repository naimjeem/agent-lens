const fs = require("fs");
const os = require("os");
const path = require("path");
const { findFiles, streamJsonl, tsFromUnix } = require("./util");

const NAME = "kimi";
const DISPLAY = "Kimi Code";
const DEFAULT_DIR = path.join(os.homedir(), ".kimi");

function dataDir() {
  return process.env.KIMI_DIR || DEFAULT_DIR;
}

function enabled() {
  return fs.existsSync(path.join(dataDir(), "sessions"));
}

async function getEvents(emit) {
  const sessionsRoot = path.join(dataDir(), "sessions");
  if (!fs.existsSync(sessionsRoot)) return;

  const projects = fs
    .readdirSync(sessionsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const proj of projects) {
    const projPath = path.join(sessionsRoot, proj.name);
    const sessions = fs
      .readdirSync(projPath, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const sess of sessions) {
      const sessionId = sess.name;
      const wirePath = path.join(projPath, sessionId, "wire.jsonl");
      if (!fs.existsSync(wirePath)) continue;

      let model = null;

      await streamJsonl(wirePath, (obj) => {
        if (obj.type === "metadata") return;
        const ts = tsFromUnix(obj.timestamp);
        const m = obj.message;
        if (!m || !ts) return;

        const t = m.type;
        const payload = m.payload || {};

        if (t === "TurnBegin") {
          const inputs = payload.user_input || [];
          const text = inputs
            .map((x) => (x && x.text) || "")
            .filter(Boolean)
            .join(" ");
          emit({
            agent: NAME,
            timestamp: ts,
            sessionId,
            project: proj.name,
            type: "user",
            prompt: text,
          });
        } else if (t === "ModelMetadata" || t === "ModelInfo") {
          if (payload.model) model = payload.model;
        } else if (t === "Usage" || t === "TokenUsage") {
          const u = payload.usage || payload || {};
          emit({
            agent: NAME,
            timestamp: ts,
            sessionId,
            project: proj.name,
            type: "assistant",
            model,
            tokens: {
              input: u.input_tokens || u.prompt_tokens || 0,
              output: u.output_tokens || u.completion_tokens || 0,
              cacheRead: u.cached_tokens || u.cache_read || 0,
              cacheCreate: 0,
            },
          });
        } else if (t === "ToolCall" || t === "FunctionCall") {
          emit({
            agent: NAME,
            timestamp: ts,
            sessionId,
            project: proj.name,
            type: "tool",
            toolCall: { name: payload.name || "tool", input: payload.arguments || payload.args || {} },
          });
        }
      });
    }
  }
}

module.exports = { name: NAME, displayName: DISPLAY, dataDir, enabled, getEvents };
