import { Link } from "react-router-dom";
import "./homepage.css";

export default function BrowsePage() {
  return (
    <div className="home">
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
        <Link to="/login" className="home-login">
          Login
        </Link>
      </nav>

      <main className="home-main">
        <h1 className="home-title">browse</h1>
      </main>
    </div>
  );
}
