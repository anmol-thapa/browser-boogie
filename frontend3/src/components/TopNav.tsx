import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { clearSession, fetchCurrentUser, getSavedSession } from "../lib/supabaseClient";

type TopNavProps = {
  showAuthButtons?: boolean;
  activeAuth?: "login" | "signup" | null;
};

export default function TopNav({ showAuthButtons = true, activeAuth = null }: TopNavProps) {
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
    <header className="topbar topbar-home auth-topbar">
      <div className="topbar-home-inner">
        <div className="brand-logo-text">
          <h1>Browser Boogie</h1>
        </div>
        <div className="topbar-home-actions">
          {showAuthButtons && !displayName ? (
            <>
              <Link to="/login" className={activeAuth === "login" ? "btn btn-primary" : "btn"}>
                Login
              </Link>
              <Link to="/signup" className={activeAuth === "signup" ? "btn btn-primary" : "btn"}>
                Create Account
              </Link>
            </>
          ) : null}
          {showAuthButtons && displayName ? (
            <>
              <span className="auth-user-label">{displayName}</span>
              <button type="button" className="btn" onClick={handleLogout}>
                Log Out
              </button>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
