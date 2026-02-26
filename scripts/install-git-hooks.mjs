import { execSync } from "node:child_process";

try {
  execSync("git config core.hooksPath .githooks", { stdio: "inherit" });
  console.log("[hooks] Installed. git hooks path -> .githooks");
} catch (error) {
  console.error("[hooks] Failed to install git hooks path.");
  process.exit(1);
}
