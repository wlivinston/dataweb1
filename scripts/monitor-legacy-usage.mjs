import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HISTORY_PATH = process.env.LEGACY_USAGE_HISTORY_FILE || "monitoring/legacy-usage-history.jsonl";
const OBSERVATION_WINDOW_DAYS = Number.parseInt(
  String(process.env.LEGACY_OBSERVATION_WINDOW_DAYS || "14"),
  10
);
const LEGACY_USAGE_URL = String(process.env.LEGACY_USAGE_URL || "").trim();
const LEGACY_USAGE_TOKEN = String(process.env.LEGACY_USAGE_TOKEN || "").trim();
const LEGACY_USAGE_SHARED_TOKEN = String(process.env.LEGACY_USAGE_SHARED_TOKEN || "").trim();

const MIN_WINDOW_DAYS = 1;
const MAX_WINDOW_DAYS = 365;

const observationWindowDays = Number.isFinite(OBSERVATION_WINDOW_DAYS)
  ? Math.min(Math.max(OBSERVATION_WINDOW_DAYS, MIN_WINDOW_DAYS), MAX_WINDOW_DAYS)
  : 14;

const now = new Date();
const today = now.toISOString().slice(0, 10);
const historyAbsPath = resolve(HISTORY_PATH);

function fail(message) {
  console.error(`[legacy-monitor] ${message}`);
  process.exit(1);
}

function parseJsonLine(rawLine) {
  try {
    return JSON.parse(rawLine);
  } catch {
    return null;
  }
}

