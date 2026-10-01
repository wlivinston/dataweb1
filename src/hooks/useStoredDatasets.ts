import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listStoredDatasets,
  loadDatasetRows,
  saveDataset,
  toDataset,
  type StoredDataset,
} from '@/lib/datasetStore';
import { analyzeColumn } from '@/lib/dataUtils';
import type { Dataset } from '@/lib/types';

/**
 * Uploads that survive a refresh.
 *
 * The dataset endpoints were built, tested against the production database,
 * and called by nothing - so until now every refresh lost the upload. This is
 * the wiring: restore on arrival, store on upload.
 *
 * Three things it deliberately does NOT do.
 *
 * It never fails an upload. A dataset that could not be stored still works
 * for the rest of the session; the user is told it will not be there
 * tomorrow, and that is the whole consequence. Losing the analysis because
 * the network hiccuped would be a worse product than losing the persistence.
 *
 * It never half-restores. loadDatasetRows refuses a short read rather than
 * returning what it got, so a restored dataset is the whole dataset or it is
 * an error. A breakdown computed over nine tenths of the rows looks entirely
 * normal.
 *
 * It restores within a budget rather than everything. Pulling every stored
 * row on every page load would make the app slower the longer somebody uses
 * it, which is the kind of decay nobody attributes to the right cause. What
 * is skipped is reported rather than hidden.
 */

/**
 * Rows restored automatically across all datasets.
 *
 * Chosen above the point where the browser used to fall over - column
 * statistics threw RangeError past about 130,000 rows - and below the point
 * where a page load becomes a wait. A dataset past this is still stored and
 * still listed; it is just not pulled down without being asked for.
 */
export const RESTORE_ROW_BUDGET = 250_000;

export type RestoreStatus = 'idle' | 'restoring' | 'done' | 'failed';

export interface StoredDatasetsState {
  status: RestoreStatus;
  /** Datasets restored from the server, newest first. */
  restored: Dataset[];
  /** Stored but not loaded, because the budget ran out. */
  skipped: StoredDataset[];
  /** Why the restore failed, when it did. */
  error: string | null;
  /** The dataset currently being written, for a progress message. */
  saving: string | null;
}

const EMPTY: StoredDatasetsState = {
  status: 'idle',
  restored: [],
  skipped: [],
  error: null,
  saving: null,
};

const newestFirst = (left: StoredDataset, right: StoredDataset): number =>
  String(right.updatedAt || right.createdAt || '').localeCompare(
    String(left.updatedAt || left.createdAt || '')
  );

/**
 * Which stored datasets to pull down, and which to leave.
 *
 * Exported and pure so it can be tested without React. It was a private loop
 * inside the effect first, and the test for it had to restate the rule - two
 * copies that would drift the moment either changed, with the test still
 * green. This is the real one.
 *
 * Most recent first: if something has to be left out it should be the one
 * untouched for months, not the one being worked on yesterday.
 */
export const chooseRestorable = (
  all: StoredDataset[]
): { take: StoredDataset[]; leave: StoredDataset[] } => {
  const ready = all.filter(entry => entry.status === 'ready').sort(newestFirst);
  const take: StoredDataset[] = [];
  const leave: StoredDataset[] = [];
  let budget = RESTORE_ROW_BUDGET;

  for (const entry of ready) {
    // A dataset bigger than the whole budget can never satisfy a
    // remaining-budget test, so a user whose only dataset is large would get
    // an empty app on every visit with everything apparently working. It is
    // allowed through when nothing has been taken yet - and only then, or the
    // rule would read as "always load the biggest thing you have".
    const affordable = entry.rowCount <= budget || take.length === 0;
    if (!affordable) {
      leave.push(entry);
      continue;
    }
    take.push(entry);
    budget -= entry.rowCount;
  }

  return { take, leave };
};

export const useStoredDatasets = (token: string | null) => {
  const [state, setState] = useState<StoredDatasetsState>(EMPTY);

  // React runs effects twice in development's strict mode, and restoring
  // twice would show the user each dataset two times. The ref is keyed by
  // token so a sign-out and sign-in as somebody else still restores.
  const restoredFor = useRef<string | null>(null);

  useEffect(() => {
    if (!token) {
      restoredFor.current = null;
      setState(EMPTY);
      return;
    }
    if (restoredFor.current === token) return;
    restoredFor.current = token;

    let cancelled = false;
    setState({ ...EMPTY, status: 'restoring' });

    (async () => {
      try {
        const { take, leave } = chooseRestorable(await listStoredDatasets(token));

        const restored: Dataset[] = [];
        for (const header of take) {
          const rows = await loadDatasetRows(header, token);
          if (cancelled) return;
          restored.push(toDataset(header, rows, analyzeColumn));
        }

        if (cancelled) return;
        setState({ status: 'done', restored, skipped: leave, error: null, saving: null });
      } catch (error) {
        if (cancelled) return;
        setState({
          ...EMPTY,
          status: 'failed',
          error: error instanceof Error ? error.message : 'Stored datasets could not be loaded.',
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [token]);

  /**
   * Store a dataset, returning whether it was stored.
   *
   * Never throws. The caller has just finished a successful upload and the
   * dataset is already usable; the only question this answers is whether it
   * will still be there next time.
   */
  const save = useCallback(
    async (dataset: Dataset): Promise<{ stored: boolean; reason?: string }> => {
      if (!token) return { stored: false, reason: 'not signed in' };
      setState(current => ({ ...current, saving: dataset.name }));
      try {
        await saveDataset(dataset, token);
        return { stored: true };
      } catch (error) {
        return {
          stored: false,
          reason: error instanceof Error ? error.message : 'the server refused it',
        };
      } finally {
        setState(current => ({ ...current, saving: null }));
      }
    },
    [token]
  );

  return { ...state, save };
};
