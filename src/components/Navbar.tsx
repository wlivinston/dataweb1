import React from 'react';
import { Button } from '@/components/ui/button';
import { Menu, X, LogIn } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { PUBLIC_CONFIG } from '@/lib/publicConfig';

interface NavbarProps {
  activeSection?: string;
  setActiveSection?: (section: string) => void;
  mobileMenuOpen?: boolean;
  setMobileMenuOpen?: (open: boolean) => void;
}

interface NavItem {
  id: string;
  label: string;
  type: 'section' | 'link';
  href?: string;
}

const navItems: NavItem[] = [
  { id: 'home', label: 'Home', type: 'section' },
  { id: 'services', label: 'Services', type: 'section' },
  { id: 'analyze', label: 'Analyze Your Data', type: 'link', href: '/analyze' },
  { id: 'finance', label: 'Finance', type: 'link', href: '/finance' },
  { id: 'ml-engine', label: 'ML Engine', type: 'link', href: '/ml-engine' },
  { id: 'pricing', label: 'Pricing', type: 'link', href: '/pricing' },
  { id: 'blog', label: 'Blog', type: 'link', href: '/blog' },
  { id: 'about', label: 'Who We Are', type: 'section' },
];

const Navbar: React.FC<NavbarProps> = ({
  activeSection,
  setActiveSection,
  mobileMenuOpen: controlledMobileMenuOpen,
  setMobileMenuOpen: controlledSetMobileMenuOpen,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut, loading } = useAuth();
  const isHomePage = location.pathname === '/';
  const hasLogo = Boolean(PUBLIC_CONFIG.logoUrl);

  const [internalMobileMenuOpen, setInternalMobileMenuOpen] = React.useState(false);
  const mobileMenuOpen = controlledMobileMenuOpen ?? internalMobileMenuOpen;
  const setMobileMenuOpen = controlledSetMobileMenuOpen ?? setInternalMobileMenuOpen;

  const handleNavClick = (item: NavItem) => {
    if (item.type === 'link' && item.href) {
      navigate(item.href);
    } else if (item.type === 'section') {
      if (isHomePage && setActiveSection) {
        setActiveSection(item.id);
      } else {
        navigate(`/?section=${item.id}`);
      }
    }
    setMobileMenuOpen(false);
  };

  const isActive = (item: NavItem): boolean => {
    if (item.type === 'link' && item.href) {
      return location.pathname.startsWith(item.href);
    }
    if (item.type === 'section' && isHomePage) {
      return activeSection === item.id;
    }
    return false;
  };

  return (
    <nav className="fixed top-0 w-full bg-amber-50/90 backdrop-blur-md z-50 border-b border-amber-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link to="/" className="flex items-center space-x-3" onClick={() => setActiveSection?.('home')}>
            {hasLogo ? (
              <>
                <img
                  src={PUBLIC_CONFIG.logoUrl}
                  alt={`${PUBLIC_CONFIG.brandName} Logo`}
                  className="h-10 w-auto object-contain"
                />
                <span className="sr-only">{PUBLIC_CONFIG.brandName}</span>
              </>
            ) : (
              <span className="text-2xl font-bold text-green-600">{PUBLIC_CONFIG.brandName}</span>
            )}
          </Link>

          {/* Desktop Menu */}
          <div className="hidden lg:flex items-center space-x-1">
            {navItems.map((item) =>
              item.type === 'link' && item.href ? (
                <Link
                  key={item.id}
                  to={item.href}
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive(item)
                      ? 'bg-green-100 text-green-700'
                      : 'text-gray-700 hover:bg-amber-100'
                  }`}
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item)}
                  type="button"
                  className={`px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                    isActive(item)
                      ? 'bg-green-100 text-green-700'
                      : 'text-gray-700 hover:bg-amber-100'
                  }`}
                >
                  {item.label}
                </button>
              )
            )}

            {loading ? null : user ? (
              <div className="flex items-center ml-4 space-x-2">
                <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                  {user.email?.charAt(0).toUpperCase()}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => signOut()}
                  className="text-gray-600 hover:text-gray-900"
                >
                  Sign Out
                </Button>
              </div>
            ) : (
              <Link to="/login">
                <Button variant="default" size="sm" className="ml-4 bg-green-600 hover:bg-green-700">
                  <LogIn className="h-4 w-4 mr-2" />
                  Sign In
                </Button>
              </Link>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="lg:hidden">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="lg:hidden bg-amber-50 border-t border-amber-200">
          <div className="px-2 pt-2 pb-3 space-y-1">
            {navItems.map((item) =>
              item.type === 'link' && item.href ? (
                <Link
                  key={item.id}
                  to={item.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block w-full text-left px-3 py-2 rounded-md text-base font-medium transition-colors ${
                    isActive(item)
                      ? 'bg-green-100 text-green-700'
                      : 'text-gray-700 hover:bg-amber-100'
                  }`}
                >
                  {item.label}
                </Link>
              ) : (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item)}
                  type="button"
                  className={`block w-full text-left px-3 py-2 rounded-md text-base font-medium transition-colors ${
                    isActive(item)
                      ? 'bg-green-100 text-green-700'
                      : 'text-gray-700 hover:bg-amber-100'
                  }`}
                >
                  {item.label}
                </button>
              )
            )}

            <div className="pt-2 border-t border-amber-200 mt-2">
            {loading ? null : user ? (
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center space-x-2">
                    <div className="w-8 h-8 bg-green-600 rounded-full flex items-center justify-center text-white text-sm font-semibold">
                      {user.email?.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-700 truncate max-w-[180px]">{user.email}</span>
                  </div>
                  <Button variant="ghost" size="sm" onClick={() => { signOut(); setMobileMenuOpen(false); }}>
                    Sign Out
                  </Button>
                </div>
              ) : (
                <Link
                  to="/login"
                  onClick={() => setMobileMenuOpen(false)}
                  className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-green-700 hover:bg-green-100"
                >
                  <LogIn className="h-4 w-4 inline mr-2" />
                  Sign In
                </Link>
              )}
            </div>
          </div>
        </div>
      )}
    </nav>
  );
};

export default Navbar;
