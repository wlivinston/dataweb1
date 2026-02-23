import { useEffect } from "react";
import { useLocation } from "react-router-dom";

const RouteScrollToTop = () => {
  const { pathname } = useLocation();

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  return null;
};

export default RouteScrollToTop;
