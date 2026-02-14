// Finance Page — Route wrapper for /finance
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import FinanceDashboard from '@/components/FinanceDashboard';

const FinancePage = () => {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />
      <main className="pt-20 pb-16">
        <div className="container mx-auto px-4 max-w-7xl">
          <FinanceDashboard />
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default FinancePage;
