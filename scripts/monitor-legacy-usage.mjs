import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const HISTORY_PATH = process.env.LEGACY_USAGE_HISTORY_FILE || "monitoring/legacy-usage-history.jsonl";
const OBSERVATION_WINDOW_DAYS = Number.parseInt(
  String(process.env.LEGACY_OBSERVATION_WINDOW_DAYS || "14"),
  10
);
const LEGACY_USAGE_URL = String(process.env.LEGACY_USAGE_URL || "").trim();
const LEGACY_USAGE_TOKEN = String(process.env.LEGACY_USAGE_TOKEN || "").trim();

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
  if (!LEGACY_USAGE_TOKEN) {
    fail("LEGACY_USAGE_TOKEN is required.");
  }

  const response = await fetch(LEGACY_USAGE_URL, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${LEGACY_USAGE_TOKEN}`,
      Accept: "application/json",
    },
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    fail(
      `Request failed (${response.status}). Body: ${JSON.stringify(payload || {})}`
    );
  }

  const data = payload?.data;
  if (!data || typeof data !== "object") {
    fail("Unexpected payload shape; expected { success: true, data: {...} }");
  }

  return data;
}

const snapshot = await fetchLegacyUsageSnapshot();
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

const existing = readHistory().filter((entry) => entry?.date !== today);
const nextHistory = [...existing, todayRecord].sort((a, b) =>
  String(a.date).localeCompare(String(b.date))
);
writeHistory(nextHistory);

const consecutiveZeroDays = computeConsecutiveZeroDays(nextHistory);
const readyToDisable = consecutiveZeroDays >= observationWindowDays && todayRecord.totalHits === 0;

const summary = [
  `Legacy usage checked on ${today}`,
  `totalHits=${todayRecord.totalHits}`,
  `uniqueBuckets=${todayRecord.uniqueBuckets}`,
  `consecutiveZeroDays=${consecutiveZeroDays}`,
  `observationWindowDays=${observationWindowDays}`,
  `readyToDisable=${readyToDisable}`,
];
console.log(`[legacy-monitor] ${summary.join(" | ")}`);

appendGitHubOutput({
  total_hits: todayRecord.totalHits,
  unique_buckets: todayRecord.uniqueBuckets,
  consecutive_zero_days: consecutiveZeroDays,
  observation_window_days: observationWindowDays,
  ready_to_disable: readyToDisable,
});

appendGitHubSummary([
  "## Legacy API Daily Monitor",
  `- Date: **${today}**`,
  `- Total Hits: **${todayRecord.totalHits}**`,
  `- Unique Buckets: **${todayRecord.uniqueBuckets}**`,
  `- Consecutive Zero-Hit Days: **${consecutiveZeroDays}**`,
  `- Observation Window: **${observationWindowDays} days**`,
  `- Ready To Disable Legacy API: **${readyToDisable ? "YES" : "NO"}**`,
].join("\n"));
