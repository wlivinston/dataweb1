import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Phone, MapPin, Linkedin, Github } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getFlagEmoji } from '@/lib/utils';
import { toast } from 'sonner';
import { PUBLIC_CONFIG } from '@/lib/publicConfig';
import { subscribeToNewsletter } from '@/lib/newsletter';
import { useAuth } from '@/hooks/useAuth';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { user } = useAuth();

  const handleNewsletterSubmit = async () => {
    if (!user) {
      toast.error('Please create an account or log in to subscribe to the newsletter.');
      return;
    }

    const emailToUse = email.trim() || user.email || '';
    if (!emailToUse) {
      toast.error('Unable to determine your account email.');
      return;
    }

    setIsSubmitting(true);
    try {
      await subscribeToNewsletter({ email: emailToUse, source: 'footer' });
      toast.success('You are subscribed. Check your inbox for confirmation.');
      setEmail('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to subscribe.';
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <footer className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Company Info */}
          <div>
            <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-4">
              {PUBLIC_CONFIG.brandName}
            </h3>
            <p className="text-gray-300 mb-4">
              Transforming businesses through innovative data science solutions and actionable insights.
            </p>
            <div className="flex space-x-4">
              {PUBLIC_CONFIG.linkedinUrl && (
                <a
                  href={PUBLIC_CONFIG.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-300 hover:text-white transition"
                >
                  <Linkedin className="h-5 w-5" />
                </a>
              )}
              {PUBLIC_CONFIG.githubUrl && (
                <a
                  href={PUBLIC_CONFIG.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-300 hover:text-white transition"
                >
                  <Github className="h-5 w-5" />
                </a>
              )}
            </div>
          </div>

          {/* Services */}
          <div>
            <h4 className="text-lg font-semibold mb-4">Services</h4>
            <ul className="space-y-2 text-gray-300">
              <li><Link to="/analyze" className="hover:text-white transition-colors">Data Analysis Tool</Link></li>
              <li><Link to="/pricing" className="hover:text-white transition-colors">PDF Reports</Link></li>
              <li><Link to="/request-report" className="hover:text-white transition-colors">Custom Report Writing</Link></li>
              <li><Link to="/blog" className="hover:text-white transition-colors">Blog & Insights</Link></li>
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h4 className="text-lg font-semibold mb-4">Contact</h4>
            <div className="space-y-3 text-gray-300">
              {PUBLIC_CONFIG.supportEmail && (
                <div className="flex items-center">
                  <Mail className="h-4 w-4 mr-2" />
                  <a className="text-sm hover:text-white" href={`mailto:${PUBLIC_CONFIG.supportEmail}`}>
                    {PUBLIC_CONFIG.supportEmail}
                  </a>
                </div>
              )}
              {PUBLIC_CONFIG.phoneGh && (
                <div className="flex items-center">
                  <Phone className="h-4 w-4 mr-2" />
                  <span className="text-sm">{getFlagEmoji('GH')} {PUBLIC_CONFIG.phoneGh}</span>
                </div>
              )}
              {PUBLIC_CONFIG.phoneUs && (
                <div className="flex items-center">
                  <Phone className="h-4 w-4 mr-2" />
                  <span className="text-sm">{getFlagEmoji('US')} {PUBLIC_CONFIG.phoneUs}</span>
                </div>
              )}
              {PUBLIC_CONFIG.locationText && (
                <div className="flex items-center">
                  <MapPin className="h-4 w-4 mr-2" />
                  <span className="text-sm">{PUBLIC_CONFIG.locationText}</span>
                </div>
              )}
            </div>
          </div>

          {/* Newsletter */}
          <div id="newsletter">
            <h4 className="text-lg font-semibold mb-4">Newsletter</h4>
            <p className="text-gray-300 text-sm mb-4">
              Subscribe to get the latest insights and updates.
            </p>
            <div className="flex flex-col space-y-2">
              <Input
                type="email"
                placeholder={user ? 'Enter your email' : 'Log in to subscribe'}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleNewsletterSubmit();
                  }
                }}
                disabled={!user}
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-400"
              />
              <Button
                size="sm"
                disabled={isSubmitting || !user}
                onClick={handleNewsletterSubmit}
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
              >
                {isSubmitting ? 'Subscribing...' : user ? 'Subscribe' : 'Login to Subscribe'}
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 text-center">
          <p className="text-gray-400 text-sm">
            &copy; {currentYear} {PUBLIC_CONFIG.brandName}. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
