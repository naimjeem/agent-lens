const fs = require("fs");
const os = require("os");
const path = require("path");
const { loadSqlite } = require("./util");

const NAME = "cursor";
const DISPLAY = "Cursor";
const DEFAULT_DIR = path.join(os.homedir(), ".cursor");

function dataDir() {
  return process.env.CURSOR_DIR || DEFAULT_DIR;
}

function enabled() {
  return fs.existsSync(path.join(dataDir(), "chats"));
}

function hexToString(hex) {
  if (!hex) return "";
  if (typeof hex !== "string") return "";
  const buf = Buffer.from(hex, "hex");
  return buf.toString("utf8");
}

async function getEvents(emit) {
  const chatsDir = path.join(dataDir(), "chats");
  if (!fs.existsSync(chatsDir)) return;

  const Database = loadSqlite();
  if (!Database) {
    console.warn(`[cursor] better-sqlite3 not installed; skipping. Run: npm install better-sqlite3`);
    return;
  }

  const projects = fs
    .readdirSync(chatsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  for (const proj of projects) {
    const projPath = path.join(chatsDir, proj.name);
    const sessions = fs
      .readdirSync(projPath, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    for (const sess of sessions) {
      const dbFile = path.join(projPath, sess.name, "store.db");
      if (!fs.existsSync(dbFile)) continue;

      let db;
      try {
        db = new Database(dbFile, { readonly: true, fileMustExist: true });
      } catch {
        continue;
      }

      try {
        const rows = db.prepare("SELECT key, value FROM meta").all();
        let metaRaw = null;
        for (const r of rows) {
          if (r.key === "0") {
            metaRaw = r.value;
            break;
          }
        }

        let meta = null;
        if (metaRaw) {
          try {
            meta = JSON.parse(hexToString(metaRaw));
          } catch {}
        }
        const sessionId = (meta && meta.agentId) || sess.name;
        const created = meta && meta.createdAt;
        const ts = created ? new Date(created).toISOString() : null;
        const name = meta && meta.name ? meta.name : sess.name;

        emit({
          agent: NAME,
          timestamp: ts || new Date(fs.statSync(dbFile).mtime).toISOString(),
          sessionId,
          project: proj.name,
          type: "user",
          prompt: name,
        });

        let blobCount = 0;
        try {
          const c = db.prepare("SELECT COUNT(*) as n FROM blobs").get();
          blobCount = c.n || 0;
        } catch {}
        if (blobCount > 0) {
          emit({
            agent: NAME,
            timestamp: ts || new Date(fs.statSync(dbFile).mtime).toISOString(),
            sessionId,
            project: proj.name,
            type: "assistant",
            model: meta && meta.lastUsedModel ? meta.lastUsedModel : null,
            tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
            messageCount: blobCount,
          });
        }
      } catch {}
      try {
        db.close();
      } catch {}
    }
  }
}

module.exports = { name: NAME, displayName: DISPLAY, dataDir, enabled, getEvents };
