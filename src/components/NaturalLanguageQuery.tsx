// Ask Your Data - questions in plain English, answered through the DAX engine.
//
// Every figure on this screen comes from the engine checked against Power BI.
// The engine this replaced computed its own answers, and its AVERAGE divided
// by a row count that counted blanks as zeros - 15 where the truth was 20,
// presented as a sentence with 95% confidence beside it. There is no
// confidence badge here because the old one was the constant 0.95.

import React, { useState, useEffect, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  MessageSquare, Send, Sparkles, HelpCircle, Lightbulb, ChevronRight, X,
  History, Hash, Copy, Table as TableIcon,
} from 'lucide-react';
import type { SemanticModel } from '@/lib/semantic/types';
import { answerQuestion, suggestQuestions } from '@/lib/nlq';
import type { NlqAnswer } from '@/lib/nlq';
import { toast } from 'sonner';

interface NaturalLanguageQueryProps {
  /** Null before any data is loaded. A question names its own columns, so
   *  there is no "against which dataset" for the caller to answer. */
  model: SemanticModel | null;
}

interface QueryHistoryItem {
  question: string;
  answer: NlqAnswer;
  timestamp: Date;
}

const NaturalLanguageQuery: React.FC<NaturalLanguageQueryProps> = ({ model }) => {
  const [query, setQuery] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [current, setCurrent] = useState<NlqAnswer | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [history, setHistory] = useState<QueryHistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSuggestions(model ? suggestQuestions(model) : []);
    // A model change means the old answer describes data that is no longer
    // loaded. Showing it next to the new data is the stale-model failure.
    setCurrent(null);
  }, [model]);

  const ask = (question: string) => {
    if (!question.trim()) {
      toast.error('Type a question first.');
      return;
    }
    setIsProcessing(true);
    try {
      const answer = answerQuestion(question, model);
      setCurrent(answer);
      setHistory(prev => [
        { question: question.trim(), answer, timestamp: new Date() },
        ...prev.slice(0, 19),
      ]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSubmit = (event?: React.FormEvent) => {
    event?.preventDefault();
    ask(query);
  };

  const use = (question: string) => {
    setQuery(question);
    inputRef.current?.focus();
  };

  if (!model) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-12 text-center">
          <MessageSquare className="mx-auto mb-4 h-16 w-16 text-gray-300" />
          <h3 className="mb-2 text-lg font-medium text-gray-600">Ask Questions in Plain English</h3>
          <p className="mx-auto max-w-md text-sm text-gray-400">
            Upload data and click "Apply &amp; Analyze Data" to start asking questions
            like "What is the total revenue?"
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <CardHeader className="border-b bg-gradient-to-r from-blue-500/10 via-cyan-500/10 to-teal-500/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-blue-100 p-2">
              <MessageSquare className="h-6 w-6 text-blue-600" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                Ask Your Data
                <Badge variant="secondary" className="text-xs">
                  <Sparkles className="mr-1 h-3 w-3" />
                  Natural Language
                </Badge>
              </CardTitle>
              <p className="mt-1 text-sm text-gray-500">
                Answered with DAX, so you can check the working
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowHistory(value => !value)}
            className="text-gray-500"
          >
            <History className="mr-1 h-4 w-4" />
            History ({history.length})
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 p-4">
        <form onSubmit={handleSubmit}>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                ref={inputRef}
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder='Ask a question like "What is the total revenue?"'
                className="h-12 pr-10 text-base"
                disabled={isProcessing}
              />
              {query && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    setCurrent(null);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label="Clear the question"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button
              type="submit"
              disabled={isProcessing || !query.trim()}
              className="h-12 bg-gradient-to-r from-blue-600 to-cyan-600 px-6 hover:from-blue-700 hover:to-cyan-700"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </form>

        {!current && !showHistory && suggestions.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <Lightbulb className="h-4 w-4 text-yellow-500" />
              <span>Try asking:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestions.map(suggestion => (
                <Button
                  key={suggestion}
                  variant="outline"
                  size="sm"
                  onClick={() => use(suggestion)}
                  className="h-8 text-xs hover:border-blue-300 hover:bg-blue-50"
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}

        {showHistory && history.length > 0 && (
          <div className="rounded-lg border bg-gray-50 p-3">
            <h4 className="mb-2 flex items-center gap-2 text-sm font-medium text-gray-700">
              <History className="h-4 w-4" />
              Recent Questions
            </h4>
            <ScrollArea className="h-48">
              <div className="space-y-2">
                {history.map((item, index) => (
                  <button
                    key={index}
                    onClick={() => {
                      setQuery(item.question);
                      setCurrent(item.answer);
                      setShowHistory(false);
                    }}
                    className="w-full rounded p-2 text-left transition-colors hover:bg-white"
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex-1 truncate text-sm text-gray-700">{item.question}</span>
                      <span className="ml-2 text-xs text-gray-400">
                        {item.timestamp.toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {!item.answer.ok
                        ? 'Not answered'
                        : item.answer.shape === 'scalar'
                          ? item.answer.formatted
                          : `${item.answer.totalRows} rows`}
                    </span>
                  </button>
                ))}
              </div>
            </ScrollArea>
          </div>
        )}

        {current && current.ok && current.shape === 'scalar' && (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-green-50 p-3">
              <Hash className="h-4 w-4 text-violet-500" />
              <span className="text-sm font-medium text-gray-700">{current.interpretation}</span>
            </div>
            <div className="bg-white p-4">
              <p className="text-center text-5xl font-bold text-violet-600">
                {current.formatted}
              </p>
              {/* The DAX is shown, not hidden. An answer nobody can check is
                  the thing that let a wrong average run for months. */}
              <div className="relative mt-6">
                <p className="mb-1 text-xs text-gray-500">Worked out as:</p>
                <pre className="whitespace-pre-wrap break-words rounded bg-gray-100 p-2 pr-8 text-xs">
                  {current.dax}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(current.dax).then(
                      () => toast.success('DAX copied'),
                      () => toast.error('Could not copy to the clipboard')
                    );
                  }}
                  className="absolute right-1 top-6 rounded p-1 text-gray-500 hover:bg-gray-200"
                  aria-label="Copy the DAX"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}

        {current && current.ok && current.shape === 'table' && (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-green-50 p-3">
              <TableIcon className="h-4 w-4 text-violet-500" />
              <span className="text-sm font-medium text-gray-700">{current.interpretation}</span>
            </div>
            <div className="bg-white p-4">
              <ScrollArea className="max-h-80">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-gray-50">
                    <tr>
                      {current.columns.map(column => (
                        <th
                          key={column.name}
                          // A figure is right-aligned and a label is not.
                          // Lineage is what tells them apart: a column with
                          // an origin is a value from the data, one without
                          // was computed over it.
                          className={`border-b px-3 py-2 font-medium text-gray-700 ${
                            column.origin ? 'text-left' : 'text-right'
                          }`}
                        >
                          {column.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {current.rows.map((row, index) => (
                      <tr key={index} className="border-b border-gray-100 hover:bg-gray-50">
                        {row.map((cell, position) => (
                          <td
                            key={position}
                            className={`px-3 py-2 ${
                              current.columns[position]?.origin
                                ? 'text-gray-700'
                                : 'text-right font-medium text-violet-600'
                            }`}
                          >
                            {/* A blank group is a real group, and labelling
                                it "(blank)" is the only way a reader can
                                tell it apart from an empty cell. */}
                            {cell === null ? (
                              <span className="italic text-gray-400">(blank)</span>
                            ) : typeof cell === 'number' ? (
                              cell.toLocaleString(undefined, { maximumFractionDigits: 2 })
                            ) : (
                              String(cell)
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>

              {current.truncated && (
                <p className="mt-2 text-xs text-amber-700">
                  Showing {current.rows.length} of {current.totalRows}, ranked so these are
                  the ones worth seeing rather than an arbitrary slice.
                </p>
              )}

              <div className="relative mt-6">
                <p className="mb-1 text-xs text-gray-500">Worked out as:</p>
                <pre className="whitespace-pre-wrap break-words rounded bg-gray-100 p-2 pr-8 text-xs">
                  {current.dax}
                </pre>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(current.dax).then(
                      () => toast.success('DAX copied'),
                      () => toast.error('Could not copy to the clipboard')
                    );
                  }}
                  className="absolute right-1 top-6 rounded p-1 text-gray-500 hover:bg-gray-200"
                  aria-label="Copy the DAX"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            </div>
          </div>
        )}

        {current && !current.ok && (
          <div className="overflow-hidden rounded-lg border">
            <div className="flex items-center gap-2 border-b bg-amber-50 p-3">
              <HelpCircle className="h-4 w-4 text-amber-600" />
              <span className="text-sm font-medium text-gray-700">
                I have not answered that one
              </span>
            </div>
            <div className="bg-white p-4">
              {/* The reason, not a shrug. "I couldn't understand that query"
                  told nobody what to do next. */}
              <p className="text-sm text-gray-700">{current.reason}</p>
              {current.suggestions.length > 0 && (
                <div className="mt-4 border-t pt-4">
                  <p className="mb-2 text-xs text-gray-500">Questions I can answer about this data:</p>
                  <div className="flex flex-wrap gap-2">
                    {current.suggestions.map(suggestion => (
                      <Button
                        key={suggestion}
                        variant="ghost"
                        size="sm"
                        onClick={() => use(suggestion)}
                        className="h-7 text-xs text-blue-600 hover:text-blue-800"
                      >
                        <ChevronRight className="mr-1 h-3 w-3" />
                        {suggestion}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="pt-2 text-center text-xs text-gray-400">
          Totals, averages, counts, breakdowns by column, and ranked lists.
          Grouping by more than one column is not available yet.
        </p>
      </CardContent>
    </Card>
  );
};

export default NaturalLanguageQuery;
