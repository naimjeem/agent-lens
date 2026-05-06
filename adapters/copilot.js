const fs = require("fs");
const os = require("os");
const path = require("path");
const { findFiles, readJsonSafe, streamJsonl } = require("./util");

const NAME = "copilot";
const DISPLAY = "GitHub Copilot";

const VSCODE_FLAVORS = [
  "Code",
  "Code - Insiders",
  "VSCodium",
  "Cursor",
];

function vscodeRoots() {
  const home = os.homedir();
  const roots = [];

  if (process.env.COPILOT_VSCODE_ROOT) {
    roots.push(process.env.COPILOT_VSCODE_ROOT);
    return roots;
  }

  const appBases = [];
  if (process.platform === "darwin") {
    appBases.push(path.join(home, "Library", "Application Support"));
  } else if (process.platform === "win32") {
    const roaming = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    appBases.push(roaming);
  } else {
    appBases.push(path.join(home, ".config"));
  }

  for (const base of appBases) {
    for (const flavor of VSCODE_FLAVORS) {
      const userDir = path.join(base, flavor, "User");
      if (fs.existsSync(userDir)) roots.push(userDir);
    }
  }

  return roots;
}

function dataDir() {
  return process.env.COPILOT_DIR || vscodeRoots()[0] || "(no VS Code install)";
}

function enabled() {
  for (const root of vscodeRoots()) {
    const ws = path.join(root, "workspaceStorage");
    if (fs.existsSync(ws)) return true;
  }
  return false;
}

function projectForWorkspace(wsDir) {
  const ws = readJsonSafe(path.join(wsDir, "workspace.json"));
  if (ws && typeof ws.folder === "string") {
    let p = ws.folder.replace(/^file:\/\//, "");
    try {
      p = decodeURIComponent(p);
    } catch {}
    if (process.platform === "win32" && /^\/[A-Za-z]:/.test(p)) p = p.slice(1);
    return p;
  }
  return path.basename(wsDir);
}

function extractModel(req, sessionDefault) {
  if (req && req.modelId) return req.modelId;
  if (req && req.selectedModel && req.selectedModel.metadata) {
    return req.selectedModel.metadata.name || req.selectedModel.identifier;
  }
  return sessionDefault;
}

function sessionDefaultModel(session) {
  const sm = session && session.inputState && session.inputState.selectedModel;
  if (!sm) return null;
  if (sm.metadata && sm.metadata.name) return sm.metadata.name;
  return sm.identifier || null;
}

function tsFromMs(ms) {
  if (!ms || typeof ms !== "number") return null;
  return new Date(ms).toISOString();
}

function processSession(session, sourcePath, project, emit) {
  if (!session || typeof session !== "object") return;
  const sessionId = session.sessionId || path.basename(sourcePath, path.extname(sourcePath));
  const defaultModel = sessionDefaultModel(session);
  const requests = Array.isArray(session.requests) ? session.requests : [];
  const sessionTs = tsFromMs(session.creationDate) || tsFromMs(session.lastMessageDate);

  if (!requests.length && sessionTs) {
    emit({
      agent: NAME,
      timestamp: sessionTs,
      sessionId,
      project,
      type: "user",
      prompt: "",
    });
    return;
  }

  for (const req of requests) {
    const ts =
      tsFromMs(req.timestamp) ||
      tsFromMs(req.creationDate) ||
      sessionTs ||
      new Date().toISOString();
    const model = extractModel(req, defaultModel);
    const promptText =
      (req.message && (req.message.text || req.message.parsedText)) ||
      req.text ||
      "";

    emit({
      agent: NAME,
      timestamp: ts,
      sessionId,
      project,
      type: "user",
      prompt: String(promptText).slice(0, 4000),
    });

    emit({
      agent: NAME,
      timestamp: ts,
      sessionId,
      project,
      type: "assistant",
      model,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    });

    const responseItems = Array.isArray(req.response) ? req.response : [];
    for (const item of responseItems) {
      if (!item || typeof item !== "object") continue;
      const kind = item.kind || item.type;
      if (kind === "toolInvocation" || kind === "toolInvocationSerialized") {
        const toolName =
          (item.toolSpecificData && item.toolSpecificData.toolName) ||
          item.toolName ||
          item.name ||
          "tool";
        const input =
          (item.toolSpecificData && item.toolSpecificData.parameters) ||
          item.parameters ||
          item.input ||
          {};
        emit({
          agent: NAME,
          timestamp: ts,
          sessionId,
          project,
          type: "tool",
          toolCall: { name: toolName, input },
        });
      }
    }
  }
}

async function getEvents(emit) {
  const roots = vscodeRoots();
  if (!roots.length) return;

  for (const root of roots) {
    const wsRoot = path.join(root, "workspaceStorage");
    if (!fs.existsSync(wsRoot)) continue;

    let workspaces;
    try {
      workspaces = fs
        .readdirSync(wsRoot, { withFileTypes: true })
        .filter((d) => d.isDirectory());
    } catch {
      continue;
    }

    for (const ws of workspaces) {
      const wsDir = path.join(wsRoot, ws.name);
      const project = projectForWorkspace(wsDir);
      const chatDir = path.join(wsDir, "chatSessions");
      if (!fs.existsSync(chatDir)) continue;

      const files = findFiles(chatDir, [".json", ".jsonl"]);
      for (const file of files) {
        if (file.endsWith(".jsonl")) {
          let latest = null;
          await streamJsonl(file, (rec) => {
            if (rec && rec.kind === 0 && rec.v) latest = rec.v;
          });
          if (latest) processSession(latest, file, project, emit);
        } else {
          const data = readJsonSafe(file);
          if (data) processSession(data, file, project, emit);
        }
      }
    }
  }
}

module.exports = { name: NAME, displayName: DISPLAY, dataDir, enabled, getEvents };
