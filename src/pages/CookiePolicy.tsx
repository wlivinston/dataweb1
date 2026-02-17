import React from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import SeoMeta from "@/components/SeoMeta";

const CookiePolicyPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-gray-50 py-12">
      <SeoMeta
        title="Cookie Policy | DataAfrik"
        description="Read the DataAfrik cookie policy and how cookies are used on the site."
        path="/cookie-policy"
      />
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
        <Link to="/" className="mb-6 inline-flex items-center text-sm text-blue-600 hover:text-blue-700">
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back to Home
        </Link>

        <div className="rounded-xl border bg-white p-8 shadow-sm">
          <h1 className="mb-2 text-3xl font-bold text-gray-900">Cookie Policy</h1>
          <p className="mb-8 text-sm text-gray-500">Last updated: February 17, 2026</p>

          <div className="space-y-6 text-gray-700">
            <section>
              <h2 className="mb-2 text-xl font-semibold text-gray-900">What Are Cookies?</h2>
              <p>
                Cookies are small text files stored on your device when you visit a website. They
                help improve performance, remember preferences, and support analytics.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-xl font-semibold text-gray-900">How We Use Cookies</h2>
              <ul className="list-disc space-y-1 pl-5">
                <li>Essential navigation and session continuity</li>
                <li>Performance monitoring and analytics</li>
                <li>Improving features and user experience</li>
              </ul>
            </section>

            <section>
              <h2 className="mb-2 text-xl font-semibold text-gray-900">Your Choices</h2>
              <p>
                You can control cookies through your browser settings. Blocking some cookies may
                affect certain site features.
              </p>
            </section>

            <section>
              <h2 className="mb-2 text-xl font-semibold text-gray-900">Contact</h2>
              <p>
                If you have questions about this policy, contact us at{" "}
                <a
                  href="mailto:senyo@diaspora-n.com"
                  className="text-blue-600 underline underline-offset-2"
                >
                  senyo@diaspora-n.com
                </a>
                .
              </p>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CookiePolicyPage;
