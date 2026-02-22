import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clearSession, fetchCurrentUser, getSavedSession } from "../lib/supabaseClient";

type TopNavProps = {
  showAuthButtons?: boolean;
};

export default function TopNav({ showAuthButtons = true }: TopNavProps) {
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    if (!showAuthButtons) return;

    const session = getSavedSession();
    if (!session?.access_token) {
      setDisplayName(null);
      return;
    }

    const metaUsername = session.user?.user_metadata?.username;
    const email = session.user?.email;
    const quickName =
      typeof metaUsername === "string" && metaUsername.trim()
        ? metaUsername.trim()
        : email?.split("@")[0] || "My Account";

    setDisplayName(quickName);

    fetchCurrentUser()
      .then((user) => {
        const apiUsername = user.user_metadata?.username;
        const apiName =
          typeof apiUsername === "string" && apiUsername.trim()
            ? apiUsername.trim()
            : user.email?.split("@")[0] || quickName;
        setDisplayName(apiName);
      })
      .catch(() => {
        // Keep local fallback name.
      });
  }, [showAuthButtons]);

  const handleLogout = () => {
    clearSession();
    setDisplayName(null);
    navigate("/login");
  };

  return (
    <nav className="home-nav">
      <div className="home-brand-wrap">
        <Link to="/" className="home-logo-link" aria-label="Go to landing page">
          <div className="home-logo-slot" aria-hidden="true">
            Logo
          </div>
        </Link>
        <Link to="/" className="home-brand-link">
          Just Dance
        </Link>
      </div>
      {showAuthButtons && !displayName ? (
        <div className="home-auth-links">
          <Link to="/login" className="home-login">
            Login
          </Link>
          <Link to="/signup" className="home-signup">
            Create Account
          </Link>
        </div>
      ) : null}
      {showAuthButtons && displayName ? (
        <div className="home-user-links">
          <span className="home-user-label">
            <span className="home-user-icon" aria-hidden="true" />
            <span>{displayName}</span>
          </span>
          <button type="button" className="home-logout" onClick={handleLogout}>
            Log out
          </button>
        </div>
      ) : null}
    </nav>
  );
}
