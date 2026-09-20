import React, { useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { runMeasureLibrary, toPowerBiScript } from '@/lib/measures';
import type { MeasurePack, MeasureResult } from '@/lib/measures';
import type { SemanticModel } from '@/lib/semantic/types';
import { Library, Copy, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

/**
 * The measure library, bound to whatever data is loaded.
 *
 * Every measure here is one the model can actually support: the templates
 * are filtered by column role before they are offered, so a sum of money is
 * never offered a customer id. What is shown is what ran - the DAX in the
 * panel is the text the engine evaluated and the text that exports, not a
 * rendering of it for display.
 *
 * Eighteen of these are verified against Power BI on a fixture model. That
 * verification covers the formulas, not this binding: which column lands in
 * which slot depends on the data, which is why every measure can show the
 * columns it chose and why.
 */

interface MeasureLibraryPanelProps {
  /** Null before any data is loaded. */
  model: SemanticModel | null;
}

const PACK_ORDER: MeasurePack[] = ['sales', 'finance', 'customer', 'inventory', 'operations'];

const PACK_LABELS: Record<MeasurePack, string> = {
  sales: 'Sales',
  finance: 'Finance',
  customer: 'Customer',
  inventory: 'Inventory',
  operations: 'Operations',
};

const copy = (text: string, what: string) => {
  navigator.clipboard.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error('Could not copy to the clipboard')
  );
};

/** One measure: its value, what it means, and on request how it was built. */
const MeasureCard = ({ result }: { result: MeasureResult }) => {
  const [open, setOpen] = useState(false);
  const { measure } = result;

  return (
    <Card className="p-4">
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-medium leading-tight">{measure.name}</h4>
          <Badge variant="secondary" className="shrink-0">
            {PACK_LABELS[measure.template.pack]}
          </Badge>
        </div>

        {result.error ? (
          <div className="rounded border border-red-200 bg-red-50 p-2">
            <p className="text-xs font-medium text-red-700">This could not be calculated</p>
            <p className="mt-1 text-xs text-red-600">{result.error}</p>
          </div>
        ) : (
          <>
            <div className="text-2xl font-bold text-blue-600">{result.formatted}</div>
            {/* The interpretation exists only alongside a value, by
                construction - narrating a number that is not there is how a
                report ends up confidently describing nothing. */}
            <p className="text-sm text-gray-600">{result.interpretation}</p>
          </>
        )}

        <button
          type="button"
          onClick={() => setOpen(value => !value)}
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800"
        >
          {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {open ? 'Hide' : 'Show'} the columns and the DAX
        </button>

        {open && (
          <div className="space-y-2 border-t pt-2">
            <div className="space-y-1">
              {measure.bindings.map(binding => (
                <p key={binding.slot.name} className="text-xs text-gray-600">
                  <span className="font-medium">{binding.slot.name}</span>: {binding.reason}
                </p>
              ))}
            </div>
            <div className="relative">
              <pre className="whitespace-pre-wrap break-words rounded bg-gray-100 p-2 pr-8 text-xs">
                {measure.dax}
              </pre>
              <button
                type="button"
                onClick={() => copy(measure.dax, measure.name)}
                className="absolute right-1 top-1 rounded p-1 text-gray-500 hover:bg-gray-200"
                aria-label={`Copy the DAX for ${measure.name}`}
              >
                <Copy className="h-3 w-3" />
              </button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};

export const MeasureLibraryPanel = ({ model }: MeasureLibraryPanelProps) => {
  /**
   * Resolving reads column metadata only; evaluating walks the rows. Keyed
   * on the model so it runs once per upload rather than once per render -
   * the model object is replaced when the data changes, which is exactly
   * when these numbers stop being true.
   */
  const results = useMemo(() => (model ? runMeasureLibrary(model) : []), [model]);

  const grouped = useMemo(() => {
    const byPack = new Map<MeasurePack, MeasureResult[]>();
    for (const result of results) {
      const pack = result.measure.template.pack;
      const list = byPack.get(pack);
      if (list) list.push(result);
      else byPack.set(pack, [result]);
    }
    return PACK_ORDER.filter(pack => byPack.has(pack)).map(pack => ({
      pack,
      measures: byPack.get(pack)!,
    }));
  }, [results]);

  const failures = results.filter(result => result.error).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2">
            <Library className="h-5 w-5" />
            Measure Library
          </CardTitle>
          {results.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                copy(
                  toPowerBiScript(results.map(result => result.measure)),
                  `${results.length} measures`
                )
              }
            >
              <Copy className="mr-2 h-4 w-4" />
              Copy all as Power BI measures
            </Button>
          )}
        </div>
        {results.length > 0 && (
          <p className="mt-2 text-sm text-gray-500">
            {results.length} measures this model supports, bound to its own columns.
            {failures > 0 && ` ${failures} could not be calculated.`}
          </p>
        )}
      </CardHeader>
      <CardContent>
        {!model ? (
          <div className="py-8 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <p className="text-gray-500">
              Upload data and click "Apply &amp; Analyze Data" to see the measures it supports.
            </p>
          </div>
        ) : results.length === 0 ? (
          <div className="py-8 text-center">
            <AlertCircle className="mx-auto mb-4 h-12 w-12 text-gray-400" />
            <p className="mb-2 text-gray-500">No measure fits this data.</p>
            {/* Naming the requirement beats "no results": the fix is almost
                always a column the model read as an id or a label rather
                than a quantity. */}
            <p className="text-sm text-gray-400">
              These measures need at least one numeric column the model reads as a quantity
              to sum or average. Time-based measures also need a date column joined to a
              calendar.
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {grouped.map(group => (
              <div key={group.pack} className="space-y-3">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                  {PACK_LABELS[group.pack]}
                </h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {group.measures.map(result => (
                    <MeasureCard key={result.measure.id} result={result} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MeasureLibraryPanel;
