import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Upload, FileText, BarChart3, Send, CheckCircle, Clock, Users } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { toast } from 'sonner';
import { createSupportMailto, getApiUrl } from '@/lib/publicConfig';
import SeoMeta from '@/components/SeoMeta';

const RequestReportPage: React.FC = () => {
  const { user } = useAuth();
  const [submitted, setSubmitted] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: user?.email || '',
    company: '',
    reportType: '',
    description: '',
    timeline: '',
    budget: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.email || !formData.reportType || !formData.description) {
      toast.error('Please fill in all required fields.');
      return;
    }

    try {
      const response = await fetch(getApiUrl('/api/reports/request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        setSubmitted(true);
      } else {
        // Fallback: open mailto
        window.location.href = createSupportMailto(`Report Request: ${formData.reportType}`,
          `Name: ${formData.name}\nEmail: ${formData.email}\nCompany: ${formData.company}\nReport Type: ${formData.reportType}\nTimeline: ${formData.timeline}\nBudget: ${formData.budget}\n\nDescription:\n${formData.description}`
        );
        setSubmitted(true);
      }
    } catch {
      // Fallback: open mailto
      window.location.href = createSupportMailto(`Report Request: ${formData.reportType}`,
        `Name: ${formData.name}\nEmail: ${formData.email}\nCompany: ${formData.company}\nReport Type: ${formData.reportType}\nTimeline: ${formData.timeline}\nBudget: ${formData.budget}\n\nDescription:\n${formData.description}`
      );
      setSubmitted(true);
    }
  };

  if (submitted) {
    return (
      <div className="min-h-screen bg-white">
        <SeoMeta
          title="Report Request Submitted | DataAfrik"
          description="Your report request has been received. The DataAfrik team will respond shortly."
          path="/request-report"
          noindex
        />
        <Navbar />
        <main className="pt-16">
          <section className="py-20">
            <div className="max-w-2xl mx-auto px-4 text-center">
              <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
                <CheckCircle className="h-10 w-10 text-green-600" />
              </div>
              <h2 className="text-3xl font-bold text-gray-900 mb-4">Request Submitted!</h2>
              <p className="text-lg text-gray-600 mb-8">
                Thank you for your interest. Our team will review your request and get back to you within 24 hours with a proposal and quote.
              </p>
              <Button onClick={() => setSubmitted(false)} variant="outline">Submit Another Request</Button>
            </div>
          </section>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      <SeoMeta
        title="Request a Custom Report | DataAfrik"
        description="Request a tailored data or finance report from the DataAfrik team."
        path="/request-report"
      />
      <Navbar />
      <main className="pt-16">
        {/* Hero */}
        <section className="py-16 bg-gradient-to-br from-blue-600 to-purple-700 text-white">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <h1 className="text-4xl md:text-5xl font-bold mb-4">
              Let Our Experts Write Your Report
            </h1>
            <p className="text-xl text-blue-100 max-w-3xl mx-auto">
              Get a comprehensive, professional data analysis report crafted by our experienced analysts.
              Upload your data, describe your needs, and we'll deliver actionable insights.
            </p>
          </div>
        </section>

        {/* How It Works */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">How It Works</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="text-center">
                <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="h-8 w-8 text-blue-600" />
                </div>
                <h3 className="text-xl font-semibold mb-2">1. Share Your Data</h3>
                <p className="text-gray-600">Upload your datasets or describe the data you need analyzed.</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <BarChart3 className="h-8 w-8 text-purple-600" />
                </div>
                <h3 className="text-xl font-semibold mb-2">2. We Analyze</h3>
                <p className="text-gray-600">Our analysts perform deep analysis, create visualizations, and uncover insights.</p>
              </div>
              <div className="text-center">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <FileText className="h-8 w-8 text-green-600" />
                </div>
                <h3 className="text-xl font-semibold mb-2">3. Receive Your Report</h3>
                <p className="text-gray-600">Get a professional, presentation-ready report with recommendations.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Request Form */}
        <section className="py-16">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <Card className="shadow-lg">
              <CardHeader>
                <CardTitle className="text-2xl">Request a Custom Report</CardTitle>
              </CardHeader>
              <CardContent>
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Full Name *</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                        placeholder="Your full name"
                        required
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="email">Email Address *</Label>
                      <Input
                        id="email"
                        type="email"
                        value={formData.email}
                        onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                        placeholder="you@company.com"
                        required
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="company">Company / Organization</Label>
                    <Input
                      id="company"
                      value={formData.company}
                      onChange={(e) => setFormData(prev => ({ ...prev, company: e.target.value }))}
                      placeholder="Your company name"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="reportType">Report Type *</Label>
                    <Select value={formData.reportType} onValueChange={(val) => setFormData(prev => ({ ...prev, reportType: val }))}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select report type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="data-analysis">Data Analysis Report</SelectItem>
                        <SelectItem value="market-research">Market Research Report</SelectItem>
                        <SelectItem value="financial-analysis">Financial Analysis Report</SelectItem>
                        <SelectItem value="dashboard-design">Dashboard Design & Development</SelectItem>
                        <SelectItem value="custom">Custom Report</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Describe What You Need *</Label>
                    <Textarea
                      id="description"
                      value={formData.description}
                      onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                      placeholder="Describe the data you have, the questions you want answered, and any specific requirements..."
                      rows={5}
                      required
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="timeline">Preferred Timeline</Label>
                      <Select value={formData.timeline} onValueChange={(val) => setFormData(prev => ({ ...prev, timeline: val }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select timeline" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="standard">Standard (5 business days)</SelectItem>
                          <SelectItem value="rush">Rush (2 business days)</SelectItem>
                          <SelectItem value="express">Express (24 hours)</SelectItem>
                          <SelectItem value="flexible">Flexible</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="budget">Budget Range</Label>
                      <Select value={formData.budget} onValueChange={(val) => setFormData(prev => ({ ...prev, budget: val }))}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select budget range" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="under-100">Under $100</SelectItem>
                          <SelectItem value="100-500">$100 - $500</SelectItem>
                          <SelectItem value="500-1000">$500 - $1,000</SelectItem>
                          <SelectItem value="1000-5000">$1,000 - $5,000</SelectItem>
                          <SelectItem value="5000+">$5,000+</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Button type="submit" size="lg" className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                    <Send className="h-4 w-4 mr-2" />
                    Submit Request
                  </Button>
                </form>
              </CardContent>
            </Card>
          </div>
        </section>

        {/* FAQ */}
        <section className="py-16 bg-gray-50">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
            <h2 className="text-3xl font-bold text-gray-900 text-center mb-12">Frequently Asked Questions</h2>
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="font-semibold text-gray-900 mb-2">What data formats do you accept?</h3>
                <p className="text-gray-600">We accept CSV, Excel (.xlsx, .xls), JSON, SQL databases, and most common data formats. If you have a unique format, let us know and we'll accommodate it.</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="font-semibold text-gray-900 mb-2">How is my data kept secure?</h3>
                <p className="text-gray-600">Your data is encrypted in transit and at rest. We sign NDAs upon request and delete all data after report delivery unless otherwise agreed.</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="font-semibold text-gray-900 mb-2">What's included in a report?</h3>
                <p className="text-gray-600">Reports typically include an executive summary, detailed analysis, visualizations, statistical findings, and actionable recommendations. Each report is customized to your needs.</p>
              </div>
              <div className="bg-white p-6 rounded-lg shadow-sm">
                <h3 className="font-semibold text-gray-900 mb-2">Can I request revisions?</h3>
                <p className="text-gray-600">Yes, each report includes one round of revisions at no extra cost. Additional revision rounds can be arranged as needed.</p>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
};

export default RequestReportPage;
