import React from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

interface PricingTier {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  ctaLink: string;
  highlighted?: boolean;
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

const PricingCards: React.FC = () => {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-6xl mx-auto">
      {tiers.map((tier) => (
        <Card
          key={tier.name}
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
