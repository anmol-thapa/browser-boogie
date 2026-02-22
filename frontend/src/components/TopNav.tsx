import { Link } from "react-router-dom";

type TopNavProps = {
  showLogin?: boolean;
};

export default function TopNav({ showLogin = true }: TopNavProps) {
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
      {showLogin ? (
        <Link to="/login" className="home-login">
          Login
        </Link>
      ) : null}
    </nav>
  );
}
