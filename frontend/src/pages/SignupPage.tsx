import TopNav from "../components/TopNav";
import "./homepage.css";
import "./signup.css";

export default function SignupPage() {
  return (
    <div className="home">
      <TopNav showAuthButtons={false} />

      <main className="home-main">
        <section className="signup-card">
          <h1 className="signup-title">Create Account</h1>
          <form className="signup-form">
            <label className="signup-label" htmlFor="email">
              Email
            </label>
            <input id="email" name="email" type="email" className="signup-input" />

            <label className="signup-label" htmlFor="username">
              Username
            </label>
            <input id="username" name="username" type="text" className="signup-input" />

            <label className="signup-label" htmlFor="password">
              Password
            </label>
            <input id="password" name="password" type="password" className="signup-input" />

            <label className="signup-label" htmlFor="confirmPassword">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              className="signup-input"
            />

            <button type="submit" className="signup-submit">
              Create Account
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
