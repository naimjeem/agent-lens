const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadSqlite, tsFromUnix } = require("./util");

const NAME = "cursor";
const DISPLAY = "Cursor";

function defaultGlobalDb() {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return path.join(
    os.homedir(),
    ".config",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
}

function dataDir() {
  if (process.env.CURSOR_DB) return process.env.CURSOR_DB;
  return process.env.CURSOR_DIR || defaultGlobalDb();
}

function dbPath() {
  const d = dataDir();
  if (d.endsWith(".vscdb")) return d;
  if (fs.existsSync(path.join(d, "state.vscdb"))) return path.join(d, "state.vscdb");
  return defaultGlobalDb();
}

function enabled() {
  return fs.existsSync(dbPath());
}

function projectFromUris(uris) {
  if (!Array.isArray(uris) || !uris.length) return null;
  for (const u of uris) {
    if (typeof u !== "string") continue;
    if (u.startsWith("file://")) {
      try {
        let decoded = decodeURIComponent(u.replace(/^file:\/\//, ""));
        if (process.platform === "win32" && /^\/[A-Za-z]:/.test(decoded)) {
          decoded = decoded.slice(1);
        }
        return decoded;
      } catch {
        return u;
      }
    }
  }
  return null;
}

function tsFromBubble(v) {
  if (typeof v === "number") return tsFromUnix(v);
  if (typeof v === "string") {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

async function getEvents(emit) {
  if (!enabled()) return;
  const Database = loadSqlite();
  if (!Database) {
    console.warn(`[cursor] better-sqlite3 not installed; skipping. Run: npm install better-sqlite3`);
    return;
  }

  let db;
  try {
    db = new Database(dbPath(), { readonly: true, fileMustExist: true });
  } catch (err) {
    console.warn(`[cursor] cannot open db: ${err.message}`);
    return;
  }

  const composerMeta = {};
  try {
    const composers = db
      .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
      .iterate();
    for (const row of composers) {
      let c;
      try {
        c = JSON.parse(row.value);
      } catch {
        continue;
      }
      if (!c || typeof c !== "object") continue;
      const id = c.composerId || row.key.replace("composerData:", "");
      composerMeta[id] = {
        name: c.name || "",
        modelName: (c.modelConfig && c.modelConfig.modelName) || null,
        createdAt: c.createdAt || null,
      };
    }
  } catch (err) {
    console.warn(`[cursor] composer read failed: ${err.message}`);
  }

  let bubbles;
  try {
    bubbles = db
      .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'bubbleId:%'")
      .iterate();
  } catch (err) {
    console.warn(`[cursor] bubble query failed: ${err.message}`);
    db.close();
    return;
  }

  for (const row of bubbles) {
    let b;
    try {
      b = JSON.parse(row.value);
    } catch {
      continue;
    }

    const parts = row.key.split(":");
    const composerId = parts[1] || "";
    const bubbleId = b.bubbleId || parts[2] || "";

    const meta = composerMeta[composerId] || {};
    const ts =
      tsFromBubble(b.createdAt) || tsFromBubble(meta.createdAt) || new Date().toISOString();
    const project =
      projectFromUris(b.workspaceUris) ||
      (meta.name ? meta.name : null) ||
      "unknown";
    const sessionId = composerId;
    const t = b.type;

    if (t === 1) {
      const prompt = (b.text || "").toString();
      emit({
        agent: NAME,
        timestamp: ts,
        sessionId,
        project,
        type: "user",
        prompt: prompt.slice(0, 4000),
      });
    } else if (t === 2) {
      const tk = b.tokenCount || {};
      const tokens = {
        input: tk.inputTokens || 0,
        output: tk.outputTokens || 0,
        cacheRead: 0,
        cacheCreate: 0,
      };
      emit({
        agent: NAME,
        timestamp: ts,
        sessionId,
        project,
        type: "assistant",
        model: meta.modelName || null,
        tokens,
      });
    }

    const tool = b.toolFormerData;
    if (tool && typeof tool === "object" && tool.name) {
      let input = {};
      if (tool.params) {
        try {
          input = JSON.parse(tool.params);
        } catch {
          input = { raw: String(tool.params).slice(0, 200) };
        }
      } else if (tool.rawArgs) {
        try {
          input = JSON.parse(tool.rawArgs);
        } catch {
          input = { raw: String(tool.rawArgs).slice(0, 200) };
        }
      }
      emit({
        agent: NAME,
        timestamp: ts,
        sessionId,
        project,
        type: "tool",
        toolCall: { name: tool.name, input },
      });
    }
  }

  db.close();
}

module.exports = { name: NAME, displayName: DISPLAY, dataDir, enabled, getEvents };
