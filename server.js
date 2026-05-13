#!/usr/bin/env node
require("dotenv").config();

const express = require("express");
const path = require("path");

const { ADAPTERS, getAdapter, listAdapters, collectEvents } = require("./adapters");
const { PER_AGENT, costFor } = require("./rates");
const { refreshIfStale: refreshPricing, snapshot: pricingSnapshot } = require("./pricing");

const app = express();
const PORT = parseInt(process.env.PORT || "3456", 10);

app.use(express.static(__dirname));

const cache = { events: null, ts: 0, agentKey: "all" };
const TTL_MS = 30_000;

async function getEvents(agentFilter) {
  const key = agentFilter || "all";
  const now = Date.now();
  if (cache.events && cache.agentKey === key && now - cache.ts < TTL_MS) {
    return cache.events;
  }
  const events = await collectEvents(agentFilter);
  cache.events = events;
  cache.agentKey = key;
  cache.ts = now;
  return events;
}

function dayOf(ts) {
  return (ts || "").slice(0, 10);
}

app.get("/api/agents", (req, res) => {
  res.json(listAdapters());
});

app.get("/api/pricing", async (req, res) => {
  try {
    if (req.query.refresh === "1") {
      await refreshPricing();
    } else {
      refreshPricing();
    }
    res.json(pricingSnapshot());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/rates", (req, res) => {
  const out = {};
  for (const [name, r] of Object.entries(PER_AGENT)) {
    out[name] = {
      input: r.input * 1e6,
      output: r.output * 1e6,
      cacheRead: r.cacheRead * 1e6,
      cacheCreate: r.cacheCreate * 1e6,
      label: r.label,
    };
  }
  res.json(out);
});

app.get("/api/stats", (req, res) => {
  const stats = {};
  for (const adapter of ADAPTERS) {
    if (adapter.name === "claude" && adapter.enabled() && adapter.readStatsCache) {
      const s = adapter.readStatsCache();
      if (s) stats.claude = s;
    }
  }
  res.json(stats);
});

app.get("/api/history", async (req, res) => {
  try {
    const agent = req.query.agent || null;
    const events = await getEvents(agent);
    const items = events
      .filter((e) => (e.type === "user" || e.type === "user_log") && e.prompt && e.prompt.trim())
      .map((e) => ({
        agent: e.agent,
        display: e.prompt || "",
        timestamp: e.timestamp,
        project: e.project,
        sessionId: e.sessionId,
      }))
      .sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/projects", async (req, res) => {
  try {
    const agent = req.query.agent || null;
    const events = await getEvents(agent);
    const projects = {};
    for (const e of events) {
      if (e.type !== "user") continue;
      const proj = e.project || "unknown";
      if (!projects[proj]) {
        projects[proj] = {
          messages: 0,
          sessions: new Set(),
          firstSeen: null,
          lastSeen: null,
          agents: new Set(),
        };
      }
      projects[proj].messages++;
      projects[proj].sessions.add(e.sessionId);
      projects[proj].agents.add(e.agent);
      const ts = e.timestamp;
      if (!projects[proj].firstSeen || ts < projects[proj].firstSeen) projects[proj].firstSeen = ts;
      if (!projects[proj].lastSeen || ts > projects[proj].lastSeen) projects[proj].lastSeen = ts;
    }
    const out = Object.entries(projects)
      .map(([name, d]) => ({
        name,
        shortName: name.split("/").pop() || name,
        messages: d.messages,
        sessions: d.sessions.size,
        firstSeen: d.firstSeen,
        lastSeen: d.lastSeen,
        agents: [...d.agents],
      }))
      .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tool-calls", async (req, res) => {
  try {
    const agent = req.query.agent || null;
    const events = await getEvents(agent);
    const counts = {};
    const byProject = {};
    for (const e of events) {
      if (e.type !== "tool" || !e.toolCall) continue;
      const t = e.toolCall.name;
      counts[t] = (counts[t] || 0) + 1;
      if (!byProject[e.project]) byProject[e.project] = {};
      byProject[e.project][t] = (byProject[e.project][t] || 0) + 1;
    }
    const tools = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([tool, count]) => ({ tool, count }));
    res.json({ tools, byProject });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tool-details/:toolName", async (req, res) => {
  try {
    const agent = req.query.agent || null;
    const events = await getEvents(agent);
    const toolName = req.params.toolName;
    const calls = [];
    for (const e of events) {
      if (e.type !== "tool" || !e.toolCall || e.toolCall.name !== toolName) continue;
      const input = e.toolCall.input || {};
      const detail = { agent: e.agent, project: e.project, timestamp: e.timestamp };

      if (toolName === "Bash" || toolName === "bash" || toolName === "exec_command") {
        detail.command = input.command || input.cmd || "";
        detail.description = input.description || "";
      } else if (["Read", "Edit", "Write"].includes(toolName)) {
        detail.file_path = input.file_path || input.path || "";
      } else if (toolName === "Grep") {
        detail.pattern = input.pattern || "";
        detail.path = input.path || "";
        detail.glob = input.glob || "";
      } else if (toolName === "Glob") {
        detail.pattern = input.pattern || "";
        detail.path = input.path || "";
      } else if (toolName === "Agent") {
        detail.description = input.description || "";
        detail.subagent_type = input.subagent_type || "";
      } else {
        detail.input = JSON.stringify(input).slice(0, 200);
      }
      calls.push(detail);
    }
    calls.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));
    res.json(calls);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/daily-costs", async (req, res) => {
  try {
    const agent = req.query.agent || null;
    await refreshPricing();
    const events = await getEvents(agent);
    const daily = {};

    for (const e of events) {
      const day = dayOf(e.timestamp);
      if (!day) continue;
      if (!daily[day]) {
        daily[day] = {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheCreate: 0,
          messages: 0,
          toolCalls: 0,
          sessions: new Set(),
          models: {},
          cost: 0,
          providedCost: 0,
          agents: {},
        };
      }
      const d = daily[day];

      if (e.type === "user") {
        d.messages++;
        d.sessions.add(e.sessionId);
        d.agents[e.agent] = (d.agents[e.agent] || 0) + 1;
      }
      if (e.type === "assistant") {
        const tk = e.tokens || {};
        d.input += tk.input || 0;
        d.output += tk.output || 0;
        d.cacheRead += tk.cacheRead || 0;
        d.cacheCreate += tk.cacheCreate || 0;
        const model = e.model || "unknown";
        d.models[model] = (d.models[model] || 0) + 1;
        d.agents[e.agent] = (d.agents[e.agent] || 0) + 1;

        if (typeof e.cost === "number" && e.cost > 0) {
          d.providedCost += e.cost;
        } else {
          d.cost += costFor(e.agent, tk, e.model);
        }
      }
      if (e.type === "tool") {
        d.toolCalls++;
      }
    }

    const days = Object.keys(daily)
      .sort((a, b) => b.localeCompare(a))
      .map((date) => {
        const d = daily[date];
        const total = d.cost + d.providedCost;
        return {
          date,
          messages: d.messages,
          toolCalls: d.toolCalls,
          sessions: d.sessions.size,
          input: d.input,
          output: d.output,
          cacheRead: d.cacheRead,
          cacheCreate: d.cacheCreate,
          cost: Math.round(total * 100) / 100,
          models: d.models,
          agents: d.agents,
        };
      });

    const totals = days.reduce(
      (acc, d) => {
        acc.messages += d.messages;
        acc.toolCalls += d.toolCalls;
        acc.sessions += d.sessions;
        acc.input += d.input;
        acc.output += d.output;
        acc.cacheRead += d.cacheRead;
        acc.cacheCreate += d.cacheCreate;
        acc.cost += d.cost;
        for (const [m, c] of Object.entries(d.models || {})) {
          acc.models[m] = (acc.models[m] || 0) + c;
        }
        for (const [a, c] of Object.entries(d.agents || {})) {
          acc.agents[a] = (acc.agents[a] || 0) + c;
        }
        return acc;
      },
      {
        messages: 0,
        toolCalls: 0,
        sessions: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheCreate: 0,
        cost: 0,
        models: {},
        agents: {},
      },
    );
    totals.cost = Math.round(totals.cost * 100) / 100;

    const ratesOut = {};
    for (const [name, r] of Object.entries(PER_AGENT)) {
      ratesOut[name] = {
        input: r.input,
        output: r.output,
        cacheRead: r.cacheRead,
        cacheCreate: r.cacheCreate,
        label: r.label,
      };
    }

    res.json({ days, totals, rates: ratesOut, agentFilter: agent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/metrics", async (req, res) => {
  try {
    const agent = req.query.agent || null;
    await refreshPricing();
    const events = await getEvents(agent);

    const hourly = Array(24).fill(0);
    const weekday = Array(7).fill(0);
    const agentTotals = {};
    const modelTotals = {};
    const agentCost = {};
    const sessionsByAgent = {};
    const dailyByAgent = {};
    let totalEvents = 0;

    for (const e of events) {
      totalEvents++;
      const ts = e.timestamp;
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d.getTime())) {
          hourly[d.getHours()]++;
          weekday[d.getDay()]++;
        }
      }
      const day = dayOf(ts);

      if (e.type === "user") {
        agentTotals[e.agent] = (agentTotals[e.agent] || 0) + 1;
        if (!sessionsByAgent[e.agent]) sessionsByAgent[e.agent] = new Set();
        sessionsByAgent[e.agent].add(e.sessionId);
      }
      if (e.type === "assistant") {
        const model = e.model || "unknown";
        modelTotals[model] = (modelTotals[model] || 0) + 1;
        const tk = e.tokens || {};
        const c = typeof e.cost === "number" && e.cost > 0 ? e.cost : costFor(e.agent, tk, e.model);
        agentCost[e.agent] = (agentCost[e.agent] || 0) + c;

        if (day) {
          if (!dailyByAgent[day]) dailyByAgent[day] = {};
          dailyByAgent[day][e.agent] = (dailyByAgent[day][e.agent] || 0) + c;
        }
      }
    }

    const agents = Object.entries(agentTotals)
      .map(([name, messages]) => ({
        name,
        messages,
        sessions: sessionsByAgent[name] ? sessionsByAgent[name].size : 0,
        cost: Math.round((agentCost[name] || 0) * 100) / 100,
      }))
      .sort((a, b) => b.messages - a.messages);

    const models = Object.entries(modelTotals)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);

    const dailyAgentSeries = Object.keys(dailyByAgent)
      .sort()
      .map((date) => ({ date, agents: dailyByAgent[date] }));

    res.json({
      hourly,
      weekday,
      agents,
      models,
      dailyAgentSeries,
      totalEvents,
      agentFilter: agent,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/sessions", (req, res) => {
  res.json([]);
});

app.listen(PORT, () => {
  const enabled = listAdapters().filter((a) => a.enabled);
  refreshPricing();
  console.log(`Agent Lens dashboard running at http://localhost:${PORT}`);
  console.log(`Detected agents: ${enabled.map((a) => a.name).join(", ") || "none"}`);
  for (const a of listAdapters()) {
    const status = a.enabled ? "ON " : "OFF";
    console.log(`  [${status}] ${a.displayName.padEnd(14)} ${a.dataDir}`);
  }
});
