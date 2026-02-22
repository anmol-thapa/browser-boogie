import { BrowserRouter, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import StudioWorkspace from "./features/studio/StudioWorkspace";
import { clearSession, isAuthenticated } from "./lib/supabaseClient";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

function StudioRoute() {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearSession();
    navigate("/login", { replace: true });
  };

  return <StudioWorkspace onLogout={handleLogout} />;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
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
