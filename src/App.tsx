import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import StudioWorkspace from "./features/studio/StudioWorkspace";
import { clearSession, isAuthenticated, sessionReady } from "./lib/supabaseClient";
import LoginPage from "./pages/LoginPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import SignupPage from "./pages/SignupPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    sessionReady.then(() => setReady(true));
  }, []);

  if (!ready) return null;
  if (!isAuthenticated()) {
    return <Navigate to="/signup" replace />;
  }
  return children;
}

function RequireGuest({ children }: { children: JSX.Element }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    sessionReady.then(() => setReady(true));
  }, []);

  if (!ready) return null;
  if (isAuthenticated()) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function StudioRoute() {
  const navigate = useNavigate();

  const handleLogout = async () => {
    await clearSession();
    navigate("/login", { replace: true });
  };

  return <StudioWorkspace onLogout={handleLogout} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<RequireGuest><LoginPage /></RequireGuest>} />
        <Route path="/signup" element={<RequireGuest><SignupPage /></RequireGuest>} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <StudioRoute />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
