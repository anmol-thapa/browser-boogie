import { Link } from "react-router-dom";
import "./homepage.css";

export default function HomePage() {
  const actions = [
    {
      path: "/browse",
      title: "Browse",
      description: "Browse public user submitted dances and try to get the highest score!"
    },
    {
      path: "/friendly-challenge",
      title: "Friendly Challenge",
      description: "Create a dance to send to your friends. See who can match the creator the most!"
    },
    {
      path: "/enter-code",
      title: "Enter A Code",
      description: "Enter a video code to participate with public videos or ones with friends!"
    }
  ];

  return (
    <div className="home">
      <nav className="home-nav">
        <div className="home-brand-wrap">
          <div className="home-logo-slot" aria-hidden="true">
            Logo
          </div>
          <div className="home-brand">Just Dance</div>
        </div>
        <button type="button" className="home-login">
          Login
        </button>
      </nav>

      <main className="home-main">
        <h1 className="home-title">Dance To The Beat</h1>

        <div className="home-actions">
          {actions.map((action) => (
            <div key={action.title} className="home-action-card">
              <Link to={action.path} className="home-image-btn">
                Image Placeholder
              </Link>
              <p className="home-action-title">{action.title}</p>
              <p className="home-action-subtext">{action.description}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
