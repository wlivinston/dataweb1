import {
  FinanceColumnMapping,
  NetIncomeAutoMediumSignalDefault,
  NetIncomeToEquityMode,
} from './financeTypes';
import { WideConversionConfig } from './financeImportPipeline';
import {
  AssetHandlingMode,
  AssetJournalGenerationOptions,
  DepreciationGenerationOptions,
  LiabilityJournalGenerationOptions,
} from './financeAssetIngestion';

export type FinanceImportProfileFormat = 'long' | 'wide';

export interface FinanceImportProfile {
  id: string;
  name: string;
  format: FinanceImportProfileFormat;
  longMapping?: FinanceColumnMapping;
  wideConfig?: WideConversionConfig;
  netIncomeToEquityMode?: NetIncomeToEquityMode;
  netIncomeAutoMediumSignalDefault?: NetIncomeAutoMediumSignalDefault;
  assetRules?: {
    handlingMode?: AssetHandlingMode;
    acquisition: AssetJournalGenerationOptions;
    depreciation: DepreciationGenerationOptions;
    includeDepreciation: boolean;
    liability?: LiabilityJournalGenerationOptions;
  };
  createdAt: string;
  updatedAt: string;
}

interface SaveProfileInput {
  name: string;
  format: FinanceImportProfileFormat;
  longMapping?: FinanceColumnMapping;
  wideConfig?: WideConversionConfig;
  netIncomeToEquityMode?: NetIncomeToEquityMode;
  netIncomeAutoMediumSignalDefault?: NetIncomeAutoMediumSignalDefault;
  assetRules?: {
    handlingMode?: AssetHandlingMode;
    acquisition: AssetJournalGenerationOptions;
    depreciation: DepreciationGenerationOptions;
    includeDepreciation: boolean;
    liability?: LiabilityJournalGenerationOptions;
  };
}

const STORAGE_KEY = 'finance_import_profiles_v1';

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function loadProfiles(): FinanceImportProfile[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter(profile => profile && typeof profile.name === 'string')
      .map(profile => ({
        ...profile,
        netIncomeAutoMediumSignalDefault: normalizeMediumSignalDefault(
          profile.netIncomeAutoMediumSignalDefault
        ),
      }));
  } catch {
    return [];
  }
}

function normalizeMediumSignalDefault(value: unknown): NetIncomeAutoMediumSignalDefault | undefined {
  if (value === 'add' || value === 'skip' || value === 'auto') {
    return value;
  }

  // Backward compatibility for older stored profile values.
  if (value === 'add_net_income') return 'add';
  if (value === 'skip_net_income') return 'skip';

  return undefined;
}

function persistProfiles(profiles: FinanceImportProfile[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function getFinanceImportProfiles(format?: FinanceImportProfileFormat): FinanceImportProfile[] {
  const profiles = loadProfiles().sort((a, b) => a.name.localeCompare(b.name));
  if (!format) return profiles;
  return profiles.filter(profile => profile.format === format);
}

export function saveFinanceImportProfile(input: SaveProfileInput): FinanceImportProfile {
  const profiles = loadProfiles();
  const now = new Date().toISOString();

  const existingIndex = profiles.findIndex(
    profile => profile.name.toLowerCase() === input.name.toLowerCase() && profile.format === input.format
  );

  if (existingIndex >= 0) {
    const updated: FinanceImportProfile = {
      ...profiles[existingIndex],
      longMapping: input.longMapping,
      wideConfig: input.wideConfig,
      netIncomeToEquityMode: input.netIncomeToEquityMode,
      netIncomeAutoMediumSignalDefault: input.netIncomeAutoMediumSignalDefault,
      assetRules: input.assetRules,
      updatedAt: now,
    };

    profiles[existingIndex] = updated;
    persistProfiles(profiles);
    return updated;
  }

  const created: FinanceImportProfile = {
    id: `${input.format}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    format: input.format,
    longMapping: input.longMapping,
    wideConfig: input.wideConfig,
    netIncomeToEquityMode: input.netIncomeToEquityMode,
    netIncomeAutoMediumSignalDefault: input.netIncomeAutoMediumSignalDefault,
    assetRules: input.assetRules,
    createdAt: now,
    updatedAt: now,
  };

  profiles.push(created);
  persistProfiles(profiles);

  return created;
}

