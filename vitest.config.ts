import { defineConfig } from "vitest/config";
import path from "path";

// Pin a non-UTC timezone for the whole suite.
//
// CI runs in UTC, where a date implementation using local getters and one
// using UTC getters behave identically - so a timezone-drift test passes
// vacuously on exactly the machine we rely on.
//
// The offset must be NEGATIVE. Dates are held internally as midnight UTC,
// which a positive offset renders as afternoon on the same local day; local
// getters would still produce the right calendar date and the drift tests
// would pass regardless. At UTC-10 midnight lands on the previous local day,
// so the bug actually shows. Honolulu has no DST, so the offset is stable.
//
// dateTable.test.ts asserts the offset is positive in getTimezoneOffset()
// terms (i.e. behind UTC), so if this stops taking effect the suite fails
// loudly instead of going quiet.
process.env.TZ = "Pacific/Honolulu";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules/**", "backend/**", "dist/**"],
    reporters: "default",
  },
});
