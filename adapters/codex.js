const fs = require("fs");
const os = require("os");
const path = require("path");
const { findFiles, streamJsonl } = require("./util");

const NAME = "codex";
const DISPLAY = "Codex CLI";
const DEFAULT_DIR = path.join(os.homedir(), ".codex");

function dataDir() {
  return process.env.CODEX_DIR || DEFAULT_DIR;
}

function enabled() {
  return fs.existsSync(path.join(dataDir(), "sessions"));
}

async function getEvents(emit) {
  const sessionsDir = path.join(dataDir(), "sessions");
  if (!fs.existsSync(sessionsDir)) return;

  const files = findFiles(sessionsDir, ".jsonl");
  for (const file of files) {
    let sessionId = "";
    let project = "unknown";
    let model = null;
    let lastTotalUsage = { input: 0, cached: 0, output: 0, reasoning: 0 };

    await streamJsonl(file, (obj) => {
      const ts = obj.timestamp;
      const t = obj.type;
      const p = obj.payload;
      if (!t || !p) return;

      if (t === "session_meta") {
        sessionId = (p.id || "").toString();
        project = p.cwd || "unknown";
        return;
      }

      if (t === "turn_context") {
        if (p.model) model = p.model;
        return;
      }

      if (t === "event_msg") {
        const pt = p.type;

        if (pt === "user_message") {
          emit({
            agent: NAME,
            timestamp: ts,
            sessionId,
            project,
            type: "user",
            prompt: (p.message || "").toString().slice(0, 2000),
          });
          return;
        }

        if (pt === "token_count" && p.info && p.info.last_token_usage) {
          const cur = p.info.last_token_usage;
          const totalInput = cur.input_tokens || 0;
          const cached = cur.cached_input_tokens || 0;
          const out = cur.output_tokens || 0;
          const reasoning = cur.reasoning_output_tokens || 0;

          const tokens = {
            input: Math.max(0, totalInput - cached),
            output: out + reasoning,
            cacheRead: cached,
            cacheCreate: 0,
            reasoning,
          };

          emit({
            agent: NAME,
            timestamp: ts,
            sessionId,
            project,
            type: "assistant",
            model,
            tokens,
          });
          return;
        }
      }

      if (t === "response_item") {
        const pt = p.type;
        if (pt === "function_call") {
          let input = {};
          try {
            input = p.arguments ? JSON.parse(p.arguments) : {};
          } catch {
            input = { raw: p.arguments };
          }
          emit({
            agent: NAME,
            timestamp: ts,
            sessionId,
            project,
            type: "tool",
            toolCall: { name: p.name || "function_call", input },
          });
        }
      }
    });

    void lastTotalUsage;
  }
}

module.exports = { name: NAME, displayName: DISPLAY, dataDir, enabled, getEvents };
