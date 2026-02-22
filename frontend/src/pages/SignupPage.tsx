import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import TopNav from '../components/TopNav';
import { saveSession, signUpWithEmail, type SupabaseSession } from '../lib/supabaseClient';
import './homepage.css';
import './signup.css';

export default function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setIsLoading(true);

    try {
      const { session } = await signUpWithEmail(email, password, username);
      if (session) {
        saveSession(session as SupabaseSession);
        navigate('/');
        return;
      }

      setSuccessMsg('Account created. Check your email to verify your account, then log in.');
      setPassword('');
      setConfirmPassword('');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to create account. Please try again.';
      setErrorMsg(message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="home">
      <TopNav showAuthButtons={false} />

      <main className="home-main auth-main">
        <section className="signup-card">
          <h1 className="signup-title">Create Account</h1>
          <p className="auth-subtitle">Join Just Dance and start your first challenge.</p>

          <form className="signup-form" onSubmit={handleSubmit}>
            <label className="signup-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              className="signup-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
            />

            <label className="signup-label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              name="username"
              type="text"
              className="signup-input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              required
            />

            <label className="signup-label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              name="password"
              type="password"
              className="signup-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Create password"
              required
            />

            <label className="signup-label" htmlFor="confirmPassword">
              Confirm Password
            </label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              className="signup-input"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              required
            />

            {errorMsg ? <p className="auth-feedback error">{errorMsg}</p> : null}
            {successMsg ? <p className="auth-feedback success">{successMsg}</p> : null}

            <button type="submit" className="signup-submit" disabled={isLoading}>
              {isLoading ? 'Creating account...' : 'Create Account'}
            </button>
          </form>

          <p className="auth-switch">
            Already have an account?{' '}
            <Link to="/login" className="auth-switch-link">
              Login
            </Link>
          </p>
        </section>
      </main>
    </div>
  );
}
