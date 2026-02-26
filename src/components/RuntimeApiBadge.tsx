import { PUBLIC_CONFIG } from "@/lib/publicConfig";

const parseBooleanEnv = (value: unknown): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(normalized);
  }
  return false;
};

const RuntimeApiBadge: React.FC = () => {
  const runtimeBadgeEnabled = import.meta.env.DEV || parseBooleanEnv(import.meta.env.VITE_RUNTIME_BADGE);
  if (!runtimeBadgeEnabled) return null;

  const apiMode = PUBLIC_CONFIG.apiVersion === "v1" ? "v1" : "legacy";
  const financeJobsConfigured = parseBooleanEnv(import.meta.env.VITE_FINANCE_API_JOBS);
  const financeJobsEnabled = financeJobsConfigured && apiMode === "v1";
  const backendLabel = PUBLIC_CONFIG.backendUrl || "frontend-origin";

  return (
    <div
      aria-label="Runtime API mode"
      className="fixed right-3 top-20 z-40 max-w-[calc(100vw-1.5rem)] rounded-lg border border-slate-200 bg-white/95 px-3 py-2 text-xs text-slate-700 shadow-md backdrop-blur"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-semibold text-slate-900">Runtime</span>
        <span>
          API:{" "}
          <span className={apiMode === "v1" ? "font-semibold text-emerald-700" : "font-semibold text-amber-700"}>
            {apiMode}
          </span>
        </span>
        <span>
          Finance Jobs:{" "}
          <span className={financeJobsEnabled ? "font-semibold text-emerald-700" : "font-semibold text-slate-700"}>
            {financeJobsEnabled ? "on" : "off"}
          </span>
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] text-slate-500">Backend: {backendLabel}</div>
    </div>
  );
};

export default RuntimeApiBadge;
