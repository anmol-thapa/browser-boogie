import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, signInWithEmail } from '../lib/supabaseClient';
import './homepage.css';
import './auth.css';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotError, setForgotError] = useState('');

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

  const handleForgot = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setForgotError('');
    setForgotMsg('');
    setForgotLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) throw new Error(error.message);
      setForgotMsg('Check your email for a password reset link.');
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : 'Failed to send reset email.');
    } finally {
      setForgotLoading(false);
    }
  };

  return (
    <div className="home">
      <header className="topbar topbar-home"><div className="topbar-home-inner"><div className="brand-logo-text"><h1>BrowserBoogie</h1></div></div></header>

      <main className="home-main auth-main">
        <section className="auth-card">
          {!showForgot ? (
            <>
              <h1 className="auth-title">Login</h1>
              <p className="auth-subtitle">Welcome back. Sign in to start dancing.</p>

              <form className="auth-form" onSubmit={handleSubmit}>
                <label className="auth-label" htmlFor="email">Email</label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  className="auth-input"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />

                <label className="auth-label" htmlFor="password">Password</label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  className="auth-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                />

                {errorMsg ? <p className="auth-feedback error">{errorMsg}</p> : null}

                <button type="submit" className="auth-submit" disabled={isLoading}>
                  {isLoading ? 'Signing in...' : 'Sign In'}
                </button>
              </form>

              <p className="auth-switch">
                <button className="auth-link-btn" onClick={() => { setShowForgot(true); setForgotEmail(email); }}>
                  Forgot password?
                </button>
              </p>
              <p className="auth-switch">
                Need an account?{' '}
                <Link to="/signup" className="auth-switch-link">Create Account</Link>
              </p>
            </>
          ) : (
            <>
              <h1 className="auth-title">Reset Password</h1>
              <p className="auth-subtitle">Enter your email and we'll send you a reset link.</p>

              <form className="auth-form" onSubmit={handleForgot}>
                <label className="auth-label" htmlFor="forgot-email">Email</label>
                <input
                  id="forgot-email"
                  name="email"
                  type="email"
                  className="auth-input"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />

                {forgotError ? <p className="auth-feedback error">{forgotError}</p> : null}
                {forgotMsg ? <p className="auth-feedback success">{forgotMsg}</p> : null}

                <button type="submit" className="auth-submit" disabled={forgotLoading || !!forgotMsg}>
                  {forgotLoading ? 'Sending...' : 'Send Reset Link'}
                </button>
              </form>

              <p className="auth-switch">
                <button className="auth-link-btn" onClick={() => { setShowForgot(false); setForgotMsg(''); setForgotError(''); }}>
                  Back to Sign In
                </button>
              </p>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
