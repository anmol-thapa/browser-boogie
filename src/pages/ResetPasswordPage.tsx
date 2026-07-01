import { FormEvent, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabaseClient';
import './homepage.css';
import './auth.css';

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  useEffect(() => {
    // Supabase puts the recovery token in the URL hash and fires an
    // SIGNED_IN / PASSWORD_RECOVERY event. We just need to wait for it.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') {
        setReady(true);
      }
    });
    // Also check if a session already exists (user arrived with valid token)
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMsg('');
    if (newPassword !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }
    if (newPassword.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }
    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setIsLoading(false);
    if (error) {
      setErrorMsg(error.message || 'Failed to update password.');
    } else {
      setSuccessMsg('Password updated! Redirecting to login...');
      await supabase.auth.signOut();
      setTimeout(() => navigate('/login', { replace: true }), 2000);
    }
  };

  return (
    <div className="home">
      <header className="topbar topbar-home"><div className="topbar-home-inner"><div className="brand-logo-text"><h1>BrowserBoogie</h1></div></div></header>

      <main className="home-main auth-main">
        <section className="auth-card">
          <h1 className="auth-title">New Password</h1>
          <p className="auth-subtitle">Choose a new password for your account.</p>

          {!ready ? (
            <p className="auth-feedback" style={{ marginTop: 16 }}>Verifying reset link...</p>
          ) : successMsg ? (
            <p className="auth-feedback success" style={{ marginTop: 16 }}>{successMsg}</p>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              <label className="auth-label" htmlFor="new-password">New Password</label>
              <input
                id="new-password"
                type="password"
                className="auth-input"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                required
              />

              <label className="auth-label" htmlFor="confirm-password">Confirm Password</label>
              <input
                id="confirm-password"
                type="password"
                className="auth-input"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                required
              />

              {errorMsg ? <p className="auth-feedback error">{errorMsg}</p> : null}

              <button type="submit" className="auth-submit" disabled={isLoading || !newPassword || !confirmPassword}>
                {isLoading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )}
        </section>
      </main>
    </div>
  );
}
