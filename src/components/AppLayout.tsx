import React, { Suspense, lazy, useState } from 'react';
import Navbar from '@/components/Navbar';
import Hero from '@/components/Hero';
import Footer from '@/components/Footer';
const Services = lazy(() => import('@/components/Services'));
const About = lazy(() => import('@/components/About'));

const AppLayout: React.FC = () => {
  const [activeSection, setActiveSection] = useState('home');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const renderSection = () => {
    switch (activeSection) {
      case 'home':
        return <Hero setActiveSection={setActiveSection} />;
      case 'services':
        return <Services />;
      case 'about':
        return <About />;
      default:
        return <Hero setActiveSection={setActiveSection} />;
    }
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar
        activeSection={activeSection}
        setActiveSection={setActiveSection}
        mobileMenuOpen={mobileMenuOpen}
        setMobileMenuOpen={setMobileMenuOpen}
      />
      <main>
        {activeSection === 'home' ? (
          renderSection()
        ) : (
          <Suspense fallback={<div className="py-16 text-center text-gray-500">Loading section...</div>}>
            {renderSection()}
          </Suspense>
        )}
      </main>
      <Footer />
    </div>
  );
};

export default AppLayout;
