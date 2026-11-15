import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router";

import { LanguageProvider } from "./i18n/LanguageProvider";

// Separate chunks keep the phone from downloading the kiosk's QR code library,
// and shoppers from downloading the managers' map editor.
const AdminView = lazy(() => import("./views/AdminView"));
const HomeView = lazy(() => import("./views/HomeView"));
const KioskView = lazy(() => import("./views/KioskView"));
const MobileView = lazy(() => import("./views/MobileView"));
const StaffView = lazy(() => import("./views/StaffView"));

export function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <Suspense fallback={<div className="min-h-dvh bg-paper" />}>
          <Routes>
            <Route path="/" element={<HomeView />} />
            <Route path="/kiosk" element={<KioskView />} />
            <Route path="/mobile" element={<MobileView />} />
            <Route path="/admin" element={<AdminView />} />
            <Route path="/staff" element={<StaffView />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </LanguageProvider>
  );
}
