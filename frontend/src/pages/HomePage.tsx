import { Link } from "react-router-dom";
import TopNav from "../components/TopNav";
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
      <TopNav />

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

        <section className="home-info-panel">
          <h2 className="home-info-title">How To Play + Game Rules</h2>
          <p className="home-info-text">
            Placeholder text: explain how users start a dance, what each mode does, and what actions
            players should take to begin a session.
          </p>
          <p className="home-info-text">
            Placeholder text: explain scoring basics (Perfect/Good/Ok/Miss), combo rules, and any
            penalties or tie-break rules.
          </p>
          <p className="home-info-text">
            Placeholder text: include safety and fairness notes, camera setup tips, and any
            restrictions for challenge submissions.
          </p>
        </section>
      </main>
    </div>
  );
}
