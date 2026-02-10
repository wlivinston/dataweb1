import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Mail, Phone, MapPin, Linkedin, Github } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getFlagEmoji } from '@/lib/utils';

const Footer: React.FC = () => {
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-gray-900 text-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* Company Info */}
          <div>
            <h3 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent mb-4">
              DataAfrik
            </h3>
            <p className="text-gray-300 mb-4">
              Transforming businesses through innovative data science solutions and actionable insights.
            </p>
            <div className="flex space-x-4">
              <a
                href="https://www.linkedin.com/in/senyo-tsedze-4877"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 hover:text-white transition"
              >
                <Linkedin className="h-5 w-5" />
              </a>
              <a
                href="https://github.com/wlivinston"
                target="_blank"
                rel="noopener noreferrer"
                className="text-gray-300 hover:text-white transition"
              >
                <Github className="h-5 w-5" />
              </a>
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
              <div className="flex items-center">
                <Mail className="h-4 w-4 mr-2" />
                <span className="text-sm">senyo@diaspora-n.com</span>
              </div>
              <div className="flex items-center">
                <Phone className="h-4 w-4 mr-2" />
                <span className="text-sm">{getFlagEmoji('GH')} +233 534 787 731</span>
              </div>
              <div className="flex items-center">
                <Phone className="h-4 w-4 mr-2" />
                <span className="text-sm">{getFlagEmoji('US')} +1 914 433 7155</span>
              </div>
              <div className="flex items-center">
                <MapPin className="h-4 w-4 mr-2" />
                <span className="text-sm">
                  {getFlagEmoji('GH')} Accra, Ghana & {getFlagEmoji('US')} New York, USA
                </span>
              </div>
            </div>
          </div>

          {/* Newsletter */}
          <div>
            <h4 className="text-lg font-semibold mb-4">Newsletter</h4>
            <p className="text-gray-300 text-sm mb-4">
              Subscribe to get the latest insights and updates.
            </p>
            <div className="flex flex-col space-y-2">
              <Input
                type="email"
                placeholder="Enter your email"
                className="bg-gray-800 border-gray-700 text-white placeholder-gray-400"
              />
              <Button size="sm" className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700">
                Subscribe
              </Button>
            </div>
          </div>
        </div>

        <div className="border-t border-gray-800 mt-8 pt-8 text-center">
          <p className="text-gray-400 text-sm">
            &copy; {currentYear} DataAfrik. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
