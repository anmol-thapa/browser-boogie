import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../lib/supabaseClient";
import {
  MAX_RECORDINGS_PER_USER,
  RECORDINGS_BUCKET,
  DEFAULT_DIFFICULTY,
} from "./constants";
import {
  nativeImport,
  buildCurrentUserProfile,
  storageKeyForUser,
  loadStoredSessions,
  buildSessionFromDraft,
  mergeSessionConfig,
  deriveSessionConfigFromBundle,
  defaultImportDraft,
  importValidationError,
  emptyUserStats,
  hasPersistableContent,
  isShareableSession,
  normalizeDifficulty,
  safeRoutineName,
  sanitizeFilename,
  basename,
} from "./utils";
import {
  getUserRecordingCount,
  persistSessionBundleToDisk,
  loadSessionBundleFromDisk,
  loadSessionBundleFromShareCode,
  createShareCode,
  fetchBrowseSelections,
  loadBrowseSelection,
  decodeStoragePayloadToBundle,
  fetchUserStatsSummary,
  recordPracticeStats,
} from "./storage";
import { getVideoDurationSec, trimVideoWithFFmpeg, buildRoutineFromVideoFile } from "./pose";
import Dashboard from "./components/Dashboard";
import BrowseSelections from "./components/BrowseSelections";
import Library from "./components/Library";
import SharedContent from "./components/SharedContent";
import ProfileTab from "./components/ProfileTab";
import StudioPage from "./components/StudioPage";
import { ImportSessionModal, ShareSettingsModal, LibraryLimitModal } from "./components/Modals";

const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_VIDEO_SEC = 120;