function readHistory() {
  try {
    const raw = readFileSync(historyAbsPath, "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map(parseJsonLine)
      .filter(Boolean);
  } catch {
    return [];
  }
}

function writeHistory(records) {
  mkdirSync(dirname(historyAbsPath), { recursive: true });
  const lines = records.map((entry) => JSON.stringify(entry));
  writeFileSync(historyAbsPath, `${lines.join("\n")}\n`, "utf8");
}

function normalizeTopEntries(top) {
  if (!Array.isArray(top)) return [];
  return top.map((item) => ({
    endpoint: String(item?.endpoint || ""),
    origin: String(item?.origin || ""),
    count: Number(item?.count || 0),
  }));
}

function buildComparableRecord(record) {
  return {
    date: String(record?.date || ""),
    totalHits: Number(record?.totalHits || 0),
    uniqueBuckets: Number(record?.uniqueBuckets || 0),
    legacyApiEnabled: Boolean(record?.legacyApiEnabled),
    telemetryEnabled: Boolean(record?.telemetryEnabled),
    sunset: String(record?.sunset || ""),
    top: normalizeTopEntries(record?.top),
  };
}

function recordsEqualForMonitoring(left, right) {
  return JSON.stringify(buildComparableRecord(left)) === JSON.stringify(buildComparableRecord(right));
}

function computeConsecutiveZeroDays(records) {
  const sorted = [...records].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let streak = 0;
  for (let idx = sorted.length - 1; idx >= 0; idx -= 1) {
    if (Number(sorted[idx]?.totalHits || 0) === 0) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

function appendGitHubOutput(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  writeFileSync(outputPath, `${lines.join("\n")}\n`, { encoding: "utf8", flag: "a" });
}

function appendGitHubSummary(markdown) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  writeFileSync(summaryPath, `${markdown}\n`, { encoding: "utf8", flag: "a" });
}

async function fetchLegacyUsageSnapshot() {
  if (!LEGACY_USAGE_URL) {
    fail("LEGACY_USAGE_URL is required.");
  }
  if (!LEGACY_USAGE_SHARED_TOKEN && !LEGACY_USAGE_TOKEN) {
    fail("LEGACY_USAGE_SHARED_TOKEN or LEGACY_USAGE_TOKEN is required.");
  }

  const headers = {
    Accept: "application/json",
  };
  const authMode = LEGACY_USAGE_SHARED_TOKEN ? "shared-token" : "bearer-jwt";
  if (LEGACY_USAGE_SHARED_TOKEN) {
    headers["x-legacy-monitor-token"] = LEGACY_USAGE_SHARED_TOKEN;
  } else if (LEGACY_USAGE_TOKEN) {
    headers.Authorization = `Bearer ${LEGACY_USAGE_TOKEN}`;
  }

  const response = await fetch(LEGACY_USAGE_URL, {
    method: "GET",
    headers,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    fail(
      `Request failed (${response.status}, authMode=${authMode}). Body: ${JSON.stringify(payload || {})}`
    );
  }

  const data = payload?.data;
  if (!data || typeof data !== "object") {
    fail("Unexpected payload shape; expected { success: true, data: {...} }");
  }

  return { data, authMode };
}

const { data: snapshot, authMode } = await fetchLegacyUsageSnapshot();
const top = Array.isArray(snapshot.top) ? snapshot.top.slice(0, 10) : [];

const todayRecord = {
  date: today,
  checkedAt: now.toISOString(),
  totalHits: Number(snapshot.totalHits || 0),
  uniqueBuckets: Number(snapshot.uniqueBuckets || 0),
  legacyApiEnabled: Boolean(snapshot.legacyApiEnabled),
  telemetryEnabled: Boolean(snapshot.enabled),
  sunset: String(snapshot.sunset || ""),
  generatedAt: String(snapshot.generatedAt || ""),
  top,
};

const history = readHistory();
const existingToday = history.find((entry) => entry?.date === today);
const reusedTodaySnapshot = Boolean(existingToday && recordsEqualForMonitoring(existingToday, todayRecord));
const effectiveTodayRecord = reusedTodaySnapshot ? existingToday : todayRecord;
const existing = history.filter((entry) => entry?.date !== today);
const nextHistory = [...existing, effectiveTodayRecord].sort((a, b) =>
  String(a.date).localeCompare(String(b.date))
);
writeHistory(nextHistory);

const consecutiveZeroDays = computeConsecutiveZeroDays(nextHistory);
const readyToDisable = consecutiveZeroDays >= observationWindowDays && effectiveTodayRecord.totalHits === 0;

const summary = [
  `Legacy usage checked on ${today}`,
  `authMode=${authMode}`,
  `totalHits=${effectiveTodayRecord.totalHits}`,
  `uniqueBuckets=${effectiveTodayRecord.uniqueBuckets}`,
  `consecutiveZeroDays=${consecutiveZeroDays}`,
  `observationWindowDays=${observationWindowDays}`,
  `reusedTodaySnapshot=${reusedTodaySnapshot}`,
  `readyToDisable=${readyToDisable}`,
];
console.log(`[legacy-monitor] ${summary.join(" | ")}`);

appendGitHubOutput({
  auth_mode: authMode,
  total_hits: effectiveTodayRecord.totalHits,
  unique_buckets: effectiveTodayRecord.uniqueBuckets,
  consecutive_zero_days: consecutiveZeroDays,
  observation_window_days: observationWindowDays,
  reused_today_snapshot: reusedTodaySnapshot,
  ready_to_disable: readyToDisable,
});

appendGitHubSummary([
  "## Legacy API Daily Monitor",
  `- Date: **${today}**`,
  `- Auth Mode: **${authMode}**`,
  `- Total Hits: **${effectiveTodayRecord.totalHits}**`,
  `- Unique Buckets: **${effectiveTodayRecord.uniqueBuckets}**`,
  `- Reused Existing Same-Day Snapshot: **${reusedTodaySnapshot ? "YES" : "NO"}**`,
  `- Consecutive Zero-Hit Days: **${consecutiveZeroDays}**`,
  `- Observation Window: **${observationWindowDays} days**`,
  `- Ready To Disable Legacy API: **${readyToDisable ? "YES" : "NO"}**`,
].join("\n"));
