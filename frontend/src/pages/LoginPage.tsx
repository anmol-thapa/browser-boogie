import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TopNav from '../components/TopNav';
import { signInWithEmail } from '../lib/supabaseClient';
import './homepage.css';
import './login.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const normalizeLoginError = (message: string) => {
    const lower = message.toLowerCase();

    if (lower.includes('invalid login credentials') || lower.includes('authentication request failed')) {
      return 'Invalid email or password.';
    }

    if (lower.includes('email not confirmed')) {
      return 'Please confirm your email first, then try logging in.';
    }

    return message;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMsg('');
    setIsLoading(true);

    try {
      await signInWithEmail(email, password);
      navigate('/');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in. Please try again.';
      setErrorMsg(normalizeLoginError(message));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="home">
      <TopNav showAuthButtons={false} />

      <main className="home-main auth-main">
        <section className="login-card">
          <h1 className="login-title">Login</h1>
          <p className="auth-subtitle">Welcome back. Sign in to start dancing.</p>

          <form className="login-form" onSubmit={handleSubmit}>
            <label className="login-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="login-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />

            <label className="login-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="login-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter password"
              required
            />

            {errorMsg ? <p className="auth-feedback error">{errorMsg}</p> : null}

            <button type="submit" className="login-submit" disabled={isLoading}>
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          <p className="auth-switch">
            Need an account?{' '}
            <Link to="/signup" className="auth-switch-link">
              Create Account
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