export default function StudioWorkspace({ onLogout }) {
  const userProfile = useMemo(() => buildCurrentUserProfile(), []);
  const userStorageKey = useMemo(() => storageKeyForUser(userProfile.userId), [userProfile.userId]);
  const [view, setView] = useState("main");
  const [mainTab, setMainTab] = useState("dashboard");
  const [sessions, setSessions] = useState(() => loadStoredSessions(userStorageKey));
  const [sessionFiles, setSessionFiles] = useState({});
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [openingSessionId, setOpeningSessionId] = useState(null);
  const [showImportModal, setShowImportModal] = useState(false);
  const [shareModal, setShareModal] = useState({
    open: false, sessionId: "", folderId: "", code: "", title: "", hasWebcam: false, stripWebcam: false,
  });
  const [importDraft, setImportDraft] = useState(defaultImportDraft);
  const [userStats, setUserStats] = useState(() => emptyUserStats(userProfile));
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState("");
  const [browseSelections, setBrowseSelections] = useState([]);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [browseError, setBrowseError] = useState("");
  const [browseBusyId, setBrowseBusyId] = useState("");
  const [libraryLimitHit, setLibraryLimitHit] = useState(false);
  const [sharedByMe, setSharedByMe] = useState([]);
  const [sharedByMeLoading, setSharedByMeLoading] = useState(false);
  const [sharedByMeError, setSharedByMeError] = useState("");

  const persistTimersRef = useRef({});
  const storageWarningShownRef = useRef(false);
  const folderIdBySessionRef = useRef({});
  const openingAbortRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(userStorageKey, JSON.stringify(sessions));
  }, [sessions, userStorageKey]);

  useEffect(() => {
    setSessions(loadStoredSessions(userStorageKey));
    setSessionFiles({});
    setActiveSessionId(null);
    setView("main");
    setMainTab("dashboard");
  }, [userStorageKey]);

  useEffect(() => {
    const next = {};
    for (const session of sessions) {
      if (session.dataFolderId) {
        next[session.id] = session.dataFolderId;
      }
    }
    folderIdBySessionRef.current = next;
  }, [sessions]);

  useEffect(() => {
    return () => {
      for (const t of Object.values(persistTimersRef.current)) {
        clearTimeout(t);
      }
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadStats() {
      setStatsLoading(true);
      setStatsError("");
      try {
        const summary = await fetchUserStatsSummary(userProfile.userId);
        if (cancelled) return;
        setUserStats(summary || emptyUserStats(userProfile));
      } catch (err) {
        if (cancelled) return;
        setStatsError("Stats unavailable. Check your connection and Supabase configuration.");
        setUserStats(emptyUserStats(userProfile));
        console.error("Stats load failed:", err);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    }
    loadStats();
    return () => { cancelled = true; };
  }, [userProfile.userId]);

  useEffect(() => {
    if (mainTab !== "browse") return;
    if (browseSelections.length > 0) return;
    refreshBrowseSelections(false);
  }, [mainTab, browseSelections.length]);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) || null,
    [sessions, activeSessionId]
  );
  const activeSessionFileBundle = activeSessionId ? (sessionFiles[activeSessionId] || {}) : {};

  function markStorageLink(sessionId, folderId) {
    if (!folderId) return;
    folderIdBySessionRef.current[sessionId] = folderId;
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId ? { ...session, dataFolderId: folderId } : session
      )
    );
  }

  function schedulePersistSessionFiles(sessionId, bundle) {
    if (!hasPersistableContent(bundle)) return;
    const session = sessions.find((s) => s.id === sessionId);
    const existingFolderId = folderIdBySessionRef.current[sessionId] || session?.dataFolderId || "";
    const existingTimer = persistTimersRef.current[sessionId];
    if (existingTimer) clearTimeout(existingTimer);
    persistTimersRef.current[sessionId] = setTimeout(async () => {
      try {
        const result = await persistSessionBundleToDisk({
          userId: userProfile.userId,
          sessionId,
          folderId: existingFolderId,
          bundle,
        });
        if (result?.folderId) {
          markStorageLink(sessionId, result.folderId);
        }
      } catch (err) {
        if (!storageWarningShownRef.current) {
          storageWarningShownRef.current = true;
          console.warn("Session persistence to Supabase failed.", err);
        }
      }
    }, 200);
  }

  async function handlePracticeRunComplete(runSummary) {
    const sessionId = String(runSummary?.sessionId || "");
    const session = sessions.find((s) => s.id === sessionId);
    const runPayload = {
      sessionId,
      sessionTitle: String(runSummary?.sessionTitle || "Practice"),
      averageScore: Number(runSummary?.averageScore) || 0,
      bestScore: Number(runSummary?.bestScore) || 0,
      samples: Number(runSummary?.samples) || 0,
      durationSec: Number(runSummary?.durationSec) || 0,
      source: String(runSummary?.source || "play"),
      sessionSource: String(session?.config?.source || ""),
      difficulty: normalizeDifficulty(runSummary?.difficulty, DEFAULT_DIFFICULTY),
    };
    const payload = await recordPracticeStats(userProfile, runPayload);
    if (payload?.userSummary) {
      setUserStats(payload.userSummary);
    }
    setStatsError("");
    return payload;
  }

  async function refreshBrowseSelections(force = false) {
    if (browseLoading) return;
    if (!force && browseSelections.length > 0) return;
    setBrowseLoading(true);
    setBrowseError("");
    try {
      const items = await fetchBrowseSelections();
      setBrowseSelections(items);
    } catch (err) {
      console.error("Browse selection load failed:", err);
      setBrowseSelections([]);
      setBrowseError(err?.message || "Unable to load browse presets.");
    } finally {
      setBrowseLoading(false);
    }
  }

  async function openBrowseSelectionInStudio(selection) {
    const selectionId = String(selection?.id || "").trim();
    if (!selectionId) {
      setBrowseError("Selection id is missing.");
      return;
    }

    const count = await getUserRecordingCount(userProfile.userId);
    if (count >= MAX_RECORDINGS_PER_USER) {
      setLibraryLimitHit(true);
      return;
    }

    setBrowseBusyId(selectionId);
    setBrowseError("");
    try {
      const payload = await loadBrowseSelection(selectionId);
      const decoded = await decodeStoragePayloadToBundle(payload);
      const bundle = decoded?.bundle;
      if (!bundle) {
        throw new Error("Selection bundle is empty.");
      }

      const derived = deriveSessionConfigFromBundle(bundle);
      const title =
        String(selection?.title || "").trim() ||
        String(derived?.title || "").trim() ||
        "Browse Selection";
      const packageZipFileName =
        bundle.loadZipFile?.name ||
        String(selection?.packageZipFileName || "").trim() ||
        String(derived?.config?.packageZipFileName || "").trim() ||
        `${safeRoutineName(title)}-package.zip`;

      const session = buildSessionFromDraft({
        title,
        mode: "load-routine",
        recordAudioFileName: "",
        recordIncludeWebcamVideo: false,
        recordWebcamLayout: "raw",
        loadZipFileName: packageZipFileName,
        loadDifficulty: normalizeDifficulty(derived?.config?.difficulty, DEFAULT_DIFFICULTY),
        createVideoFileName: "",
      });
      session.status = "ready";
      session.countdownSec = null;
      session.config = mergeSessionConfig(session.config, {
        ...derived.config,
        packageZipFileName,
        source: "selection",
        selectionId,
        selectionCategory: String(selection?.category || ""),
      });

      addSessionAndOpen(session, { ...bundle, __hydrated: true });
      if (decoded.missingKeys?.length) {
        window.alert(`Some preset files are missing: ${decoded.missingKeys.join(", ")}`);
      }
    } catch (err) {
      console.error("Open browse selection failed:", err);
      setBrowseError(err?.message || "Unable to open selection.");
    } finally {
      setBrowseBusyId("");
    }
  }

  function cancelOpenSession() {
    if (openingAbortRef.current) {
      openingAbortRef.current.abort();
      openingAbortRef.current = null;
    }
    setOpeningSessionId(null);
  }

  async function openSessionInStudio(sessionId) {
    cancelOpenSession();

    const targetSession = sessions.find((session) => session.id === sessionId);
    if (targetSession?.dataFolderId && !sessionFiles[sessionId]?.__hydrated) {
      const controller = new AbortController();
      openingAbortRef.current = controller;
      setOpeningSessionId(sessionId);
      try {
        const loadResult = await loadSessionBundleFromDisk(targetSession.dataFolderId, userProfile.userId);
        if (controller.signal.aborted) return;
        if (loadResult.missing) {
          window.alert("Session data folder was deleted or moved. Re-import files for this session.");
          setSessions((prev) =>
            prev.map((session) =>
              session.id === sessionId ? { ...session, status: "missing-data" } : session
            )
          );
        } else if (loadResult.bundle) {
          setSessionFiles((prev) => ({
            ...prev,
            [sessionId]: { ...(prev[sessionId] || {}), ...loadResult.bundle },
          }));
          if (loadResult.missingKeys?.length) {
            window.alert(`Some files are missing for this session: ${loadResult.missingKeys.join(", ")}`);
          }
        }
      } catch (err) {
        if (!controller.signal.aborted) console.error("Failed to hydrate session files:", err);
        return;
      } finally {
        if (openingAbortRef.current === controller) {
          openingAbortRef.current = null;
          setOpeningSessionId(null);
        }
      }
      if (controller.signal.aborted) return;
    }

    setActiveSessionId(sessionId);
    setView("studio");
  }

  async function ensureShareFolderId(sessionId) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return "";
    let folderId = folderIdBySessionRef.current[sessionId] || session.dataFolderId || "";
    if (folderId) return folderId;

    const bundle = sessionFiles[sessionId] || {};
    if (!hasPersistableContent(bundle)) return "";

    const result = await persistSessionBundleToDisk({
      userId: userProfile.userId,
      sessionId,
      folderId: "",
      bundle,
    });
    folderId = String(result?.folderId || "");
    if (folderId) markStorageLink(sessionId, folderId);
    return folderId;
  }

  function addSessionAndOpen(session, files = {}) {
    if (session?.dataFolderId) {
      folderIdBySessionRef.current[session.id] = session.dataFolderId;
    }
    setSessions((prev) => [session, ...prev]);
    setSessionFiles((prev) => ({ ...prev, [session.id]: { ...files } }));
    schedulePersistSessionFiles(session.id, files);
    setActiveSessionId(session.id);
    setView("studio");
    return session.id;
  }

  async function startRecordSession() {
    cancelOpenSession();
    const count = await getUserRecordingCount(userProfile.userId);
    if (count >= MAX_RECORDINGS_PER_USER) {
      setLibraryLimitHit(true);
      return;
    }
    const session = buildSessionFromDraft({
      title: "",
      mode: "record",
      recordAudioFileName: "",
      recordIncludeWebcamVideo: true,
      recordWebcamLayout: "raw",
      recordDifficulty: DEFAULT_DIFFICULTY,
      loadZipFileName: "",
      createVideoFileName: "",
    });
    addSessionAndOpen(session, { recordAudioFile: null });
  }

  async function submitImportSession(draft, setProgress, ffmpegRef) {
    const err = importValidationError(draft);
    if (err) throw new Error(err);

    const count = await getUserRecordingCount(userProfile.userId);
    if (count >= MAX_RECORDINGS_PER_USER) {
      setLibraryLimitHit(true);
      throw new Error(`Library full (${MAX_RECORDINGS_PER_USER}/${MAX_RECORDINGS_PER_USER}). Delete a recording first.`);
    }

    if (draft.importMode === "friend-code") {
      const code = String(draft.friendShareCode || "").trim().toUpperCase();
      setProgress("Resolving friend's shared session...");
      const loadResult = await loadSessionBundleFromShareCode(code);
      if (loadResult.missing || !loadResult.bundle) {
        throw new Error("Share code not found. Ask your friend to share again.");
      }
      if (loadResult.ownerUserId && loadResult.ownerUserId === userProfile.userId) {
        throw new Error("This is your own share code. You cannot import your own recordings.");
      }

      const bundle = loadResult.bundle;
      const { title: inferredTitle, config } = deriveSessionConfigFromBundle(bundle);
      const sessionTitle = draft.title.trim() || inferredTitle || `Friend Session ${code}`;

      const session = buildSessionFromDraft({
        title: sessionTitle,
        mode: "load-routine",
        recordAudioFileName: "",
        recordIncludeWebcamVideo: false,
        recordWebcamLayout: "raw",
        loadZipFileName: bundle.loadZipFile?.name || config.packageZipFileName || "",
        loadDifficulty: normalizeDifficulty(config?.difficulty, DEFAULT_DIFFICULTY),
        createVideoFileName: "",
      });
      session.status = "ready";
      session.countdownSec = null;
      session.config = mergeSessionConfig(session.config, {
        ...config,
        source: "friend-share",
        shareCode: code,
      });
      if (loadResult.folderId) {
        session.dataFolderId = loadResult.folderId;
      }

      addSessionAndOpen(session, { ...bundle, __hydrated: true });
      closeImportModal();
      return;
    }

    let sourceVideo = draft.sourceVideoFile;
    const sourceVideoDifficulty = normalizeDifficulty(draft.sourceVideoDifficulty, DEFAULT_DIFFICULTY);
    const guessedName = draft.title.trim() || basename(draft.sourceVideoFileName).replace(/\.[^.]+$/, "") || "Video Routine";

    if (sourceVideo.size > MAX_VIDEO_BYTES) {
      throw new Error(`File is too large (${(sourceVideo.size / 1024 / 1024).toFixed(0)} MB). Maximum is 100 MB.`);
    }

    const rawDuration = await getVideoDurationSec(sourceVideo);
    if (rawDuration > MAX_VIDEO_SEC) {
      setProgress("Loading trimming tools (first-time download ~30 MB, cached after)...");
      sourceVideo = await trimVideoWithFFmpeg(sourceVideo, MAX_VIDEO_SEC, (pct) => {
        setProgress(`Trimming video to 2 minutes... ${pct}%`);
      }, ffmpegRef);
    }

    setProgress("Analyzing video and extracting pose frames...");
    const routine = await buildRoutineFromVideoFile(sourceVideo, guessedName, (done, total) => {
      const pct = Math.round((done / Math.max(1, total)) * 100);
      setProgress(`Analyzing video... ${pct}%`);
    }, { difficulty: sourceVideoDifficulty });
    setProgress("Preparing routine package...");

    const packageName = `${safeRoutineName(guessedName)}-package.zip`;
    const sourceName = sanitizeFilename(sourceVideo?.name || `${safeRoutineName(guessedName)}.mp4`);
    const routineExport = {
      ...routine,
      difficulty: sourceVideoDifficulty,
      song: {
        ...(routine.song || {}),
        offsetSec: Number(routine.song?.offsetSec) || 0,
        fileName: sourceName,
      },
      webcam: {
        fileName: sourceName,
        layout: "side-by-side",
      },
    };
    const JSZip = (await nativeImport("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm")).default;
    const zip = new JSZip();
    zip.file("routine.json", JSON.stringify(routineExport, null, 2));
    zip.file(sourceName, sourceVideo);
    const zipBlob = await zip.generateAsync({ type: "blob" });
    const packageFile = new File([zipBlob], packageName, { type: "application/zip" });

    setProgress("Preparing play session...");
    const session = buildSessionFromDraft({
      title: guessedName,
      mode: "load-routine",
      recordAudioFileName: "",
      recordIncludeWebcamVideo: false,
      recordWebcamLayout: "raw",
      loadZipFileName: packageName,
      loadDifficulty: sourceVideoDifficulty,
      createVideoFileName: "",
    });
    session.status = "ready";
    session.countdownSec = null;

    addSessionAndOpen(session, {
      loadedRoutine: routineExport,
      generatedRoutine: routineExport,
      playAudioFile: sourceVideo,
      loadWebcamVideoFile: sourceVideo,
      recordedWebcamLayout: "side-by-side",
      createVideoFile: sourceVideo,
      loadZipFile: packageFile,
    });
    closeImportModal();
  }

  async function shareSessionFromLibrary(sessionId) {
    const session = sessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (!isShareableSession(session)) {
      window.alert("Only completed Play sessions can be shared.");
      return;
    }

    try {
      const folderId = await ensureShareFolderId(sessionId);
      if (!folderId) {
        window.alert("Session data is not ready for sharing yet. Open the session once, then try again.");
        return;
      }

      const { data: folderRow } = await supabase
        .from("folders")
        .select("manifest")
        .eq("id", folderId)
        .maybeSingle();
      const manifestFiles = folderRow?.manifest?.files || {};
      const hasWebcam = Boolean(manifestFiles.recordedWebcamFile || manifestFiles.loadWebcamVideoFile);

      const { data: existing } = await supabase
        .from("shares")
        .select("code, strip_webcam")
        .eq("folder_id", folderId)
        .maybeSingle();

      setShareModal({
        open: true,
        sessionId,
        folderId,
        code: existing?.code || "",
        title: session.title || "Play Session",
        hasWebcam,
        stripWebcam: existing?.strip_webcam ?? false,
      });
    } catch (err) {
      console.error("Share session failed:", err);
      window.alert(err?.message || "Unable to open share settings.");
    }
  }

  async function generateShareCode(folderId, stripWebcam) {
    try {
      const result = await createShareCode(folderId, userProfile.userId, { stripWebcam });
      const code = String(result?.code || "");
      if (!code) throw new Error("Share code generation failed.");
      setShareModal((prev) => ({ ...prev, code }));
      setSharedByMe((prev) => {
        const exists = prev.some((r) => r.folderId === folderId);
        if (exists) {
          return prev.map((r) =>
            r.folderId === folderId ? { ...r, code, stripWebcam, deleted: false } : r
          );
        }
        return [
          { code, folderId, stripWebcam, deleted: false, createdAt: new Date().toISOString(), title: shareModal.title },
          ...prev,
        ];
      });
    } catch (err) {
      console.error("Share code generation failed:", err);
      window.alert(err?.message || "Unable to generate share code.");
    }
  }

  async function fetchSharedByMe() {
    setSharedByMeLoading(true);
    setSharedByMeError("");
    try {
      const { data, error } = await supabase
        .from("shares")
        .select("code, folder_id, strip_webcam, created_at, folders(manifest)")
        .eq("created_by", userProfile.userId)
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      setSharedByMe(
        (data || []).map((row) => {
          const liveSession = sessions.find(
            (s) => folderIdBySessionRef.current[s.id] === row.folder_id || s.dataFolderId === row.folder_id
          );
          const deleted = !row.folders || !liveSession;
          const title = liveSession?.title
            || (row.folders?.manifest?.files
              ? (Object.values(row.folders.manifest.files).find((f) => f?.name)?.name?.replace(/\.[^.]+$/, "") || row.folder_id)
              : row.folder_id);
          return {
            code: row.code,
            folderId: row.folder_id,
            stripWebcam: row.strip_webcam,
            createdAt: row.created_at,
            deleted,
            title,
          };
        })
      );
    } catch (err) {
      setSharedByMeError(err.message || "Failed to load shared sessions.");
    } finally {
      setSharedByMeLoading(false);
    }
  }

  async function unshareSession(code, folderId) {
    const { error } = await supabase.from("shares").delete().eq("code", code).eq("folder_id", folderId);
    if (error) {
      window.alert("Failed to remove share code.");
      return;
    }
    setSharedByMe((prev) => prev.filter((row) => row.code !== code));
  }

  function updateSession(sessionId, patch) {
    setSessions((prev) =>
      prev.map((session) =>
        session.id === sessionId
          ? { ...session, ...patch, updatedAt: new Date().toISOString() }
          : session
      )
    );
  }

  function updateSessionFiles(sessionId, patch) {
    setSessionFiles((prev) => {
      const nextBundle = { ...(prev[sessionId] || {}), ...patch };
      queueMicrotask(() => {
        schedulePersistSessionFiles(sessionId, nextBundle);
      });
      return { ...prev, [sessionId]: nextBundle };
    });
  }

  async function deleteSession(sessionId) {
    if (openingSessionId === sessionId) cancelOpenSession();
    const folderId =
      folderIdBySessionRef.current[sessionId] ||
      sessions.find((s) => s.id === sessionId)?.dataFolderId;

    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setSessionFiles((prev) => {
      const next = { ...prev };
      delete next[sessionId];
      return next;
    });
    if (activeSessionId === sessionId) {
      setActiveSessionId(null);
      setView("main");
    }

    if (!folderId || !userProfile?.userId) return;
    const uid = userProfile.userId;

    await supabase.from("shares").delete().eq("folder_id", folderId);

    const { data: listed } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .list(`${uid}/${folderId}`);
    if (listed?.length) {
      const paths = listed.map((f) => `${uid}/${folderId}/${f.name}`);
      await supabase.storage.from(RECORDINGS_BUCKET).remove(paths);
    }

    await supabase.from("folders").delete().eq("id", folderId).eq("user_id", uid);
  }

  function openImportModal(initialMode = "load-video") {
    cancelOpenSession();
    setImportDraft((prev) => ({
      ...defaultImportDraft(),
      importMode: initialMode,
      title: prev?.title || "",
    }));
    setShowImportModal(true);
  }

  function closeImportModal() {
    setShowImportModal(false);
  }

  function closeShareModal() {
    setShareModal({ open: false, sessionId: "", folderId: "", code: "", title: "", hasWebcam: false, stripWebcam: false });
  }

  function returnToMain() {
    setView("main");
    setMainTab("library");
  }

  function returnToDashboard() {
    setView("main");
    setMainTab("dashboard");
  }

  if (view === "studio") {
    return (
      <StudioPage
        session={activeSession}
        sessionFiles={activeSessionFileBundle}
        onBack={returnToMain}
        onGoDashboard={returnToDashboard}
        onLogout={onLogout}
        onUpdateSession={updateSession}
        onUpdateSessionFiles={updateSessionFiles}
        onPracticeRunComplete={handlePracticeRunComplete}
      />
    );
  }

  return (
    <div className="app-root">
      <header className="topbar topbar-home">
        <div className="topbar-home-inner">
          <div className="brand-logo-text">
            <h1>BrowserBoogie</h1>
          </div>
          <div className="topbar-home-actions">
            <nav className="tabs" aria-label="Main tabs">
              <a
                href="#dashboard"
                className={mainTab === "dashboard" ? "tab-link active" : "tab-link"}
                onClick={(event) => {
                  event.preventDefault();
                  cancelOpenSession();
                  setMainTab("dashboard");
                }}
              >
                Dashboard
              </a>
              <a
                href="#library"
                className={mainTab === "library" ? "tab-link active" : "tab-link"}
                onClick={(event) => {
                  event.preventDefault();
                  setMainTab("library");
                }}
              >
                My Library
              </a>
              <a
                href="#shared"
                className={mainTab === "shared" ? "tab-link active" : "tab-link"}
                onClick={(event) => {
                  event.preventDefault();
                  cancelOpenSession();
                  setMainTab("shared");
                  fetchSharedByMe();
                }}
              >
                Shared
              </a>
              <a
                href="#settings"
                className={mainTab === "settings" ? "tab-link active" : "tab-link"}
                onClick={(event) => {
                  event.preventDefault();
                  cancelOpenSession();
                  setMainTab("settings");
                }}
              >
                Settings
              </a>
            </nav>
            {typeof onLogout === "function" && (
              <button className="btn" onClick={onLogout}>Log Out</button>
            )}
          </div>
        </div>
      </header>

      <main className="content">
        {mainTab === "dashboard" && (
          <Dashboard
            onRecord={startRecordSession}
            onBrowse={() => setMainTab("browse")}
            onFriendCode={() => openImportModal("friend-code")}
            userProfile={userProfile}
            userStats={userStats}
            sessions={sessions}
            onOpenSession={openSessionInStudio}
            openingSessionId={openingSessionId}
            statsLoading={statsLoading}
            statsError={statsError}
          />
        )}

        {mainTab === "browse" && (
          <BrowseSelections
            items={browseSelections}
            loading={browseLoading}
            error={browseError}
            busyId={browseBusyId}
            onReload={() => refreshBrowseSelections(true)}
            onOpenSelection={openBrowseSelectionInStudio}
          />
        )}

        {mainTab === "library" && (
          <Library
            sessions={sessions}
            sharedFolderIds={new Set(sharedByMe.filter((r) => !r.deleted).map((r) => r.folderId))}
            folderIdBySession={folderIdBySessionRef.current}
            openingSessionId={openingSessionId}
            onOpenSession={openSessionInStudio}
            onDeleteSession={deleteSession}
            onShareSession={shareSessionFromLibrary}
            onRecord={startRecordSession}
            onImport={openImportModal}
          />
        )}

        {mainTab === "shared" && (
          <SharedContent
            sharedByMe={sharedByMe}
            sharedByMeLoading={sharedByMeLoading}
            sharedByMeError={sharedByMeError}
            onUnshare={unshareSession}
            onManageShare={(folderId) => {
              const session = sessions.find(
                (s) => folderIdBySessionRef.current[s.id] === folderId || s.dataFolderId === folderId
              );
              if (session) shareSessionFromLibrary(session.id);
            }}
            sharedWithMe={sessions.filter((s) => s.config?.source === "friend-share")}
            openingSessionId={openingSessionId}
            onOpenSession={openSessionInStudio}
            onDeleteSession={deleteSession}
          />
        )}

        {mainTab === "settings" && (
          <ProfileTab userProfile={userProfile} onLogout={onLogout} />
        )}
      </main>

      {showImportModal && (
        <ImportSessionModal
          draft={importDraft}
          setDraft={setImportDraft}
          onClose={closeImportModal}
          onSubmit={submitImportSession}
        />
      )}
      {shareModal.open && (
        <ShareSettingsModal
          title={shareModal.title}
          code={shareModal.code}
          hasWebcam={shareModal.hasWebcam}
          stripWebcam={shareModal.stripWebcam}
          onStripChange={(v) => setShareModal((prev) => ({ ...prev, stripWebcam: v }))}
          onGenerate={() => generateShareCode(shareModal.folderId, shareModal.stripWebcam)}
          onClose={closeShareModal}
        />
      )}
      {libraryLimitHit && (
        <LibraryLimitModal
          onClose={() => setLibraryLimitHit(false)}
          onGoLibrary={() => { setMainTab("library"); setView("main"); }}
        />
      )}
    </div>
  );
}
