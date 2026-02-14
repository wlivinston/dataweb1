///<reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_BACKEND_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_BRAND_NAME?: string;
  readonly VITE_LOGO_URL?: string;
  readonly VITE_SUPPORT_EMAIL?: string;
  readonly VITE_LINKEDIN_URL?: string;
  readonly VITE_GITHUB_URL?: string;
  readonly VITE_PHONE_GH?: string;
  readonly VITE_PHONE_US?: string;
  readonly VITE_LOCATION_TEXT?: string;
  readonly VITE_FINANCE_ASSET_MODULE_ENABLED?: string;
  readonly VITE_FINANCE_ASSET_MODULE_FLOWS_TO_BALANCE_SHEET?: string;
  readonly VITE_FINANCE_ASSET_MODULE_SUPPORTS_INGESTION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
