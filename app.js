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
    selectedTask: null,
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
    viewFilter: document.getElementById("viewFilter"),
    urgentGroups: document.getElementById("urgentGroups"),
    shopSearch: document.getElementById("shopSearch"),
    selectedTaskName: document.getElementById("selectedTaskName"),
    selectedTaskMeta: document.getElementById("selectedTaskMeta"),
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
    const prior4Start = periodStartFor(today, 34);
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
      const taskStats = onTasks.map((taskType) => buildTaskStat(shop, taskType, cleanCalls, currentStart, previousStart, prior4Start, previousEnd, baselineStart, today));
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
    const taskSummaries = buildTaskSummaries(taskHeaders, shopStats, cleanCalls, today);
    const warnings = buildWarnings(shopStats);

    state.metrics = {
      currentStart,
      previousStart,
      previousEnd,
      shops: shopStats,
      warnings,
      taskHeaders,
      taskSummaries,
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

  function buildTaskStat(shop, taskType, cleanCalls, currentStart, previousStart, prior4Start, previousEnd, baselineStart, today) {
    const calls = cleanCalls.filter((call) => call.shop === shop && call.taskType === taskType);
    const current = calls.filter((call) => call.date >= currentStart).length;
    const previous = calls.filter((call) => call.date >= previousStart && call.date <= previousEnd).length;
    const previous4WeekCalls = calls.filter((call) => call.date >= prior4Start && call.date <= previousEnd).length;
    const previous4Avg = previous4WeekCalls / 4;
    const baselineWeeks = buildWeeklyCounts(calls, baselineStart, previousEnd);
    const baseline = median(baselineWeeks);
    const lowerBound = Math.max(0, baseline - standardDeviation(baselineWeeks));
    const lastCallDate = calls.reduce((latest, call) => (!latest || call.date > latest ? call.date : latest), null);
    const daysSinceCall = lastCallDate ? Math.floor((startOfDay(today) - startOfDay(lastCallDate)) / msDay) : null;
    const dropInCalls = Math.round(current - previous4Avg);
    const fourWeekPct = pctChange(current, previous4Avg);
    const status = statusForDrop(current, previous4Avg, previous, baseline, lowerBound, daysSinceCall);
    return {
      taskType,
      current,
      previous,
      previous4Avg,
      dropInCalls,
      daysSinceCall,
      fourWeekPct,
      pct: pctChange(current, previous),
      baseline,
      lowerBound,
      status,
    };
  }

  function buildTaskSummaries(taskHeaders, shopStats, cleanCalls, today) {
    return taskHeaders
      .map((taskType) => {
        const shopTaskStats = shopStats
          .map((shop) => {
            const stat = shop.taskStats.find((item) => item.taskType === taskType);
            return stat ? { ...stat, shop: shop.shop, diagnosis: shop.diagnosis, creationNormal: shop.creationNormal } : null;
          })
          .filter(Boolean);
        const taskCalls = cleanCalls.filter((call) => call.taskType === taskType);
        const current = shopTaskStats.reduce((sum, stat) => sum + stat.current, 0);
        const previous = shopTaskStats.reduce((sum, stat) => sum + stat.previous, 0);
        const previous4Avg = shopTaskStats.reduce((sum, stat) => sum + stat.previous4Avg, 0);
        const baseline = shopTaskStats.reduce((sum, stat) => sum + stat.baseline, 0);
        const lowerBound = shopTaskStats.reduce((sum, stat) => sum + stat.lowerBound, 0);
        const affectedShops = shopTaskStats
          .filter((stat) => stat.status === "bad")
          .sort((a, b) => {
            const aGap = a.baseline ? (a.baseline - a.current) / a.baseline : 0;
            const bGap = b.baseline ? (b.baseline - b.current) / b.baseline : 0;
            return bGap - aGap;
          });
        const watchShops = shopTaskStats.filter((stat) => stat.status === "watch");
        const aggregateStatus = statusFor(current, previous, baseline, lowerBound);
        const status = affectedShops.length ? "bad" : watchShops.length ? "watch" : aggregateStatus;
        return {
          taskType,
          activeShops: shopTaskStats.length,
          allShops: shopTaskStats.sort((a, b) => a.shop.localeCompare(b.shop)),
          affectedShops,
          watchShops,
          current,
          previous,
          previous4Avg,
          dropInCalls: Math.round(current - previous4Avg),
          fourWeekPct: pctChange(current, previous4Avg),
          pct: pctChange(current, previous),
          baseline,
          lowerBound,
          status,
          trend: buildDailyTrend(taskCalls, today),
        };
      })
      .sort((a, b) => {
        const statusOrder = { bad: 0, watch: 1, good: 2 };
        return statusOrder[a.status] - statusOrder[b.status] || b.affectedShops.length - a.affectedShops.length || a.taskType.localeCompare(b.taskType);
      });
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

  function statusForDrop(current, previous4Avg, previous, baseline, lowerBound, daysSinceCall) {
    const avgDrop = previous4Avg >= 1 && current < previous4Avg;
    const deepAvgDrop = previous4Avg >= 1 && current <= previous4Avg * 0.35;
    const stale = daysSinceCall !== null && daysSinceCall >= 7;
    if (deepAvgDrop || (current === 0 && previous4Avg >= 1) || stale) return "bad";
    if (avgDrop || isDropped(current, previous, baseline, lowerBound)) return "watch";
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
          scope: `${shop.shop} - ${task.taskType}`,
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
    renderDropGroups();
    renderWarnings();
    renderHeatmap();
    renderMappings();
    if (!state.selectedTask && state.metrics.taskSummaries.length) state.selectedTask = state.metrics.taskSummaries[0].taskType;
    renderTaskDetail();
  }

  function renderSummary() {
    const metrics = state.metrics;
    els.companyCurrent.textContent = metrics.companyCurrent.toLocaleString();
    els.companyWow.textContent = `${formatPct(metrics.companyPct)} vs prior week`;
    els.dropCount.textContent = metrics.taskSummaries.filter((task) => task.affectedShops.length > 0).length.toLocaleString();
    els.executionFailures.textContent = unique(metrics.taskSummaries.flatMap((task) => task.affectedShops.map((shop) => shop.shop))).length.toLocaleString();
    els.unmappedCount.textContent = metrics.unmapped.rows.toLocaleString();
  }

  function renderDropGroups() {
    const query = els.shopSearch.value.trim().toLowerCase();
    const mode = els.viewFilter ? els.viewFilter.value : "urgent";
    const groups = state.metrics.taskSummaries
      .map((task) => ({ ...task, visibleShops: shopsForTaskMode(task, mode) }))
      .filter((task) => {
        const matchesTask = task.taskType.toLowerCase().includes(query);
        const matchesShop = task.visibleShops.some((shop) => shop.shop.toLowerCase().includes(query));
        return task.visibleShops.length && (!query || matchesTask || matchesShop);
      });

    els.urgentGroups.innerHTML =
      groups
        .map(
          (task) => `
          <article class="drop-group ${state.selectedTask === task.taskType ? "selected-group" : ""}" data-task="${escapeAttr(task.taskType)}">
            <div class="drop-group-header">
              <h3>${escapeHtml(task.taskType)}</h3>
              <span>${task.visibleShops.length.toLocaleString()} ${task.visibleShops.length === 1 ? "shop" : "shops"}</span>
            </div>
            <div class="drop-table-wrap">
              <table class="drop-table">
                <thead>
                  <tr>
                    <th>Shop</th>
                    <th>Last 7 days</th>
                    <th>Previous 4 week avg</th>
                    <th>% change</th>
                    <th>Drop in calls</th>
                    <th>Days since call</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${task.visibleShops.map((shop) => renderDropRow(shop)).join("")}
                </tbody>
              </table>
            </div>
          </article>`
        )
        .join("") || `<div class="empty-inline">No task drops match this view.</div>`;

    document.querySelectorAll(".drop-group").forEach((group) => {
      group.addEventListener("click", () => {
        state.selectedTask = group.dataset.task;
        renderDropGroups();
        renderTaskDetail();
      });
    });
  }

  function shopsForTaskMode(task, mode) {
    if (mode === "all") return task.allShops || [];
    if (mode === "watch") return task.watchShops;
    return task.affectedShops;
  }

  function renderDropRow(shop) {
    const critical = shop.status === "bad";
    return `
      <tr class="${critical ? "critical-row" : ""}">
        <td>${escapeHtml(shop.shop)}</td>
        <td>${shop.current.toLocaleString()}</td>
        <td>${formatNumber(shop.previous4Avg)}</td>
        <td class="${shop.fourWeekPct < 0 ? "negative" : ""}">${formatPct(shop.fourWeekPct)}</td>
        <td class="${shop.dropInCalls < 0 ? "negative" : ""}">${shop.dropInCalls.toLocaleString()}</td>
        <td>${shop.daysSinceCall === null ? "Never" : shop.daysSinceCall.toLocaleString()}</td>
        <td>${pill(statusLabel(shop.status), shop.status)}</td>
      </tr>`;
  }

  function renderTaskDetail() {
    const task = state.metrics && state.metrics.taskSummaries.find((item) => item.taskType === state.selectedTask);
    if (!task) return;
    els.selectedTaskName.textContent = task.taskType;
    els.selectedTaskMeta.textContent = `${task.current.toLocaleString()} calls this week across ${task.activeShops.toLocaleString()} active shops. ${task.affectedShops.length.toLocaleString()} shops have a drop.`;
    drawTrend(task.trend);
    const affected = task.affectedShops.length ? task.affectedShops : task.watchShops;
    els.taskBreakdown.innerHTML = affected.length
      .map(
        (shop) => `
        <div class="task-row">
          <span>${escapeHtml(shop.shop)}</span>
          <b>${shop.current}</b>
          <span>${formatPct(shop.fourWeekPct)}</span>
          ${pill(statusLabel(shop.status), shop.status)}
        </div>`
      )
      .join("") || `<div class="muted">No shops currently show a drop for this task.</div>`;
    els.diagnosticMatrix.innerHTML = `
      <div><strong>Active shops</strong>${task.activeShops.toLocaleString()}</div>
      <div><strong>Dropped shops</strong>${task.affectedShops.length.toLocaleString()}</div>
      <div><strong>Watch shops</strong>${task.watchShops.length.toLocaleString()}</div>
      <div><strong>Task status</strong>${statusLabel(task.status)}</div>
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
        html += `<div class="heat-cell ${status}" title="${escapeHtml(shop.shop)} - ${escapeHtml(task)}">${label}</div>`;
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
    return status === "bad" ? "Critical" : status === "watch" ? "Call Drop" : status === "off" ? "Off" : "Healthy";
  }

  function formatPct(value) {
    const rounded = Math.round(value);
    return `${rounded > 0 ? "+" : ""}${rounded}%`;
  }

  function formatNumber(value) {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? rounded.toLocaleString() : rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
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
    els.shopSearch.addEventListener("input", renderDropGroups);
    if (els.viewFilter) els.viewFilter.addEventListener("change", renderDropGroups);
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
