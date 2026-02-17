import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getApiUrl } from '@/lib/publicConfig';

interface PricingTier {
  code?: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  ctaLink: string;
  highlighted?: boolean;
  sortOrder?: number;
}

const tiers: PricingTier[] = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    description: 'Get started with data exploration and basic analysis.',
    features: [
      'Upload CSV, Excel & JSON files',
      'Basic visualizations (bar, line, pie)',
      'AI insights preview',
      'Data cleaning tools',
      'Statistical summaries',
      'Up to 3 datasets',
    ],
    cta: 'Get Started Free',
    ctaLink: '/analyze',
  },
  {
    name: 'Professional',
    price: '$29',
    period: 'per report',
    description: 'Full analysis reports with AI-powered insights and professional formatting.',
    features: [
      'Everything in Free',
      'Full PDF report download',
      'Enhanced AI analysis',
      'DAX calculations & formulas',
      'Correlation matrix',
      'Natural language querying',
      'Unlimited datasets',
      'Priority support',
    ],
    cta: 'Get Started',
    ctaLink: '/analyze',
    highlighted: true,
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    period: 'per project',
    description: 'Professional reports written by our data analysts, tailored to your business.',
    features: [
      'Everything in Professional',
      'Custom report written by our experts',
      'Dedicated data analyst',
      'Business recommendations',
      'Presentation-ready deliverables',
      'White-label reports',
      'Phone & video support',
      'NDA & data security',
    ],
    cta: 'Request a Report',
    ctaLink: '/request-report',
  },
];

function formatPrice(price: number): string {
  if (price === 0) return '$0';
  return `$${price.toFixed(0)}`;
}

function formatPeriod(billingCycle: string): string {
  switch (billingCycle) {
    case 'forever':
      return 'forever';
    case 'one_time':
      return 'per report';
    case 'monthly':
      return 'per month';
    case 'quarterly':
      return 'per quarter';
    case 'yearly':
      return 'per year';
    case 'custom':
      return 'per project';
    default:
      return billingCycle;
  }
}

function mapPlanToTier(plan: any): PricingTier {
  const features = Array.isArray(plan.features) ? plan.features : [];
  const code = String(plan.code || '').trim();
  const name = String(plan.name || '').trim();
  const normalizedCode = code.toLowerCase();
  const normalizedName = name.toLowerCase();
  const explicitHighlight = plan.is_highlighted ?? plan.isHighlighted ?? plan.highlighted;
  const inferredHighlight =
    explicitHighlight !== undefined && explicitHighlight !== null
      ? Boolean(explicitHighlight)
      : normalizedCode.includes('professional') || normalizedName.includes('professional');

  return {
    code,
    name,
    price: plan.billing_cycle === 'custom' ? 'Custom' : formatPrice(Number(plan.price || 0)),
    period: formatPeriod(plan.billing_cycle || 'monthly'),
    description: plan.description || '',
    features: features.map((item: unknown) => String(item)),
    cta: plan.cta_label || plan.cta || 'Get Started',
    ctaLink: plan.cta_link || plan.ctaLink || '/analyze',
    highlighted: inferredHighlight,
    sortOrder: Number(plan.sort_order ?? plan.sortOrder ?? 100),
  };
}

const PricingCards: React.FC = () => {
  const [displayTiers, setDisplayTiers] = useState<PricingTier[]>(tiers);

  useEffect(() => {
    let mounted = true;

    const loadPlans = async () => {
      try {
        const response = await fetch(getApiUrl('/api/subscriptions/plans'));
        if (!response.ok) return;

        const payload = await response.json();
        const plans = Array.isArray(payload?.plans) ? payload.plans : [];
        if (!plans.length) return;

        const mapped = plans
          .map(mapPlanToTier)
          .sort((a, b) => (a.sortOrder ?? 100) - (b.sortOrder ?? 100));

        if (!mapped.some((tier) => tier.highlighted)) {
          const professionalIndex = mapped.findIndex((tier) => {
            const code = String(tier.code || '').toLowerCase();
            const name = String(tier.name || '').toLowerCase();
            return code.includes('professional') || name.includes('professional');
          });
          if (professionalIndex >= 0) {
            mapped[professionalIndex] = { ...mapped[professionalIndex], highlighted: true };
          }
        }

        if (mounted) setDisplayTiers(mapped);
      } catch {
        // Fallback to static tiers for resiliency.
      }
    };

    loadPlans();
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
      {displayTiers.map((tier) => (
        <Card
          key={tier.code || tier.name}
          className={`relative flex flex-col ${
            tier.highlighted
              ? 'border-2 border-blue-600 shadow-xl scale-[1.02]'
              : 'border shadow-md'
          }`}
        >
          {tier.highlighted && (
            <div className="absolute -top-3 left-1/2 -translate-x-1/2">
              <Badge className="bg-gradient-to-r from-blue-600 to-purple-600 text-white px-4 py-1">
                Most Popular
              </Badge>
            </div>
          )}
          <CardHeader className="text-center pb-4">
            <CardTitle className="text-xl">{tier.name}</CardTitle>
            <div className="mt-4">
              <span className="text-4xl font-bold text-gray-900">{tier.price}</span>
              <span className="text-gray-500 ml-1">/ {tier.period}</span>
            </div>
            <CardDescription className="mt-2">{tier.description}</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col">
            <ul className="space-y-3 mb-8 flex-1">
              {tier.features.map((feature, i) => (
                <li key={i} className="flex items-start text-sm text-gray-700">
                  <Check className="h-4 w-4 text-green-500 mr-2 mt-0.5 flex-shrink-0" />
                  {feature}
                </li>
              ))}
            </ul>
            <Link to={tier.ctaLink} className="w-full">
              <Button
                className={`w-full ${
                  tier.highlighted
                    ? 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700'
                    : ''
                }`}
                variant={tier.highlighted ? 'default' : 'outline'}
                size="lg"
              >
                {tier.cta}
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </Link>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default PricingCards;
