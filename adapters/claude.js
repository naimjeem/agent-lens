const fs = require("fs");
const os = require("os");
const path = require("path");
const { findFiles, streamJsonl, readJsonSafe } = require("./util");

const NAME = "claude";
const DISPLAY = "Claude Code";
const DEFAULT_DIR = path.join(os.homedir(), ".claude");

function dataDir() {
  return process.env.CLAUDE_DIR || DEFAULT_DIR;
}

function enabled() {
  return fs.existsSync(dataDir());
}

async function getEvents(emit) {
  const root = dataDir();

  const histPath = path.join(root, "history.jsonl");
  if (fs.existsSync(histPath)) {
    const lines = fs.readFileSync(histPath, "utf8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const h = JSON.parse(trimmed);
        const ts =
          typeof h.timestamp === "number"
            ? new Date(h.timestamp).toISOString()
            : h.timestamp;
        if (!ts || !h.display) continue;
        emit({
          agent: NAME,
          timestamp: ts,
          sessionId: h.sessionId || "",
          project: h.project || "unknown",
          type: "user_log",
          prompt: h.display,
        });
      } catch {}
    }
  }

  const projectsDir = path.join(root, "projects");
  if (!fs.existsSync(projectsDir)) return;

  const projDirs = fs
    .readdirSync(projectsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const dir of projDirs) {
    const projDirPath = path.join(projectsDir, dir.name);
    const files = findFiles(projDirPath, ".jsonl");
    for (const file of files) {
      await streamJsonl(file, (obj) => {
        const ts = obj.timestamp;
        if (!ts) return;
        const sessionId = obj.sessionId || "";
        const project = dir.name;

        if (obj.type === "user") {
          let prompt = "";
          const c = obj.message && obj.message.content;
          if (typeof c === "string") prompt = c;
          else if (Array.isArray(c)) {
            const t = c.find((x) => x && x.type === "text");
            if (t) prompt = t.text || "";
          }
          emit({
            agent: NAME,
            timestamp: ts,
            sessionId,
            project,
            type: "user",
            prompt,
          });
        } else if (obj.type === "assistant" && obj.message) {
          const usage = obj.message.usage || {};
          const tokens = {
            input: usage.input_tokens || 0,
            output: usage.output_tokens || 0,
            cacheRead: usage.cache_read_input_tokens || 0,
            cacheCreate: usage.cache_creation_input_tokens || 0,
          };
          emit({
            agent: NAME,
            timestamp: ts,
            sessionId,
            project,
            type: "assistant",
            model: obj.message.model || null,
            tokens,
          });

          const content = obj.message.content;
          if (Array.isArray(content)) {
            for (const item of content) {
              if (item.type === "tool_use") {
                emit({
                  agent: NAME,
                  timestamp: ts,
                  sessionId,
                  project,
                  type: "tool",
                  toolCall: { name: item.name, input: item.input || {} },
                });
              }
            }
          }
        }
      });
    }
  }
}

function readStatsCache() {
  return readJsonSafe(path.join(dataDir(), "stats-cache.json"));
}

module.exports = { name: NAME, displayName: DISPLAY, dataDir, enabled, getEvents, readStatsCache };
