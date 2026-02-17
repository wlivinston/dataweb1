import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

const COOKIE_CONSENT_KEY = "dataafrik_cookie_consent_v1";

const CookieConsentBanner: React.FC = () => {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    try {
      const savedChoice = localStorage.getItem(COOKIE_CONSENT_KEY);
      if (!savedChoice) {
        setIsVisible(true);
      }
    } catch {
      setIsVisible(true);
    }
  }, []);

  const persistChoice = (choice: "accepted" | "dismissed") => {
    try {
      localStorage.setItem(COOKIE_CONSENT_KEY, choice);
    } catch {
      // Ignore storage failures and still hide the banner for this session.
    }
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] border-t border-slate-300 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
        <p className="text-sm leading-relaxed text-slate-700">
          By clicking "Accept All Cookies", you agree to the storing of cookies on your device to
          enhance site navigation, analyze site usage, and assist in our marketing efforts. View
          our{" "}
          <Link to="/cookie-policy" className="font-semibold text-slate-900 underline underline-offset-2">
            Cookie Policy
          </Link>
          .
        </p>

        <div className="flex items-center gap-2 self-end lg:self-auto">
          <Button
            type="button"
            onClick={() => persistChoice("accepted")}
            className="bg-slate-900 text-white hover:bg-slate-800"
          >
            Accept All Cookies
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => persistChoice("dismissed")}
            aria-label="Dismiss cookie notice"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

export default CookieConsentBanner;
