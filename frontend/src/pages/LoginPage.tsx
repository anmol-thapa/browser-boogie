import TopNav from "../components/TopNav";
import "./homepage.css";
import "./login.css";

export default function LoginPage() {
  return (
    <div className="home">
      <TopNav showLogin={false} />

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
