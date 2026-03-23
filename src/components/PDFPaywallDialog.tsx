import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, FileText, Mail, ArrowRight, Loader2, AlertCircle, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createSupportMailto, getApiUrl } from '@/lib/publicConfig';

const CURRENCY_OPTIONS = [
  { code: 'USD', label: 'USD - US Dollar', flag: '\u{1F1FA}\u{1F1F8}' },
  { code: 'NGN', label: 'NGN - Nigerian Naira', flag: '\u{1F1F3}\u{1F1EC}' },
  { code: 'GHS', label: 'GHS - Ghanaian Cedi', flag: '\u{1F1EC}\u{1F1ED}' },
  { code: 'ZAR', label: 'ZAR - South African Rand', flag: '\u{1F1FF}\u{1F1E6}' },
  { code: 'KES', label: 'KES - Kenyan Shilling', flag: '\u{1F1F0}\u{1F1EA}' },
] as const;

const PAYSTACK_CURRENCIES = new Set(['NGN', 'GHS', 'ZAR', 'KES']);

function deriveProvider(currency: string): 'stripe' | 'paystack' {
  return PAYSTACK_CURRENCIES.has(currency.toUpperCase()) ? 'paystack' : 'stripe';
}

interface CurrencyPricingPreview {
  amount: number;
  currency: string;
  provider: string;
  base_currency?: string | null;
  converted_from_currency?: string | null;
  exchange_rate?: number | null;
  auto_converted?: boolean;
}

interface PDFPricingCurrencyPayload {
  single: CurrencyPricingPreview;
  monthly: CurrencyPricingPreview;
}

interface PDFPaywallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContactClick?: () => void;
  /** New unified callback: provider is auto-derived from currency */
  onCheckout?: (plan: 'single' | 'monthly', currency: string) => Promise<void> | void;
  /** @deprecated use onCheckout */
  onStripeCheckout?: (plan: 'single' | 'monthly') => Promise<void> | void;
  /** @deprecated use onCheckout */
  onPaystackCheckout?: (plan: 'single' | 'monthly') => Promise<void> | void;
  checkoutLoading?: boolean;
  /** @deprecated use checkoutLoading */
  checkoutLoadingProvider?: 'stripe' | 'paystack' | null;
}

