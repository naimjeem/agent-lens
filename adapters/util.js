const fs = require("fs");
const path = require("path");
const readline = require("readline");

function findFiles(dir, extensions) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const exts = Array.isArray(extensions) ? extensions : [extensions];
  function walk(d) {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(d, entry.name);
      try {
        if (entry.isDirectory()) walk(full);
        else if (exts.some((e) => entry.name.endsWith(e))) results.push(full);
      } catch {}
    }
  }
  walk(dir);
  return results;
}

function streamJsonl(filePath, onLine) {
  return new Promise((resolve) => {
    const stream = fs.createReadStream(filePath, { encoding: "utf8" });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const obj = JSON.parse(trimmed);
        onLine(obj);
      } catch {}
    });
    rl.on("close", resolve);
    rl.on("error", resolve);
  });
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function loadSqlite() {
  try {
    return require("better-sqlite3");
  } catch {
    return null;
  }
}

function pathToProject(cwd) {
  if (!cwd) return "unknown";
  return cwd;
}

function tsFromUnix(seconds) {
  if (seconds == null) return null;
  const ms = seconds > 1e12 ? seconds : seconds * 1000;
  return new Date(ms).toISOString();
}

module.exports = {
  findFiles,
  streamJsonl,
  readJsonSafe,
  loadSqlite,
  pathToProject,
  tsFromUnix,
};
