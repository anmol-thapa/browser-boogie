import { Link } from "react-router-dom";
import "./homepage.css";

export default function EnterCodePage() {
  return (
    <div className="home">
      <nav className="home-nav">
        <div className="home-brand-wrap">
          <div className="home-logo-slot" aria-hidden="true">
            Logo
          </div>
          <div className="home-brand">Just Dance</div>
        </div>
        <Link to="/login" className="home-login">
          Login
        </Link>
      </nav>

      <main className="home-main">
        <h1 className="home-title">enter a code</h1>
      </main>
    </div>
  );
}
