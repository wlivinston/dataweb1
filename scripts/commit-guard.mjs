import { readFileSync } from "node:fs";

const RISKY_PATH_PATTERNS = [
  /^\.env$/i,
  /^\.env\./i,
  /^backend\/\.env$/i,
  /^backend\/\.env\./i,
  /^public\/sitemap\.xml$/i,
  /^dist\//i,
  /^backend\/tmp-.*$/i,
];

function parseLines(raw) {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function getStagedFiles() {
  const args = process.argv.slice(2);
  if (args.length > 0 && args[0] !== "--stdin") {
    return args.filter(Boolean);
  }

  if (args.includes("--stdin")) {
    const stdin = readFileSync(0, "utf8");
    return parseLines(stdin);
  }

  const fromEnv = parseLines(process.env.STAGED_FILES || "");
  return fromEnv;
}

function isRisky(filePath) {
  return RISKY_PATH_PATTERNS.some((pattern) => pattern.test(filePath));
}

if (String(process.env.ALLOW_RISKY_COMMIT || "").trim() === "1") {
  console.log("[commit-guard] ALLOW_RISKY_COMMIT=1 set; skipping risky file guard.");
  process.exit(0);
}

const stagedFiles = getStagedFiles();
if (!stagedFiles.length) {
  console.log("[commit-guard] No staged files provided; skipping.");
  process.exit(0);
}

const riskyFiles = stagedFiles.filter(isRisky);

if (!riskyFiles.length) {
  process.exit(0);
}

console.error("[commit-guard] Blocked potentially unintentional staged files:");
for (const filePath of riskyFiles) {
  console.error(`  - ${filePath}`);
}
console.error(
  "[commit-guard] If intentional, rerun commit with ALLOW_RISKY_COMMIT=1."
);
process.exit(1);
