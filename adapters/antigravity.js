const fs = require("fs");
const os = require("os");
const path = require("path");

const NAME = "antigravity";
const DISPLAY = "Antigravity";

function defaultDir() {
  return path.join(os.homedir(), ".gemini", "antigravity");
}

function dataDir() {
  return process.env.ANTIGRAVITY_DIR || defaultDir();
}

function enabled() {
  return fs.existsSync(path.join(dataDir(), "conversations"));
}

function readableStrings(buf) {
  const out = [];
  let cur = "";
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b >= 0x20 && b < 0x7f) {
      cur += String.fromCharCode(b);
    } else {
      if (cur.length >= 8) out.push(cur);
      cur = "";
    }
  }
  if (cur.length >= 8) out.push(cur);
  return out;
}

async function getEvents(emit) {
  const convDir = path.join(dataDir(), "conversations");
  if (!fs.existsSync(convDir)) return;

  const files = fs.readdirSync(convDir).filter((f) => f.endsWith(".pb"));

  for (const f of files) {
    const full = path.join(convDir, f);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    const sessionId = f.replace(/\.pb$/, "");
    const ts = new Date(stat.mtime).toISOString();

    let project = "unknown";
    let prompt = "";
    try {
      const buf = fs.readFileSync(full);
      const strings = readableStrings(buf);
      const cwd = strings.find((s) => s.startsWith("/Users/") || s.startsWith("/home/"));
      if (cwd) project = cwd.split(/\s/)[0];
      const firstUserish = strings.find(
        (s) => s.length > 12 && !s.startsWith("/") && !s.includes("://"),
      );
      if (firstUserish) prompt = firstUserish.slice(0, 200);
    } catch {}

    emit({
      agent: NAME,
      timestamp: ts,
      sessionId,
      project,
      type: "user",
      prompt,
    });
    emit({
      agent: NAME,
      timestamp: ts,
      sessionId,
      project,
      type: "assistant",
      model: null,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    });
  }
}

module.exports = { name: NAME, displayName: DISPLAY, dataDir, enabled, getEvents };
