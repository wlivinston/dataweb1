import React from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import PricingCards from '@/components/PricingCards';
import SeoMeta from '@/components/SeoMeta';

const PricingPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <SeoMeta
        title="Pricing | DataAfrik"
        description="Explore transparent pricing for DataAfrik analytics, finance intelligence, and report generation tools."
        path="/pricing"
      />
      <Navbar />
      <main className="pt-16">
        <section className="py-20 bg-gradient-to-br from-gray-50 to-blue-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h1 className="text-4xl md:text-5xl font-bold text-gray-900 mb-4">
                Simple, Transparent Pricing
              </h1>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Choose the plan that fits your data analysis needs. Start free, upgrade when you're ready.
              </p>
            </div>
            <PricingCards />
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default PricingPage;
