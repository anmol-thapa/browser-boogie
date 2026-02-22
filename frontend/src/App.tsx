import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { isAuthenticated } from './lib/supabaseClient';
import BrowsePage from './pages/BrowsePage';
import DashboardPage from './pages/DashboardPage';
import EnterCodePage from './pages/EnterCodePage';
import FriendlyChallengePage from './pages/FriendlyChallengePage';
import HomePage from './pages/HomePage';
import LoginPage from './pages/LoginPage';
import SignupPage from './pages/SignupPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  if (!isAuthenticated()) {
    return <Navigate to="/login" replace />;
  }
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/browse" element={<BrowsePage />} />
        <Route path="/friendly-challenge" element={<FriendlyChallengePage />} />
        <Route path="/enter-code" element={<EnterCodePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/dashboard"
          element={
            <RequireAuth>
              <DashboardPage />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}
