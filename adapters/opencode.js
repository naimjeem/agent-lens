const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadSqlite, tsFromUnix } = require("./util");

const NAME = "opencode";
const DISPLAY = "OpenCode";

function defaultDir() {
  if (process.env.XDG_DATA_HOME) {
    return path.join(process.env.XDG_DATA_HOME, "opencode");
  }
  if (process.platform === "win32") {
    const local =
      process.env.LOCALAPPDATA ||
      path.join(os.homedir(), "AppData", "Local");
    return path.join(local, "opencode");
  }
  return path.join(os.homedir(), ".local", "share", "opencode");
}

function dataDir() {
  return process.env.OPENCODE_DIR || defaultDir();
}

function dbPath() {
  return path.join(dataDir(), "opencode.db");
}

function enabled() {
  return fs.existsSync(dbPath());
}

async function getEvents(emit) {
  if (!enabled()) return;
  const Database = loadSqlite();
  if (!Database) {
    console.warn(`[opencode] better-sqlite3 not installed; skipping. Run: npm install better-sqlite3`);
    return;
  }

  let db;
  try {
    db = new Database(dbPath(), { readonly: true, fileMustExist: true });
  } catch (err) {
    console.warn(`[opencode] cannot open db: ${err.message}`);
    return;
  }

  const projectMap = {};
  try {
    const projRows = db.prepare("SELECT id, worktree, name FROM project").all();
    for (const r of projRows) projectMap[r.id] = r.worktree || r.name || r.id;
  } catch {}

  const sessionProj = {};
  try {
    const sessRows = db.prepare("SELECT id, project_id, directory FROM session").all();
    for (const r of sessRows) {
      sessionProj[r.id] = r.directory || projectMap[r.project_id] || "unknown";
    }
  } catch {}

  let messages;
  try {
    messages = db.prepare("SELECT id, session_id, time_created, data FROM message").all();
  } catch (err) {
    db.close();
    return;
  }

  for (const row of messages) {
    let m;
    try {
      m = JSON.parse(row.data);
    } catch {
      continue;
    }
    const ts = tsFromUnix(row.time_created / 1000);
    const sessionId = row.session_id;
    const project = sessionProj[sessionId] || "unknown";

    if (m.role === "user") {
      emit({
        agent: NAME,
        timestamp: ts,
        sessionId,
        project,
        type: "user",
        prompt: "",
      });
    } else if (m.role === "assistant") {
      const tk = m.tokens || {};
      const cache = tk.cache || {};
      const tokens = {
        input: tk.input || 0,
        output: tk.output || 0,
        cacheRead: cache.read || 0,
        cacheCreate: cache.write || 0,
        reasoning: tk.reasoning || 0,
      };
      const model = m.modelID || (m.model && m.model.modelID) || null;
      emit({
        agent: NAME,
        timestamp: ts,
        sessionId,
        project,
        type: "assistant",
        model,
        tokens,
        cost: m.cost || 0,
      });
    }
  }

  let parts;
  try {
    parts = db
      .prepare(
        "SELECT message_id, session_id, time_created, data FROM part WHERE data LIKE '%\"type\":\"tool\"%'",
      )
      .all();
  } catch {
    parts = [];
  }

  for (const row of parts) {
    let p;
    try {
      p = JSON.parse(row.data);
    } catch {
      continue;
    }
    if (p.type !== "tool") continue;
    const ts = tsFromUnix(row.time_created / 1000);
    const sessionId = row.session_id;
    const project = sessionProj[sessionId] || "unknown";
    const input = (p.state && p.state.input) || {};
    emit({
      agent: NAME,
      timestamp: ts,
      sessionId,
      project,
      type: "tool",
      toolCall: { name: p.tool || "tool", input },
    });
  }

  db.close();
}

module.exports = { name: NAME, displayName: DISPLAY, dataDir, enabled, getEvents };
