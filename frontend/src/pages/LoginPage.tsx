import { Link } from "react-router-dom";
import "./homepage.css";
import "./login.css";

export default function LoginPage() {
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
        <section className="login-card">
          <h1 className="login-title">Login</h1>
          <form className="login-form">
            <label className="login-label" htmlFor="username">
              Username
            </label>
            <input id="username" name="username" type="text" className="login-input" />

            <label className="login-label" htmlFor="password">
              Password
            </label>
            <input id="password" name="password" type="password" className="login-input" />

            <button type="submit" className="login-submit">
              Sign In
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