const PDFPaywallDialog: React.FC<PDFPaywallDialogProps> = ({
  open,
  onOpenChange,
  onContactClick,
  onCheckout,
  onStripeCheckout,
  onPaystackCheckout,
  checkoutLoading,
  checkoutLoadingProvider = null,
}) => {
  const [selectedCurrency, setSelectedCurrency] = useState('USD');
  const [pricingPreview, setPricingPreview] = useState<PDFPricingCurrencyPayload | null>(null);
  const [pricingLoading, setPricingLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isBusy = checkoutLoading || checkoutLoadingProvider !== null;
  const provider = deriveProvider(selectedCurrency);
  const hasCheckout = Boolean(onCheckout || onStripeCheckout || onPaystackCheckout);

  useEffect(() => {
    if (open) setCheckoutError(null);
  }, [open]);

  // Fetch pricing when dialog opens or currency changes
  useEffect(() => {
    if (!open) return;

    const controller = new AbortController();

    const fetchPricing = async () => {
      setPricingLoading(true);
      try {
        const url = getApiUrl(`/api/subscriptions/pdf-pricing?currency=${encodeURIComponent(selectedCurrency)}`);
        const response = await fetch(url, { signal: controller.signal });
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.data) {
          setPricingPreview(payload.data);
        }
      } catch (_error) {
        // Keep previous pricing on failure
      } finally {
        setPricingLoading(false);
      }
    };

    // Debounce currency changes
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(fetchPricing, 250);

    return () => {
      controller.abort();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [open, selectedCurrency]);

  const formatMoney = (amount: number, currency: string) => {
    const normalized = String(currency || 'USD').toUpperCase();
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: normalized,
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${normalized} ${amount.toFixed(2)}`;
    }
  };

  const singlePrice = useMemo(() => {
    if (pricingPreview?.single) {
      return formatMoney(pricingPreview.single.amount, pricingPreview.single.currency);
    }
    return formatMoney(29, 'USD');
  }, [pricingPreview]);

  const monthlyPrice = useMemo(() => {
    if (pricingPreview?.monthly) {
      return formatMoney(pricingPreview.monthly.amount, pricingPreview.monthly.currency);
    }
    return formatMoney(49, 'USD');
  }, [pricingPreview]);

  const safeCheckout = async (plan: 'single' | 'monthly') => {
    setCheckoutError(null);
    try {
      if (onCheckout) {
        await onCheckout(plan, selectedCurrency);
      } else if (provider === 'paystack' && onPaystackCheckout) {
        await onPaystackCheckout(plan);
      } else if (onStripeCheckout) {
        await onStripeCheckout(plan);
      }
    } catch (err: any) {
      const msg = err?.message || 'Payment checkout failed. Please try again.';
      console.error('[PDFPaywallDialog] checkout error:', msg);
      setCheckoutError(msg);
    }
  };

  const handleContact = (subject: string) => {
    window.location.href = createSupportMailto(subject,
      'Hi DataAfrik team,\n\nI would like to purchase a PDF report of my data analysis.\n\nPlease send me the details.\n\nThank you.'
    );
    onContactClick?.();
    onOpenChange(false);
  };

  const providerLabel = provider === 'paystack' ? 'Paystack' : 'Stripe';
  const buttonGradient = provider === 'paystack'
    ? 'bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-600 hover:to-green-700'
    : 'bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg md:max-w-xl">
        <DialogHeader>
          <DialogTitle className="text-lg sm:text-2xl flex items-center gap-2">
            <FileText className="h-5 w-5 sm:h-6 sm:w-6 text-blue-600 shrink-0" />
            Download Your PDF Report
          </DialogTitle>
          <DialogDescription className="text-xs sm:text-sm">
            Get a professional PDF report of your data analysis with AI-powered insights.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 sm:space-y-4 mt-2 sm:mt-4">
          {/* Currency selector */}
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="currency-select" className="text-sm font-medium text-gray-700 whitespace-nowrap">
              Currency:
            </label>
            <div className="relative flex-1 min-w-[140px]">
              <select
                id="currency-select"
                value={selectedCurrency}
                onChange={(e) => setSelectedCurrency(e.target.value)}
                disabled={isBusy}
                className="w-full appearance-none rounded-md border border-gray-300 bg-white py-2 pl-3 pr-8 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
              >
                {CURRENCY_OPTIONS.map((opt) => (
                  <option key={opt.code} value={opt.code}>
                    {opt.flag} {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              via {providerLabel}
            </span>
          </div>

          {/* Inline error banner */}
          {checkoutError && (
            <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />
              <span>{checkoutError}</span>
            </div>
          )}

          {/* Per-report option */}
          <div className="border-2 border-blue-600 rounded-lg p-3 sm:p-4 relative">
            <Badge className="absolute -top-2.5 left-4 bg-blue-600 text-xs">Recommended</Badge>
            <div className="flex justify-between items-start mt-1 gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 text-sm sm:text-base">Single Report</h3>
                <p className="text-xs sm:text-sm text-gray-600 mt-0.5 sm:mt-1">Full PDF with all visualizations & insights</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-lg sm:text-2xl font-bold text-gray-900">
                  {pricingLoading ? '...' : singlePrice}
                </span>
                <span className="text-gray-500 text-xs sm:text-sm block">per report</span>
              </div>
            </div>
            <ul className="mt-2 sm:mt-3 space-y-0.5 sm:space-y-1">
              <li className="flex items-center text-xs sm:text-sm text-gray-700">
                <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-green-500 mr-1.5 sm:mr-2 shrink-0" /> Executive summary
              </li>
              <li className="flex items-center text-xs sm:text-sm text-gray-700">
                <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-green-500 mr-1.5 sm:mr-2 shrink-0" /> All charts & visualizations
              </li>
              <li className="flex items-center text-xs sm:text-sm text-gray-700">
                <Check className="h-3 w-3 sm:h-3.5 sm:w-3.5 text-green-500 mr-1.5 sm:mr-2 shrink-0" /> AI insights & recommendations
              </li>
            </ul>
            {hasCheckout ? (
              <Button
                className={`w-full mt-3 sm:mt-4 ${buttonGradient} text-white text-xs sm:text-sm px-3 sm:px-4 py-2.5 sm:py-3 h-auto`}
                disabled={isBusy || pricingLoading}
                onClick={() => safeCheckout('single')}
              >
                {isBusy ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting to {providerLabel}...</>
                ) : (
                  <>Pay with {providerLabel} ({singlePrice})</>
                )}
              </Button>
            ) : (
              <Button
                className="w-full mt-3 sm:mt-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-xs sm:text-sm"
                onClick={() => handleContact(`PDF Report Purchase - Single Report (${singlePrice})`)}
              >
                <Mail className="h-4 w-4 mr-2 shrink-0" />
                Get This Report &mdash; {singlePrice}
              </Button>
            )}
          </div>

          {/* Monthly option */}
          <div className="border rounded-lg p-3 sm:p-4">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 text-sm sm:text-base">Monthly Plan</h3>
                <p className="text-xs sm:text-sm text-gray-600 mt-0.5 sm:mt-1">Unlimited PDF reports per month</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-lg sm:text-2xl font-bold text-gray-900">
                  {pricingLoading ? '...' : monthlyPrice}
                </span>
                <span className="text-gray-500 text-xs sm:text-sm block">per month</span>
              </div>
            </div>
            {hasCheckout ? (
              <Button
                className={`w-full mt-3 sm:mt-4 ${buttonGradient} text-white text-xs sm:text-sm px-3 sm:px-4 py-2.5 sm:py-3 h-auto`}
                disabled={isBusy || pricingLoading}
                onClick={() => safeCheckout('monthly')}
              >
                {isBusy ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting to {providerLabel}...</>
                ) : (
                  <>{providerLabel} Monthly ({monthlyPrice})</>
                )}
              </Button>
            ) : (
              <Button
                variant="outline"
                className="w-full mt-3 sm:mt-4 text-xs sm:text-sm"
                onClick={() => handleContact(`PDF Report Subscription - Monthly Plan (${monthlyPrice}/mo)`)}
              >
                Subscribe for Unlimited Reports
              </Button>
            )}
          </div>

          {/* Expert option */}
          <div className="border rounded-lg p-3 sm:p-4 bg-gray-50">
            <div className="flex justify-between items-start gap-2">
              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 text-sm sm:text-base">Expert-Written Report</h3>
                <p className="text-xs sm:text-sm text-gray-600 mt-0.5 sm:mt-1">Our analysts write a custom report for you</p>
              </div>
              <div className="text-right shrink-0">
                <span className="text-sm sm:text-lg font-bold text-gray-900">Custom</span>
              </div>
            </div>
            <Link to="/request-report" onClick={() => onOpenChange(false)}>
              <Button variant="outline" className="w-full mt-3 sm:mt-4 text-xs sm:text-sm">
                Request Expert Report <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default PDFPaywallDialog;
