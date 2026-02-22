import { Link, useNavigate } from "react-router-dom";
import TopNav from "../components/TopNav";
import { clearSession } from "../lib/supabaseClient";
import "./homepage.css";
import "./dashboard.css";

export default function DashboardPage() {
  const navigate = useNavigate();

  const handleLogout = () => {
    clearSession();
    navigate("/login");
  };

  return (
    <div className="home">
      <TopNav showAuthButtons={false} />

      <main className="home-main dash-main">
        <section className="dash-hero">
          <p className="dash-kicker">Browser Boogie Platform</p>
          <h1>Dashboard Workspace</h1>
          <p>Pick a mode, start a challenge, and track your progress.</p>
          <div className="dash-hero-actions">
            <Link to="/friendly-challenge" className="dash-btn primary">
              Start Friendly Challenge
            </Link>
            <Link to="/enter-code" className="dash-btn">
              Enter Code
            </Link>
            <button type="button" className="dash-btn ghost" onClick={handleLogout}>
              Log Out
            </button>
          </div>
        </section>

        <section className="dash-grid">
          <article className="dash-card">
            <h3>Studio</h3>
            <p>Upload source dance videos and tune difficulty settings for match scoring.</p>
          </article>
          <article className="dash-card">
            <h3>Challenges</h3>
            <p>Create shareable links and challenge friends to beat your choreography score.</p>
          </article>
          <article className="dash-card">
            <h3>Stats</h3>
            <p>Track streaks, win rate, and consistency while you improve each round.</p>
          </article>
          <article className="dash-card">
            <h3>Leaderboard</h3>
            <p>See where your team ranks and which tracks are trending right now.</p>
          </article>
        </section>
      </main>
    </div>
  );
}
