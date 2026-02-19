import { Suspense, lazy, type ReactNode } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/hooks/useAuth";
import CookieConsentBanner from "@/components/CookieConsentBanner";

const queryClient = new QueryClient();
const Index = lazy(() => import("./pages/Index"));
const NotFound = lazy(() => import("./pages/NotFound"));
const AnalyzePage = lazy(() => import("./pages/Analyze"));
const BlogPage = lazy(() => import("./pages/BlogPage"));
const BlogPostPage = lazy(() => import("./pages/BlogPostPage"));
const PricingPage = lazy(() => import("./pages/Pricing"));
const RequestReportPage = lazy(() => import("./pages/RequestReport"));
const Login = lazy(() => import("./pages/Login"));
const FinancePage = lazy(() => import("./pages/Finance"));
const CookiePolicyPage = lazy(() => import("./pages/CookiePolicy"));
const MLEnginePage = lazy(() => import("./pages/MLEngine"));

const RouteLoader = () => (
  <div className="min-h-[40vh] flex items-center justify-center text-gray-500">Loading...</div>
);

const withSuspense = (node: ReactNode) => (
  <Suspense fallback={<RouteLoader />}>{node}</Suspense>
);

const App = () => (
  <ThemeProvider defaultTheme="light">
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <Routes>
              <Route path="/" element={withSuspense(<Index />)} />
              <Route path="/analyze" element={withSuspense(<AnalyzePage />)} />
              <Route path="/blog" element={withSuspense(<BlogPage />)} />
              <Route path="/blog/:slug" element={withSuspense(<BlogPostPage />)} />
              <Route path="/pricing" element={withSuspense(<PricingPage />)} />
              <Route path="/request-report" element={withSuspense(<RequestReportPage />)} />
              <Route path="/finance" element={withSuspense(<FinancePage />)} />
              <Route path="/login" element={withSuspense(<Login />)} />
              <Route path="/cookie-policy" element={withSuspense(<CookiePolicyPage />)} />
              <Route path="/ml-engine" element={withSuspense(<MLEnginePage />)} />
              <Route path="*" element={withSuspense(<NotFound />)} />
            </Routes>
            <CookieConsentBanner />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </ThemeProvider>
);

export default App;
