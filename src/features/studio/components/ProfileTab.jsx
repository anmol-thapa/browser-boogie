import React, { useEffect, useState } from "react";
import { supabase } from "../../../lib/supabaseClient";

export default function ProfileTab({ userProfile, onLogout }) {
  const [resolvedEmail, setResolvedEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteMsg, setDeleteMsg] = useState("");

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setResolvedEmail(data?.user?.email || "");
    });
  }, []);

  async function handlePasswordChange() {
    if (!currentPassword) { setPasswordMsg("Current password is required."); return; }
    if (!newPassword) return;
    if (newPassword !== confirmPassword) {
      setPasswordMsg("Passwords do not match.");
      return;
    }
    if (newPassword.length < 6) {
      setPasswordMsg("Password must be at least 6 characters.");
      return;
    }
    setPasswordBusy(true);
    setPasswordMsg("");
    const { error: reAuthError } = await supabase.auth.signInWithPassword({ email: resolvedEmail, password: currentPassword });
    if (reAuthError) {
      setPasswordBusy(false);
      setPasswordMsg("Current password is incorrect.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setPasswordBusy(false);
    if (error) {
      setPasswordMsg(error.message || "Failed to update password.");
    } else {
      setPasswordMsg("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
  }

  async function handleDeleteAccount() {
    setDeleteBusy(true);
    setDeleteMsg("");
    try {
      const { error } = await supabase.rpc("delete_my_account");
      if (error) throw new Error(error.message);
      await supabase.auth.signOut();
      onLogout();
    } catch (err) {
      setDeleteBusy(false);
      setDeleteMsg(err.message || "Failed to delete account.");
    }
  }

  const passwordSuccess = passwordMsg.includes("success");

  return (
    <div className="library-wrap profile-wrap">

      <section className="profile-section">
        <div className="section-head">
          <h2>Change Password</h2>
          <p className="muted">{resolvedEmail || userProfile.displayName}</p>
        </div>
        <div className="profile-form">
          <label className="field">
            Current Password
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Current password"
              disabled={passwordBusy}
            />
          </label>
          <label className="field">
            New Password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="New password"
              disabled={passwordBusy}
            />
          </label>
          <label className="field">
            Confirm Password
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
              disabled={passwordBusy}
            />
          </label>
          {passwordMsg && (
            <p className={passwordSuccess ? "profile-msg profile-msg--ok" : "profile-msg profile-msg--err"}>
              {passwordMsg}
            </p>
          )}
          <div>
            <button
              className="btn btn-primary"
              onClick={handlePasswordChange}
              disabled={passwordBusy || !currentPassword || !newPassword || !confirmPassword}
            >
              {passwordBusy ? "Updating..." : "Update Password"}
            </button>
          </div>
        </div>
      </section>

      <section className="profile-section">
        <div className="section-head">
          <h2>Privacy</h2>
        </div>
        <div className="profile-privacy-text">
          <p className="muted">We store your recordings, pose data, and practice scores in Supabase. Your data is only accessible to you and anyone you explicitly share a code with. We do not sell or share your data with third parties.</p>
          <p className="muted">To request a copy of your data or for any privacy concerns, contact us at <strong>anmol_thapa@outlook.com</strong>.</p>
        </div>
      </section>

      <section className="profile-section profile-section--danger">
        <div className="section-head">
          <h2>Delete Account</h2>
        </div>
        <p className="muted">Permanently deletes your account and all associated data including recordings, scores, and share codes. This cannot be undone.</p>
        {!deleteConfirm ? (
          <div>
            <button className="btn btn-danger" onClick={() => setDeleteConfirm(true)}>Delete My Account</button>
          </div>
        ) : (
          <div className="profile-delete-confirm">
            <p className="profile-msg profile-msg--err">
              Type <strong>DELETE</strong> to confirm. All your recordings, scores, and share codes will be permanently removed.
            </p>
            <input
              className="profile-delete-input"
              type="text"
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.target.value)}
              placeholder="Type DELETE to confirm"
              disabled={deleteBusy}
            />
            {deleteMsg && <p className="profile-msg profile-msg--err">{deleteMsg}</p>}
            <div className="profile-delete-actions">
              <button
                className="btn btn-danger"
                onClick={handleDeleteAccount}
                disabled={deleteBusy || deleteTyped !== "DELETE"}
              >
                {deleteBusy ? "Deleting..." : "Confirm Delete"}
              </button>
              <button className="btn" onClick={() => { setDeleteConfirm(false); setDeleteTyped(""); setDeleteMsg(""); }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>

    </div>
  );
}
