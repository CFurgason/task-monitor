(function () {
  "use strict";

  const DEFAULT_CALLS_URL = "https://docs.google.com/spreadsheets/d/1lmSyCCP0RnOhU2CWJv9LzfAaHe7R_y4D56Vr3CAJ3YA/gviz/tq?tqx=out:csv&gid=0";
  const repoConfig = window.DASHBOARD_CONFIG || {};
  const storageKey = "callDropDashboard.v1";
  const msDay = 24 * 60 * 60 * 1000;

  const state = {
    calls: [],
    toggles: [],
    callHeaders: [],
    toggleHeaders: [],
    shopMappings: {},
    taskMappings: {},
    config: { callsUrl: repoConfig.callsUrl || DEFAULT_CALLS_URL, togglesUrl: repoConfig.togglesUrl || "" },
    metrics: null,
    selectedShop: null,
  };

  const els = {
    callsUrl: document.getElementById("callsUrl"),
    togglesUrl: document.getElementById("togglesUrl"),
    saveConfigBtn: document.getElementById("saveConfigBtn"),
    refreshBtn: document.getElementById("refreshBtn"),
    loadStatus: document.getElementById("loadStatus"),
    lastUpdated: document.getElementById("lastUpdated"),
    emptyState: document.getElementById("emptyState"),
    shopPage: document.getElementById("shopPage"),
    projectionsPage: document.getElementById("projectionsPage"),
    mappingsPage: document.getElementById("mappingsPage"),
    companyCurrent: document.getElementById("companyCurrent"),
    companyWow: document.getElementById("companyWow"),
    dropCount: document.getElementById("dropCount"),
    executionFailures: document.getElementById("executionFailures"),
    unmappedCount: document.getElementById("unmappedCount"),
    shopRows: document.getElementById("shopRows"),
    shopSearch: document.getElementById("shopSearch"),
    selectedShopName: document.getElementById("selectedShopName"),
    selectedShopMeta: document.getElementById("selectedShopMeta"),
    trendCanvas: document.getElementById("trendCanvas"),
    taskBreakdown: document.getElementById("taskBreakdown"),
    diagnosticMatrix: document.getElementById("diagnosticMatrix"),
    warningRows: document.getElementById("warningRows"),
    heatmap: document.getElementById("heatmap"),
    shopMappings: document.getElementById("shopMappings"),
    taskMappings: document.getElementById("taskMappings"),
    saveShopMappings: document.getElementById("saveShopMappings"),
    saveTaskMappings: document.getElementById("saveTaskMappings"),
  };

  function loadStored() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || "{}");
      state.shopMappings = { ...(repoConfig.shopMappings || {}), ...(stored.shopMappings || {}) };
      state.taskMappings = { ...(repoConfig.taskMappings || {}), ...(stored.taskMappings || {}) };
    } catch (error) {
      setStatus("Saved settings could not be read. Starting fresh.", true);
    }
  }

  function persist() {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        shopMappings: state.shopMappings,
        taskMappings: state.taskMappings,
      })
    );
  }

  function setStatus(message, isError) {
    els.loadStatus.textContent = message;
    els.loadStatus.style.color = isError ? "var(--red)" : "var(--muted)";
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let value = "";
    let quoted = false;

    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      const next = text[i + 1];
      if (quoted) {
        if (char === '"' && next === '"') {
          value += '"';
          i += 1;
        } else if (char === '"') {
          quoted = false;
        } else {
          value += char;
        }
      } else if (char === '"') {
        quoted = true;
      } else if (char === ",") {
        row.push(value);
        value = "";
      } else if (char === "\n") {
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      } else if (char !== "\r") {
        value += char;
      }
    }
    row.push(value);
    rows.push(row);

    const headers = (rows.shift() || []).map((header) => header.trim());
    const records = rows
      .filter((items) => items.some((item) => item.trim() !== ""))
      .map((items) => Object.fromEntries(headers.map((header, index) => [header, (items[index] || "").trim()])));
    return { headers, records };
  }

  async function fetchCsv(url) {
    const separator = url.includes("?") ? "&" : "?";
    const response = await fetch(`${url}${separator}_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return parseCsv(await response.text());
  }

  function normalizeName(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/\b(j)\s*\.?\s*(j)\s*\.?\b/g, "jj")
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\b(auto|automotive|service|services|center|centre|the|inc|llc|co)\b/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getField(row, names) {
    const lowered = Object.fromEntries(Object.keys(row).map((key) => [key.toLowerCase().trim(), key]));
    for (const name of names) {
      const key = lowered[name.toLowerCase()];
      if (key) return row[key];
    }
    return "";
  }

  function unique(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
  }

  function inferMappings() {
    const toggleShopNames = unique(state.toggles.map((row) => getField(row, ["Shop Name", "Shop", "Location"])));
    const callShopNames = unique(state.calls.map((row) => getField(row, ["Shop Name", "Shop", "Location"])));
    const toggleByNorm = new Map(toggleShopNames.map((name) => [normalizeName(name), name]));

    for (const callShop of callShopNames) {
      if (!state.shopMappings[callShop] && toggleByNorm.has(normalizeName(callShop))) {
        state.shopMappings[callShop] = toggleByNorm.get(normalizeName(callShop));
      }
    }

    const toggleTaskNames = getToggleTaskHeaders();
    const callTaskNames = unique(state.calls.map((row) => getField(row, ["Task Association", "Task Type", "Task"])));
    const tasksByNorm = new Map(toggleTaskNames.map((name) => [normalizeName(name), name]));

    for (const callTask of callTaskNames) {
      if (!state.taskMappings[callTask] && tasksByNorm.has(normalizeName(callTask))) {
        state.taskMappings[callTask] = tasksByNorm.get(normalizeName(callTask));
      }
    }
    persist();
  }

  function getToggleTaskHeaders() {
    const nonTask = new Set(["shop name", "shop", "location", "id", "store id"]);
    return state.toggleHeaders.filter((header) => !nonTask.has(header.toLowerCase().trim()));
  }

  function dateKey(date) {
    return date.toISOString().slice(0, 10);
  }

  function parseDate(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function periodStartFor(endDate, offsetDays) {
    const start = new Date(endDate);
    start.setHours(0, 0, 0, 0);
    return new Date(start.getTime() - offsetDays * msDay);
  }

  function startOfDay(value) {
    const date = new Date(value);
    date.setHours(0, 0, 0, 0);
    return date;
  }

  function pctChange(current, previous) {
    if (previous === 0 && current === 0) return 0;
    if (previous === 0) return 100;
    return ((current - previous) / previous) * 100;
  }

  function median(values) {
    const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
    if (!sorted.length) return 0;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function standardDeviation(values) {
    if (!values.length) return 0;
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
  }

  function getToggleRowsByShop() {
    const map = new Map();
    for (const row of state.toggles) {
      const shop = getField(row, ["Shop Name", "Shop", "Location"]);
      if (shop) map.set(shop, row);
    }
    return map;
  }

  function isToggleOn(toggleRow, taskName) {
    if (!toggleRow || !taskName) return false;
    const raw = toggleRow[taskName];
    return ["1", "true", "yes", "on", "y"].includes(String(raw || "").trim().toLowerCase());
  }

  function buildTaskCreationAnchors(taskRecords) {
    const anchorsByShop = new Map();
    for (const task of taskRecords) {
      if (!/next\s*day\s*satisfaction/i.test(task.taskType)) continue;
      const inferred = startOfDay(task.firstCallDate);
      const list = anchorsByShop.get(task.shop) || [];
      list.push({ id: task.numericTaskId, date: inferred });
      anchorsByShop.set(task.shop, list);
    }
    return anchorsByShop;
  }

  function estimateCreatedDate(task, anchorsByShop) {
    if (/next\s*day\s*satisfaction/i.test(task.taskType)) {
      return startOfDay(task.firstCallDate);
    }
    const anchors = anchorsByShop.get(task.shop) || [];
    let best = null;
    for (const anchor of anchors) {
      const distance = Math.abs(anchor.id - task.numericTaskId);
      if (!best || distance < best.distance) best = { distance, date: anchor.date };
    }
    return best && best.distance <= 50 ? best.date : null;
  }

  function calculateMetrics() {
    const today = new Date();
    const currentStart = periodStartFor(today, 6);
    const previousStart = periodStartFor(today, 13);
    const previousEnd = new Date(currentStart.getTime() - 1);
    const baselineStart = new Date(today.getTime() - 183 * msDay);
    const toggleRows = getToggleRowsByShop();
    const taskHeaders = getToggleTaskHeaders();
    const cleanCalls = [];
    const taskGroups = new Map();
    const unmapped = { shops: new Set(), tasks: new Set(), rows: 0 };

    for (const row of state.calls) {
      const taskId = getField(row, ["Task ID", "Task Id"]);
      const rawTask = getField(row, ["Task Association", "Task Type", "Task"]);
      if (!taskId && !rawTask) continue;

      const direction = getField(row, ["Call Direction", "Direction"]);
      if (!/out/i.test(direction)) continue;

      const callDate = parseDate(getField(row, ["Date/Time Stamp", "Date Time Stamp", "Timestamp", "Date"]));
      if (!callDate) continue;

      const rawShop = getField(row, ["Shop Name", "Shop", "Location"]);
      const shop = state.shopMappings[rawShop];
      const taskType = state.taskMappings[rawTask];
      if (!shop || !taskType) {
        unmapped.rows += 1;
        if (!shop && rawShop) unmapped.shops.add(rawShop);
        if (!taskType && rawTask) unmapped.tasks.add(rawTask);
        continue;
      }
      const toggleRow = toggleRows.get(shop);
      if (!isToggleOn(toggleRow, taskType)) continue;

      cleanCalls.push({ row, shop, taskType, date: callDate, taskId });
      if (taskId) {
        const key = `${shop}||${taskId}`;
        const numericTaskId = Number(String(taskId).replace(/[^0-9.-]/g, ""));
        const existing = taskGroups.get(key);
        if (!existing || callDate < existing.firstCallDate) {
          taskGroups.set(key, { shop, taskType, taskId, numericTaskId, firstCallDate: callDate });
        }
      }
    }

    const taskRecords = [...taskGroups.values()].filter((task) => Number.isFinite(task.numericTaskId));
    const anchors = buildTaskCreationAnchors(taskRecords);
    for (const task of taskRecords) {
      task.createdDate = estimateCreatedDate(task, anchors);
    }

    const shops = unique(state.toggles.map((row) => getField(row, ["Shop Name", "Shop", "Location"])));
    const shopStats = shops.map((shop) => {
      const onTasks = taskHeaders.filter((task) => isToggleOn(toggleRows.get(shop), task));
      const calls = cleanCalls.filter((call) => call.shop === shop);
      const current = calls.filter((call) => call.date >= currentStart).length;
      const previous = calls.filter((call) => call.date >= previousStart && call.date <= previousEnd).length;
      const baselineWeeks = buildWeeklyCounts(calls, baselineStart, previousEnd);
      const baseline = median(baselineWeeks);
      const spread = standardDeviation(baselineWeeks);
      const lowerBound = Math.max(0, baseline - spread);
      const taskCreations = taskRecords.filter((task) => task.shop === shop && task.createdDate);
      const recentCreations = taskCreations.filter((task) => task.createdDate >= currentStart).length;
      const historicalCreationWeeks = buildWeeklyCounts(
        taskCreations.map((task) => ({ date: task.createdDate })),
        baselineStart,
        previousEnd
      );
      const creationBaseline = median(historicalCreationWeeks);
      const creationNormal = creationBaseline === 0 ? recentCreations > 0 : recentCreations >= Math.max(1, creationBaseline * 0.45);
      const callsDropped = isDropped(current, previous, baseline, lowerBound);
      const diagnosis = getDiagnosis(creationNormal, callsDropped);
      const taskStats = onTasks.map((taskType) => buildTaskStat(shop, taskType, cleanCalls, currentStart, previousStart, previousEnd, baselineStart));
      const trend = buildDailyTrend(calls, today);
      const projection = projectTwoWeeks(trend);
      return {
        shop,
        onTasks,
        current,
        previous,
        pct: pctChange(current, previous),
        baseline,
        lowerBound,
        spread,
        callsDropped,
        creationNormal,
        diagnosis,
        status: statusFor(current, previous, baseline, lowerBound),
        taskStats,
        trend,
        projection,
      };
    });

    const companyCurrent = shopStats.reduce((sum, shop) => sum + shop.current, 0);
    const companyPrevious = shopStats.reduce((sum, shop) => sum + shop.previous, 0);
    const warnings = buildWarnings(shopStats);

    state.metrics = {
      currentStart,
      previousStart,
      previousEnd,
      shops: shopStats,
      warnings,
      taskHeaders,
      unmapped,
      companyCurrent,
      companyPrevious,
      companyPct: pctChange(companyCurrent, companyPrevious),
    };
  }

  function buildWeeklyCounts(items, start, end) {
    const weeks = [];
    let cursor = new Date(start);
    cursor.setHours(0, 0, 0, 0);
    while (cursor < end) {
      const next = new Date(cursor.getTime() + 7 * msDay);
      weeks.push(items.filter((item) => item.date >= cursor && item.date < next).length);
      cursor = next;
    }
    return weeks;
  }

  function buildTaskStat(shop, taskType, cleanCalls, currentStart, previousStart, previousEnd, baselineStart) {
    const calls = cleanCalls.filter((call) => call.shop === shop && call.taskType === taskType);
    const current = calls.filter((call) => call.date >= currentStart).length;
    const previous = calls.filter((call) => call.date >= previousStart && call.date <= previousEnd).length;
    const baselineWeeks = buildWeeklyCounts(calls, baselineStart, previousEnd);
    const baseline = median(baselineWeeks);
    const lowerBound = Math.max(0, baseline - standardDeviation(baselineWeeks));
    return {
      taskType,
      current,
      previous,
      pct: pctChange(current, previous),
      baseline,
      lowerBound,
      status: statusFor(current, previous, baseline, lowerBound),
    };
  }

  function isDropped(current, previous, baseline, lowerBound) {
    const wowDrop = previous >= 5 && current <= previous * 0.7;
    const baselineDrop = baseline >= 5 && current < lowerBound;
    return wowDrop || baselineDrop;
  }

  function statusFor(current, previous, baseline, lowerBound) {
    if (isDropped(current, previous, baseline, lowerBound)) return "bad";
    if ((previous >= 5 && current <= previous * 0.85) || (baseline >= 5 && current < baseline)) return "watch";
    return "good";
  }

  function getDiagnosis(tasksNormal, callsDropped) {
    if (tasksNormal && !callsDropped) return "Healthy";
    if (tasksNormal && callsDropped) return "Execution failure";
    if (!tasksNormal && callsDropped) return "Upstream/business issue";
    return "Manual review";
  }

  function buildDailyTrend(calls, today) {
    const days = [];
    for (let i = 55; i >= 0; i -= 1) {
      const day = new Date(today.getTime() - i * msDay);
      const key = dateKey(day);
      days.push({ date: key, count: calls.filter((call) => dateKey(call.date) === key).length });
    }
    return days;
  }

  function projectTwoWeeks(trend) {
    if (trend.length < 14) return { count: 0, date: "" };
    const recent = trend.slice(-7).reduce((sum, day) => sum + day.count, 0);
    const prior = trend.slice(-14, -7).reduce((sum, day) => sum + day.count, 0);
    const slope = recent - prior;
    const projected = Math.max(0, Math.round(recent + slope * 2));
    const date = new Date();
    date.setDate(date.getDate() + 14);
    return { count: projected, date: dateKey(date) };
  }

  function buildWarnings(shopStats) {
    const rows = [];
    for (const shop of shopStats) {
      rows.push({ scope: shop.shop, current: shop.current, baseline: shop.baseline, pct: shop.pct, projection: shop.projection, status: shop.status });
      for (const task of shop.taskStats) {
        rows.push({
          scope: `${shop.shop} · ${task.taskType}`,
          current: task.current,
          baseline: task.baseline,
          pct: task.pct,
          projection: shop.projection,
          status: task.status,
        });
      }
    }
    return rows
      .map((row) => {
        const baselineGap = row.baseline ? (row.baseline - row.current) / row.baseline : 0;
        const wowGap = row.pct < 0 ? Math.abs(row.pct) / 100 : 0;
        const statusWeight = row.status === "bad" ? 2 : row.status === "watch" ? 1 : 0;
        return { ...row, severity: statusWeight + baselineGap + wowGap };
      })
      .filter((row) => row.status !== "good" || row.severity > 0.25)
      .sort((a, b) => b.severity - a.severity)
      .slice(0, 80);
  }

  async function loadData() {
    if (!state.config.callsUrl || !state.config.togglesUrl) {
      setStatus("The dashboard needs both Google Sheet CSV URLs in config.js.", false);
      showEmpty(true);
      return;
    }

    setStatus("Loading live CSV data...", false);
    try {
      const [callsCsv, togglesCsv] = await Promise.all([fetchCsv(state.config.callsUrl), fetchCsv(state.config.togglesUrl)]);
      state.calls = callsCsv.records;
      state.toggles = togglesCsv.records;
      state.callHeaders = callsCsv.headers;
      state.toggleHeaders = togglesCsv.headers;
      inferMappings();
      calculateMetrics();
      renderAll();
      els.lastUpdated.textContent = `Updated ${new Date().toLocaleString()}`;
      setStatus(`Loaded ${state.calls.length.toLocaleString()} call rows and ${state.toggles.length.toLocaleString()} shop toggle rows.`, false);
      showEmpty(false);
    } catch (error) {
      setStatus(`Could not load sheets: ${error.message}`, true);
      showEmpty(true);
    }
  }

  function showEmpty(visible) {
    els.emptyState.classList.toggle("visible", visible);
  }

  function renderAll() {
    renderSummary();
    renderShopRows();
    renderWarnings();
    renderHeatmap();
    renderMappings();
    if (!state.selectedShop && state.metrics.shops.length) state.selectedShop = state.metrics.shops[0].shop;
    renderShopDetail();
  }

  function renderSummary() {
    const metrics = state.metrics;
    els.companyCurrent.textContent = metrics.companyCurrent.toLocaleString();
    els.companyWow.textContent = `${formatPct(metrics.companyPct)} vs prior week`;
    els.dropCount.textContent = metrics.shops.filter((shop) => shop.status === "bad").length.toLocaleString();
    els.executionFailures.textContent = metrics.shops.filter((shop) => shop.diagnosis === "Execution failure").length.toLocaleString();
    els.unmappedCount.textContent = metrics.unmapped.rows.toLocaleString();
  }

  function renderShopRows() {
    const query = els.shopSearch.value.trim().toLowerCase();
    els.shopRows.innerHTML = "";
    for (const shop of state.metrics.shops.filter((item) => item.shop.toLowerCase().includes(query))) {
      const row = document.createElement("tr");
      row.className = `clickable ${state.selectedShop === shop.shop ? "selected" : ""}`;
      row.innerHTML = `
        <td>${escapeHtml(shop.shop)}</td>
        <td>${shop.current.toLocaleString()}</td>
        <td>${shop.previous.toLocaleString()}</td>
        <td>${formatPct(shop.pct)}</td>
        <td>${shop.creationNormal ? pill("Still creating", "good") : pill("Stalled", "watch")}</td>
        <td>${escapeHtml(shop.diagnosis)}</td>
        <td>${pill(statusLabel(shop.status), shop.status)}</td>
      `;
      row.addEventListener("click", () => {
        state.selectedShop = shop.shop;
        renderShopRows();
        renderShopDetail();
      });
      els.shopRows.appendChild(row);
    }
  }

  function renderShopDetail() {
    const shop = state.metrics && state.metrics.shops.find((item) => item.shop === state.selectedShop);
    if (!shop) return;
    els.selectedShopName.textContent = shop.shop;
    els.selectedShopMeta.textContent = `${shop.current.toLocaleString()} calls this week, ${formatPct(shop.pct)} vs prior week, ${shop.baseline.toFixed(1)} median weekly baseline.`;
    drawTrend(shop.trend);
    els.taskBreakdown.innerHTML = shop.taskStats
      .map(
        (task) => `
        <div class="task-row">
          <span>${escapeHtml(task.taskType)}</span>
          <b>${task.current}</b>
          <span>${formatPct(task.pct)}</span>
          ${pill(statusLabel(task.status), task.status)}
        </div>`
      )
      .join("");
    els.diagnosticMatrix.innerHTML = `
      <div><strong>Normal tasks / Normal calls</strong>${shop.diagnosis === "Healthy" ? "Current shop state" : "No current match"}</div>
      <div><strong>Normal tasks / Dropped calls</strong>${shop.diagnosis === "Execution failure" ? "Highest priority" : "No current match"}</div>
      <div><strong>Dropped tasks / Dropped calls</strong>${shop.diagnosis === "Upstream/business issue" ? "Likely upstream" : "No current match"}</div>
      <div><strong>Dropped tasks / Normal calls</strong>${shop.diagnosis === "Manual review" ? "Worth manual review" : "No current match"}</div>
    `;
  }

  function drawTrend(trend) {
    const canvas = els.trendCanvas;
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#fbfcfd";
    ctx.fillRect(0, 0, width, height);
    const pad = 34;
    const max = Math.max(1, ...trend.map((day) => day.count));
    ctx.strokeStyle = "#d8dee3";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = pad + ((height - pad * 2) * i) / 4;
      ctx.beginPath();
      ctx.moveTo(pad, y);
      ctx.lineTo(width - pad, y);
      ctx.stroke();
    }
    ctx.strokeStyle = "#1d6fa5";
    ctx.lineWidth = 3;
    ctx.beginPath();
    trend.forEach((day, index) => {
      const x = pad + ((width - pad * 2) * index) / Math.max(1, trend.length - 1);
      const y = height - pad - (day.count / max) * (height - pad * 2);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.fillStyle = "#64717b";
    ctx.font = "14px system-ui";
    ctx.fillText("Last 56 days", pad, height - 10);
    ctx.fillText(`${max} max/day`, width - 105, 22);
  }

  function renderWarnings() {
    els.warningRows.innerHTML = state.metrics.warnings
      .map(
        (row) => `
        <tr>
          <td>${escapeHtml(row.scope)}</td>
          <td>${row.current.toLocaleString()}</td>
          <td>${row.baseline.toFixed(1)}</td>
          <td>${formatPct(row.pct)}</td>
          <td>${row.projection.count.toLocaleString()} by ${row.projection.date}</td>
          <td>${pill(statusLabel(row.status), row.status)}</td>
        </tr>`
      )
      .join("");
  }

  function renderHeatmap() {
    const tasks = state.metrics.taskHeaders;
    const shops = state.metrics.shops;
    const columns = ["190px", ...tasks.map(() => "92px")].join(" ");
    let html = `<div class="heat-grid" style="grid-template-columns:${columns}">`;
    html += `<div class="heat-row-head">Shop</div>${tasks.map((task) => `<div class="heat-head">${escapeHtml(task)}</div>`).join("")}`;
    for (const shop of shops) {
      html += `<div class="heat-row-head">${escapeHtml(shop.shop)}</div>`;
      for (const task of tasks) {
        const stat = shop.taskStats.find((item) => item.taskType === task);
        const status = stat ? stat.status : "off";
        const label = stat ? `${stat.current} (${formatPct(stat.pct)})` : "Off";
        html += `<div class="heat-cell ${status}" title="${escapeHtml(shop.shop)} · ${escapeHtml(task)}">${label}</div>`;
      }
    }
    html += "</div>";
    els.heatmap.innerHTML = html;
  }

  function renderMappings() {
    const toggleShopNames = unique(state.toggles.map((row) => getField(row, ["Shop Name", "Shop", "Location"])));
    const callShopNames = unique(state.calls.map((row) => getField(row, ["Shop Name", "Shop", "Location"])));
    els.shopMappings.innerHTML = callShopNames
      .map((name) => mappingItem("shop", name, toggleShopNames, state.shopMappings[name] || ""))
      .join("");

    const toggleTaskNames = getToggleTaskHeaders();
    const callTaskNames = unique(state.calls.map((row) => getField(row, ["Task Association", "Task Type", "Task"])));
    els.taskMappings.innerHTML = callTaskNames
      .map((name) => mappingItem("task", name, toggleTaskNames, state.taskMappings[name] || ""))
      .join("");
  }

  function mappingItem(type, source, options, current) {
    const optionHtml = [`<option value="">Unmapped</option>`]
      .concat(options.map((option) => `<option value="${escapeAttr(option)}" ${option === current ? "selected" : ""}>${escapeHtml(option)}</option>`))
      .join("");
    return `
      <div class="mapping-item">
        <label>Source name<input value="${escapeAttr(source)}" readonly /></label>
        <label>Dashboard match<select data-map-type="${type}" data-source="${escapeAttr(source)}">${optionHtml}</select></label>
      </div>`;
  }

  function saveMappings(type) {
    document.querySelectorAll(`select[data-map-type="${type}"]`).forEach((select) => {
      const source = select.dataset.source;
      if (type === "shop") {
        if (select.value) state.shopMappings[source] = select.value;
        else delete state.shopMappings[source];
      } else {
        if (select.value) state.taskMappings[source] = select.value;
        else delete state.taskMappings[source];
      }
    });
    persist();
    calculateMetrics();
    renderAll();
    setStatus(`${type === "shop" ? "Shop" : "Task"} mappings saved and metrics recalculated.`, false);
  }

  function pill(label, status) {
    return `<span class="pill ${status}">${escapeHtml(label)}</span>`;
  }

  function statusLabel(status) {
    return status === "bad" ? "Dropped" : status === "watch" ? "Watch" : status === "off" ? "Off" : "Healthy";
  }

  function formatPct(value) {
    const rounded = Math.round(value);
    return `${rounded > 0 ? "+" : ""}${rounded}%`;
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#096;");
  }

  function setupEvents() {
    if (els.saveConfigBtn) els.saveConfigBtn.addEventListener("click", loadData);
    els.refreshBtn.addEventListener("click", loadData);
    els.shopSearch.addEventListener("input", renderShopRows);
    els.saveShopMappings.addEventListener("click", () => saveMappings("shop"));
    els.saveTaskMappings.addEventListener("click", () => saveMappings("task"));
    document.querySelectorAll(".tab").forEach((button) => {
      button.addEventListener("click", () => {
        document.querySelectorAll(".tab").forEach((item) => item.classList.remove("active"));
        document.querySelectorAll(".page").forEach((item) => item.classList.remove("active"));
        button.classList.add("active");
        document.getElementById(`${button.dataset.tab}Page`).classList.add("active");
      });
    });
  }

  loadStored();
  setupEvents();
  if (state.config.callsUrl && state.config.togglesUrl) loadData();
  else showEmpty(true);
})();
