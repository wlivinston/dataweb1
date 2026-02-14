import React from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, FileText, Mail, ArrowRight, Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { createSupportMailto } from '@/lib/publicConfig';

interface PDFPaywallDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onContactClick?: () => void;
  onStripeCheckout?: (plan: 'single' | 'monthly') => Promise<void> | void;
  onPaystackCheckout?: (plan: 'single' | 'monthly') => Promise<void> | void;
  checkoutLoadingProvider?: 'stripe' | 'paystack' | null;
}

const PDFPaywallDialog: React.FC<PDFPaywallDialogProps> = ({
  open,
  onOpenChange,
  onContactClick,
  onStripeCheckout,
  onPaystackCheckout,
  checkoutLoadingProvider = null,
}) => {
  const showDirectCheckout = Boolean(onStripeCheckout || onPaystackCheckout);
  const isBusy = checkoutLoadingProvider !== null;

  const handleContact = (subject: string) => {
    window.location.href = createSupportMailto(subject,
      'Hi DataAfrik team,\n\nI would like to purchase a PDF report of my data analysis.\n\nPlease send me the details.\n\nThank you.'
    );
    onContactClick?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-2xl flex items-center gap-2">
            <FileText className="h-6 w-6 text-blue-600" />
            Download Your PDF Report
          </DialogTitle>
          <DialogDescription>
            Get a professional PDF report of your data analysis with AI-powered insights.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 mt-4">
          {/* Per-report option */}
          <div className="border-2 border-blue-600 rounded-lg p-4 relative">
            <Badge className="absolute -top-2.5 left-4 bg-blue-600">Recommended</Badge>
            <div className="flex justify-between items-start mt-1">
              <div>
                <h3 className="font-semibold text-gray-900">Single Report</h3>
                <p className="text-sm text-gray-600 mt-1">Full PDF with all visualizations & insights</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-gray-900">$29</span>
                <span className="text-gray-500 text-sm block">per report</span>
              </div>
            </div>
            <ul className="mt-3 space-y-1">
              <li className="flex items-center text-sm text-gray-700">
                <Check className="h-3.5 w-3.5 text-green-500 mr-2" /> Executive summary
              </li>
              <li className="flex items-center text-sm text-gray-700">
                <Check className="h-3.5 w-3.5 text-green-500 mr-2" /> All charts & visualizations
              </li>
              <li className="flex items-center text-sm text-gray-700">
                <Check className="h-3.5 w-3.5 text-green-500 mr-2" /> AI insights & recommendations
              </li>
            </ul>
            {showDirectCheckout ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                <Button
                  className="bg-gradient-to-r from-indigo-600 to-blue-600 hover:from-indigo-700 hover:to-blue-700"
                  disabled={isBusy || !onStripeCheckout}
                  onClick={() => onStripeCheckout?.('single')}
                >
                  {checkoutLoadingProvider === 'stripe' ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting...</>
                  ) : (
                    'Pay with Stripe'
                  )}
                </Button>
                <Button
                  variant="outline"
                  disabled={isBusy || !onPaystackCheckout}
                  onClick={() => onPaystackCheckout?.('single')}
                >
                  {checkoutLoadingProvider === 'paystack' ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting...</>
                  ) : (
                    'Pay with Paystack'
                  )}
                </Button>
              </div>
            ) : (
              <Button
                className="w-full mt-4 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
                onClick={() => handleContact('PDF Report Purchase - Single Report ($29)')}
              >
                <Mail className="h-4 w-4 mr-2" />
                Get This Report &mdash; $29
              </Button>
            )}
          </div>

          {/* Monthly option */}
          <div className="border rounded-lg p-4">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-gray-900">Monthly Plan</h3>
                <p className="text-sm text-gray-600 mt-1">Unlimited PDF reports per month</p>
              </div>
              <div className="text-right">
                <span className="text-2xl font-bold text-gray-900">$49</span>
                <span className="text-gray-500 text-sm block">per month</span>
              </div>
            </div>
            {showDirectCheckout ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-4">
                <Button
                  className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700"
                  disabled={isBusy || !onStripeCheckout}
                  onClick={() => onStripeCheckout?.('monthly')}
                >
                  {checkoutLoadingProvider === 'stripe' ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting...</>
                  ) : (
                    'Stripe Monthly'
                  )}
                </Button>
                <Button
                  variant="outline"
                  disabled={isBusy || !onPaystackCheckout}
                  onClick={() => onPaystackCheckout?.('monthly')}
                >
                  {checkoutLoadingProvider === 'paystack' ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Redirecting...</>
                  ) : (
                    'Paystack Monthly'
                  )}
                </Button>
              </div>
            ) : (
              <Button
                variant="outline"
                className="w-full mt-4"
                onClick={() => handleContact('PDF Report Subscription - Monthly Plan ($49/mo)')}
              >
                Subscribe for Unlimited Reports
              </Button>
            )}
          </div>

          {/* Expert option */}
          <div className="border rounded-lg p-4 bg-gray-50">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-semibold text-gray-900">Expert-Written Report</h3>
                <p className="text-sm text-gray-600 mt-1">Our analysts write a custom report for you</p>
              </div>
              <div className="text-right">
                <span className="text-lg font-bold text-gray-900">Custom</span>
              </div>
            </div>
            <Link to="/request-report" onClick={() => onOpenChange(false)}>
              <Button variant="outline" className="w-full mt-4">
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
