import { useState, useRef, useCallback, useEffect } from "react";
import firebaseConfig, { isFirebaseConfigured } from "./firebase.js";
import "./styles.css";

// ═══════════════════════════════════════════════════
// Firebase — lazy loaded, awaited before use
// ═══════════════════════════════════════════════════
let db = null;
let fbRef, fbSet, fbGet, fbOnValue, fbRemove;
let firebaseReady = false;
let firebaseInitPromise = null;
let lastFirebaseLoadError = null;

function ensureFirebase() {
  if (firebaseInitPromise) return firebaseInitPromise;
  if (!isFirebaseConfigured()) {
    firebaseInitPromise = Promise.resolve(false);
    return firebaseInitPromise;
  }
  firebaseInitPromise = (async () => {
    try {
      const appMod = await import("firebase/app");
      const dbMod = await import("firebase/database");
      const fbApp = appMod.initializeApp(firebaseConfig);
      db = dbMod.getDatabase(fbApp);
      fbRef = dbMod.ref;
      fbSet = dbMod.set;
      fbGet = dbMod.get;
      fbOnValue = dbMod.onValue;
      fbRemove = dbMod.remove;
      firebaseReady = true;
      console.log("[SnapSort] Firebase initialized successfully");
      return true;
    } catch (e) {
      console.error("[SnapSort] Firebase init failed:", e);
      return false;
    }
  })();
  return firebaseInitPromise;
}

// ═══════════════════════════════════════════════════
// Storage — Firebase (cross-device) + localStorage (fallback)
// ═══════════════════════════════════════════════════
async function saveGroup(code, groupData) {
  console.log("[SnapSort] Saving group:", code, "photos:", groupData.photos?.length);

  let firebaseSaved = false;
  let firebaseError = null;

  // Firebase — save everything under groups/{code}
  if (firebaseReady && db) {
    try {
      // Save group info (without photos to keep it small)
      const groupInfo = {
        name: groupData.name || "",
        code: code,
        members: groupData.members || [],
        people: groupData.people || [],
        photoCount: groupData.photos?.length || 0,
        updatedAt: Date.now(),
      };
      await fbSet(fbRef(db, `groups/${code}/info`), groupInfo);

      // Save each photo separately
      if (groupData.photos && groupData.photos.length > 0) {
        for (let i = 0; i < groupData.photos.length; i++) {
          await fbSet(fbRef(db, `groups/${code}/photos/${i}`), groupData.photos[i]);
        }
      }
      console.log("[SnapSort] Saved to Firebase OK");
      firebaseSaved = true;
    } catch (e) {
      firebaseError = e;
      console.error("[SnapSort] Firebase save error:", e);
    }
  }

  // localStorage backup
  try {
    const { photos, ...meta } = groupData;
    meta.code = code;
    localStorage.setItem(`sg_${code}`, JSON.stringify(meta));
    const cs = 2;
    const chunks = Math.ceil((photos?.length || 0) / cs);
    for (let i = 0; i < chunks; i++) {
      localStorage.setItem(`sp_${code}_${i}`, JSON.stringify(photos.slice(i * cs, (i + 1) * cs)));
    }
    localStorage.setItem(`sc_${code}`, String(chunks));
  } catch (e) {
    console.warn("[SnapSort] localStorage save error:", e);
  }

  return { firebaseSaved, firebaseError };
}

async function loadGroup(code) {
  console.log("[SnapSort] Loading group:", code, "Firebase ready:", firebaseReady);
  lastFirebaseLoadError = null;

  // Try Firebase first
  if (firebaseReady && db) {
    try {
      // Check if group exists by reading info
      const infoSnap = await fbGet(fbRef(db, `groups/${code}/info`));
      console.log("[SnapSort] Firebase info exists:", infoSnap.exists());

      if (infoSnap.exists()) {
        const info = infoSnap.val();

        // Load photos
        let photos = [];
        try {
          const photosSnap = await fbGet(fbRef(db, `groups/${code}/photos`));
          if (photosSnap.exists()) {
            const photosData = photosSnap.val();
            // Firebase can return object or array
            if (Array.isArray(photosData)) {
              photos = photosData.filter(Boolean);
            } else if (typeof photosData === "object") {
              photos = Object.values(photosData).filter(Boolean);
            }
          }
        } catch (e) {
          console.warn("[SnapSort] Photo load error:", e);
        }

        console.log("[SnapSort] Loaded from Firebase:", info.name, "photos:", photos.length);
        return {
          name: info.name || "Group",
          code: code,
          members: info.members || [],
          people: info.people || [],
          photos: photos,
        };
      }
    } catch (e) {
      lastFirebaseLoadError = e;
      console.error("[SnapSort] Firebase load error:", e);
    }
  }

  // Fallback: localStorage
  try {
    const metaStr = localStorage.getItem(`sg_${code}`);
    if (!metaStr) {
      console.log("[SnapSort] Not found in localStorage either");
      return null;
    }
    const meta = JSON.parse(metaStr);
    const chunks = parseInt(localStorage.getItem(`sc_${code}`) || "0");
    const photos = [];
    for (let i = 0; i < chunks; i++) {
      const chunk = localStorage.getItem(`sp_${code}_${i}`);
      if (chunk) photos.push(...JSON.parse(chunk));
    }
    console.log("[SnapSort] Loaded from localStorage:", meta.name, "photos:", photos.length);
    return { ...meta, photos, code };
  } catch (e) {
    console.warn("[SnapSort] localStorage load error:", e);
    return null;
  }
}

function getFirebaseErrorText(err) {
  const code = typeof err?.code === "string" ? err.code : "";
  const message = typeof err?.message === "string" ? err.message : "";
  return `${code} ${message}`.toUpperCase();
}

function isPermissionDeniedError(err) {
  return getFirebaseErrorText(err).includes("PERMISSION_DENIED");
}

async function firebaseGroupExists(code) {
  if (!firebaseReady || !db) return false;
  try {
    const snap = await fbGet(fbRef(db, `groups/${code}/info`));
    return snap.exists();
  } catch (e) {
    lastFirebaseLoadError = e;
    return false;
  }
}

function getFirebaseLoadErrorCode() {
  return getFirebaseErrorText(lastFirebaseLoadError);
}

function listenGroup(code, callback) {
  if (!firebaseReady || !db) return () => {};
  try {
    const unsub = fbOnValue(fbRef(db, `groups/${code}`), snap => {
      if (!snap.exists()) return;
      const data = snap.val();
      const info = data.info || {};
      let photos = [];
      if (data.photos) {
        if (Array.isArray(data.photos)) photos = data.photos.filter(Boolean);
        else photos = Object.values(data.photos).filter(Boolean);
      }
      callback({
        name: info.name || "Group",
        code: code,
        members: info.members || [],
        people: info.people || [],
        photos: photos,
      });
    });
    return unsub;
  } catch (e) {
    console.error("[SnapSort] Listen error:", e);
    return () => {};
  }
}

// ═══════════════════════════════════════════════════
// Config & Helpers
// ═══════════════════════════════════════════════════
const API = import.meta.env.VITE_API_URL || "";
const PALETTE = [
  { bg: "linear-gradient(135deg,#f97316,#ea580c)", border: "#f97316" },
  { bg: "linear-gradient(135deg,#ec4899,#db2777)", border: "#ec4899" },
  { bg: "linear-gradient(135deg,#3b82f6,#2563eb)", border: "#3b82f6" },
  { bg: "linear-gradient(135deg,#a855f7,#7c3aed)", border: "#a855f7" },
  { bg: "linear-gradient(135deg,#22c55e,#16a34a)", border: "#22c55e" },
  { bg: "linear-gradient(135deg,#eab308,#ca8a04)", border: "#eab308" },
  { bg: "linear-gradient(135deg,#06b6d4,#0891b2)", border: "#06b6d4" },
  { bg: "linear-gradient(135deg,#f43f5e,#e11d48)", border: "#f43f5e" },
];

const genCode = () => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 6 }, () => c[Math.floor(Math.random() * c.length)]).join("");
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const readFile = file => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });

// ═══ DeepFace API ═══
async function apiHealth(addLog) {
  try {
    const r = await fetch(`${API}/api/health`);
    if (r.ok) { addLog("✓ DeepFace backend connected"); return true; }
    addLog(`✗ Backend responded ${r.status}`); return false;
  } catch (e) { addLog(`✗ Backend unreachable: ${e.message}`); return false; }
}

async function apiCluster(images, existing, addLog) {
  addLog(`→ Sending ${images.length} images to DeepFace...`);
  try {
    const r = await fetch(`${API}/api/cluster`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ images, existing_faces: existing }),
    });
    if (!r.ok) { addLog(`✗ Error ${r.status}: ${(await r.text()).slice(0, 150)}`); return null; }
    const data = await r.json();
    addLog(`✓ Done: ${data.people?.length || 0} people, ${data.comparisons || 0} comparisons`);
    return data;
  } catch (e) { addLog(`✗ Connection error: ${e.message}`); return null; }
}

// ═══ Components ═══
function Modal({ open, onClose, children }) {
  if (!open) return null;
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>✕</button>
        {children}
      </div>
    </div>
  );
}

function Overlay({ active, text, sub, progress }) {
  if (!active) return null;
  return (
    <div className="overlay">
      <div className="spinner"><div /><div /><div /></div>
      <div className="overlay-text">{text}</div>
      <div className="overlay-sub">{sub}</div>
      <div className="progress"><div style={{ width: `${progress}%` }} /></div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════
export default function App() {
  const [screen, setScreen] = useState("landing");
  const [modal, setModal] = useState(null);
  const [group, setGroup] = useState(null);
  const [user, setUser] = useState(null);
  const [code, setCode] = useState(null);
  const [tab, setTab] = useState("upload");
  const [toast, setToast] = useState("");
  const [lbox, setLbox] = useState(null);
  const [proc, setProc] = useState({ active: false, text: "", sub: "", progress: 0 });
  const [gName, setGName] = useState("");
  const [cName, setCName] = useState("");
  const [jCode, setJCode] = useState("");
  const [jName, setJName] = useState("");
  const [logs, setLogs] = useState([]);
  const [showLogs, setShowLogs] = useState(false);
  const [backendOk, setBackendOk] = useState(null);
  const [firebaseOk, setFirebaseOk] = useState(false);
  const [ready, setReady] = useState(false);
  const fileRef = useRef(null);
  const logRef = useRef(null);
  const unsubRef = useRef(null);

  const flash = useCallback(m => { setToast(m); setTimeout(() => setToast(""), 2500); }, []);
  const addLog = useCallback(msg => {
    const t = new Date().toLocaleTimeString();
    const type = msg.startsWith("✓") ? "ok" : msg.startsWith("✗") ? "err" : "info";
    setLogs(prev => [...prev.slice(-80), { t, msg, type }]);
    setTimeout(() => logRef.current?.scrollTo(0, logRef.current.scrollHeight), 50);
  }, []);

  // ─── Initialize everything on mount ───
  useEffect(() => {
    (async () => {
      // 1. Init Firebase (wait for it!)
      const fbOk = await ensureFirebase();
      setFirebaseOk(fbOk);
      if (fbOk) addLog("✓ Firebase connected");
      else addLog("ℹ Firebase not configured — local storage only");

      // 2. Check backend
      apiHealth(addLog).then(ok => setBackendOk(ok));

      // 3. Restore session
      const saved = localStorage.getItem("snapsort_session");
      if (saved) {
        try {
          const { code: c, user: u } = JSON.parse(saved);
          if (c && u) {
            const g = await loadGroup(c);
            if (g) {
              setGroup(g); setCode(c); setUser(u); setScreen("dashboard");
              // Start listening
              if (firebaseReady) {
                unsubRef.current = listenGroup(c, g2 => setGroup(g2));
              }
            }
          }
        } catch (e) {
          console.error("[SnapSort] Session restore error:", e);
        }
      }

      setReady(true);
    })();

    return () => { if (typeof unsubRef.current === "function") unsubRef.current(); };
  }, [addLog]);

  // ─── Create Group ───
  const doCreate = async () => {
    if (!gName.trim() || !cName.trim()) return;

    // Make sure Firebase is ready
    await ensureFirebase();

    const c = genCode();
    const g = {
      name: gName.trim(),
      code: c,
      members: [{ name: cName.trim(), id: Date.now(), isCreator: true }],
      photos: [],
      people: [],
    };

    const saveResult = await saveGroup(c, g);
    if (firebaseReady && !saveResult.firebaseSaved) {
      flash("Created locally, but Firebase save failed. Check Realtime Database rules.");
    } else if (firebaseReady) {
      const existsInFirebase = await firebaseGroupExists(c);
      if (!existsInFirebase) {
        if (isPermissionDeniedError(lastFirebaseLoadError)) {
          flash("Firebase connected but read blocked (PERMISSION_DENIED). Update read rules.");
        } else {
          flash("Group saved locally, but could not verify it in Firebase.");
        }
      }
    }
    localStorage.setItem("snapsort_session", JSON.stringify({ code: c, user: cName.trim() }));

    // Start listening
    if (typeof unsubRef.current === "function") unsubRef.current();
    if (firebaseReady) unsubRef.current = listenGroup(c, g2 => setGroup(g2));

    setGroup(g); setCode(c); setUser(cName.trim());
    setGName(""); setCName(""); setModal(null); setTab("upload"); setScreen("dashboard");
    flash("Group created! Code: " + c);
  };

  // ─── Join Group ───
  const doJoin = async () => {
    const c = jCode.trim().toUpperCase();
    if (!c || !jName.trim()) return;

    setProc({ active: true, text: "Joining...", sub: "Connecting to Firebase...", progress: 10 });

    // CRITICAL: Wait for Firebase to be ready before trying to load
    const fbOk = await ensureFirebase();
    setFirebaseOk(fbOk);

    setProc({ active: true, text: "Joining...", sub: `Looking for group ${c}...`, progress: 30 });

    const g = await loadGroup(c);

    if (!g) {
      setProc({ active: false, text: "", sub: "", progress: 0 });
      if (!fbOk) {
        flash("Group not found! Firebase is not configured — groups only work on the same device.");
      } else if (isPermissionDeniedError(lastFirebaseLoadError) || getFirebaseLoadErrorCode().includes("PERMISSION_DENIED")) {
        flash("Firebase blocked access (PERMISSION_DENIED). Update Realtime Database read rules.");
      } else {
        flash("Group not found! Check the code and try again.");
      }
      return;
    }

    setProc({ active: true, text: "Found it!", sub: `${g.name} — ${g.photos?.length || 0} photos`, progress: 60 });

    // Add member
    if (!g.members?.find(m => m.name === jName.trim())) {
      g.members = [...(g.members || []), { name: jName.trim(), id: Date.now(), isCreator: false }];
    }

    setProc({ active: true, text: "Saving...", sub: "Adding you to the group", progress: 80 });
    const saveResult = await saveGroup(c, g);
    if (firebaseReady && !saveResult.firebaseSaved) {
      if (isPermissionDeniedError(saveResult.firebaseError)) {
        flash("Joined group, but Firebase write is blocked (PERMISSION_DENIED). Update write rules.");
      } else {
        flash("Joined locally, but Firebase save failed. Check Realtime Database write rules.");
      }
    }
    localStorage.setItem("snapsort_session", JSON.stringify({ code: c, user: jName.trim() }));

    // Start listening
    if (typeof unsubRef.current === "function") unsubRef.current();
    if (firebaseReady) unsubRef.current = listenGroup(c, g2 => setGroup(g2));

    setProc({ active: true, text: `Welcome to ${g.name}!`, sub: `${g.photos?.length || 0} photos loaded`, progress: 100 });
    await sleep(600);
    setProc({ active: false, text: "", sub: "", progress: 0 });

    setGroup(g); setCode(c); setUser(jName.trim());
    setJCode(""); setJName(""); setModal(null); setTab("upload"); setScreen("dashboard");
  };

  const copyCode = () => { if (code) { navigator.clipboard.writeText(code); flash("Code copied!"); } };

  // ─── Process Photos ───
  const processPhotos = async files => {
    if (!group) return;
    if (!backendOk) { flash("Backend not connected! Start it first."); return; }
    setLogs([]); addLog(`═══ Processing ${files.length} photos ═══`);

    const images = [];
    for (let i = 0; i < files.length; i++) {
      setProc({ active: true, text: `Reading ${i + 1}/${files.length}`, sub: files[i].name, progress: (i / files.length) * 20 });
      const du = await readFile(files[i]);
      const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = du; });
      const cv = document.createElement("canvas");
      const s = Math.min(1024 / img.width, 1024 / img.height, 1);
      cv.width = Math.round(img.width * s); cv.height = Math.round(img.height * s);
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
      images.push({ id: `p_${Date.now()}_${i}`, data: cv.toDataURL("image/jpeg", 0.75), fileName: files[i].name });
    }

    const existing = [];
    (group.photos || []).forEach((p, pi) => {
      (p.faces || []).forEach((f, fi) => {
        if (f.thumb_b64) existing.push({ crop: f.thumb_b64, person_id: f.person_id ?? -1, photo_id: `e_${pi}`, face_idx: fi, box: f.box, thumb_b64: f.thumb_b64 });
      });
    });

    setProc({ active: true, text: "DeepFace analyzing...", sub: "Detecting → verifying → clustering", progress: 35 });
    const result = await apiCluster(images.map(i => ({ id: i.id, data: i.data })), existing, addLog);
    if (!result) { setProc({ active: false, text: "", sub: "", progress: 0 }); flash("Failed — check logs"); setShowLogs(true); return; }

    setProc({ active: true, text: "Building albums...", sub: `${result.people?.length || 0} people`, progress: 80 });
    const newPhotos = (result.photos || []).map(rp => ({
      dataUrl: images.find(im => im.id === rp.id)?.data || "",
      fileName: images.find(im => im.id === rp.id)?.fileName || "",
      uploadedBy: user,
      faces: (rp.faces || []).map(f => ({ box: f.box, confidence: f.confidence, person_id: f.person_id, personName: `Person ${(f.person_id ?? 0) + 1}`, thumb_b64: f.thumb_b64 })),
      timestamp: Date.now(),
    }));

    const people = (result.people || []).map(p => ({
      id: p.id, name: group.people?.find(ep => ep.id === p.id)?.name || `Person ${p.id + 1}`,
      thumbUrl: p.thumb_b64 ? `data:image/jpeg;base64,${p.thumb_b64}` : null, faceCount: p.face_count,
    }));

    const updated = { ...group, photos: [...(group.photos || []), ...newPhotos], people };
    setProc({ active: true, text: "Saving...", sub: "Syncing to Firebase", progress: 92 });
    await saveGroup(code, updated);
    setProc({ active: true, text: "Done! ✨", sub: `${files.length} photos → ${people.length} people`, progress: 100 });
    await sleep(800);
    setProc({ active: false, text: "", sub: "", progress: 0 });
    setGroup(updated);
  };

  const rename = async (pid, name) => {
    if (!name?.trim() || !group) return;
    const u = { ...group, people: group.people.map(p => p.id === pid ? { ...p, name: name.trim() } : p), photos: group.photos.map(p => ({ ...p, faces: (p.faces || []).map(f => f.person_id === pid ? { ...f, personName: name.trim() } : f) })) };
    setGroup(u); await saveGroup(code, u); flash("Renamed!");
  };

  const dlPerson = pid => {
    const person = group.people?.find(p => p.id === pid);
    group.photos.filter(p => p.faces?.some(f => f.person_id === pid)).forEach((p, i) => {
      setTimeout(() => { const a = document.createElement("a"); a.href = p.dataUrl; a.download = `${(person?.name || "photo").replace(/\s+/g, "_")}_${i + 1}.jpg`; a.click(); }, i * 300);
    });
  };

  const leave = () => {
    localStorage.removeItem("snapsort_session");
    if (typeof unsubRef.current === "function") unsubRef.current();
    setGroup(null); setCode(null); setUser(null); setScreen("landing");
  };

  const handleFiles = fl => { const arr = Array.from(fl).filter(f => f.type.startsWith("image/")); if (arr.length) processPhotos(arr); };

  const tFaces = group?.photos?.reduce((s, p) => s + (p.faces?.length || 0), 0) || 0;
  const gShots = group?.photos?.filter(p => (p.faces?.length || 0) > 1).length || 0;

  // Loading state
  if (!ready) {
    return (
      <div className="app" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <div style={{ textAlign: "center" }}>
          <div className="spinner" style={{ margin: "0 auto 16px" }}><div /><div /><div /></div>
          <div style={{ color: "#9896a8" }}>Loading SnapSort...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      {/* HEADER */}
      <header className="header">
        <div className="header-inner">
          <div className="logo" onClick={() => screen !== "dashboard" && setScreen("landing")}>
            <div className="logo-icon">📸</div>
            <span className="logo-text">Snap<em>Sort</em></span>
          </div>
          <div className="header-actions">
            <div className={`status-dot ${backendOk === true ? "ok" : backendOk === false ? "err" : "loading"}`} title={backendOk ? "DeepFace connected" : "Backend offline"} />
            <div className={`status-dot ${firebaseOk ? "ok" : "err"}`} title={firebaseOk ? "Firebase connected" : "Firebase offline"} style={{ marginLeft: -2 }} />
            {screen === "dashboard" && <button className="bs sm" onClick={leave}>← Leave</button>}
            <button className="bs sm" onClick={() => setModal("join")}>Join</button>
            <button className="bp sm" onClick={() => setModal("create")}>+ New</button>
          </div>
        </div>
      </header>

      <div className={`toast ${toast ? "show" : ""}`}>✓ {toast}</div>
      {lbox && <div className="lightbox" onClick={() => setLbox(null)}><img src={lbox} alt="" /></div>}
      <Overlay {...proc} />

      <Modal open={modal === "create"} onClose={() => setModal(null)}>
        <h2>Create a Group</h2>
        <p className="modal-sub">Share the invite code with friends</p>
        <label>Group Name</label>
        <input className="inp" value={gName} onChange={e => setGName(e.target.value)} placeholder="e.g. Goa Trip 2026" onKeyDown={e => e.key === "Enter" && doCreate()} />
        <label>Your Name</label>
        <input className="inp" value={cName} onChange={e => setCName(e.target.value)} placeholder="e.g. Arjun" onKeyDown={e => e.key === "Enter" && doCreate()} />
        <button className="bp full" onClick={doCreate}>Create Group →</button>
      </Modal>

      <Modal open={modal === "join"} onClose={() => setModal(null)}>
        <h2>Join a Group</h2>
        <p className="modal-sub">Enter the invite code</p>
        <label>Invite Code</label>
        <input className="inp code-input" value={jCode} onChange={e => setJCode(e.target.value.toUpperCase())} placeholder="ABC123" maxLength={6} onKeyDown={e => e.key === "Enter" && doJoin()} />
        <label>Your Name</label>
        <input className="inp" value={jName} onChange={e => setJName(e.target.value)} placeholder="e.g. Priya" onKeyDown={e => e.key === "Enter" && doJoin()} />
        <button className="bp full" onClick={doJoin}>Join Group →</button>
        {!firebaseOk && <div style={{ marginTop: 14, padding: 10, background: "rgba(249,115,22,.08)", border: "1px solid rgba(249,115,22,.2)", borderRadius: 8, fontSize: 12, color: "#f97316", lineHeight: 1.5 }}>⚠ Firebase not configured. Joining only works on the same device where the group was created.</div>}
      </Modal>

      {/* LANDING */}
      {screen === "landing" && (
        <div>
          <section className="hero">
            <div className="hero-glow" />
            <div className="badge">
              <span className="badge-dot" />
              DeepFace AI • {firebaseOk ? "Firebase Sync ✓" : "Local Mode"}
            </div>
            <h1>Trip photos,<br /><em>auto-sorted.</em></h1>
            <p>Upload group photos. <strong>DeepFace</strong> detects faces with RetinaFace, matches with VGG-Face, and sorts by person.</p>
            <div className="hero-cta">
              <button className="bp blg" onClick={() => setModal("create")}>Create a Group</button>
              <button className="bs blg" onClick={() => setModal("join")}>Join with Code</button>
            </div>
            {backendOk === false && (
              <div className="backend-warning">
                ⚠ DeepFace backend not connected.<br />
                Run: <code>cd backend && source venv/bin/activate && python app.py</code>
              </div>
            )}
            {!firebaseOk && (
              <div className="firebase-warning">
                ℹ Firebase not configured — groups only work on this device.<br />
                Edit <code>frontend/src/firebase.js</code> with your Firebase config for cross-device sync.
              </div>
            )}
          </section>
          <section className="features">
            {[
              { i: "🧠", t: "DeepFace AI", d: "RetinaFace detection + VGG-Face verification. Real neural network face matching via DeepFace.verify().", c: "#f97316" },
              { i: "🌐", t: firebaseOk ? "Firebase Sync ✓" : "Cross-Device Sync", d: firebaseOk ? "Connected! Groups sync across all devices in real-time." : "Configure Firebase to sync groups across devices.", c: "#a855f7" },
              { i: "⬇️", t: "Per-Person Download", d: "Download just your photos. Rename detected people. Clean personalized albums.", c: "#ec4899" },
            ].map((f, i) => (
              <div key={i} className="feature-card" style={{ animationDelay: `${i * 0.1}s` }}>
                <div className="feature-icon">{f.i}</div>
                <h3>{f.t}</h3>
                <p>{f.d}</p>
              </div>
            ))}
          </section>
        </div>
      )}

      {/* DASHBOARD */}
      {screen === "dashboard" && group && (
        <div className="dashboard">
          <div className="dash-header">
            <div>
              <h1>{group.name}</h1>
              <p className="dash-meta">{group.members?.length || 0} members • {group.photos?.length || 0} photos</p>
            </div>
            <div className="code-badge" onClick={copyCode}>
              <span className="code-label">INVITE CODE</span>
              <span className="code-value">{code}</span>
              <span>📋</span>
            </div>
          </div>

          <div className="stats">
            {[{ n: group.photos?.length || 0, l: "Photos" }, { n: tFaces, l: "Faces" }, { n: group.people?.length || 0, l: "People" }, { n: gShots, l: "Group" }].map((s, i) => (
              <div key={i} className="stat"><div className="stat-num">{s.n}</div><div className="stat-label">{s.l}</div></div>
            ))}
          </div>

          <div className="tabs">
            {["upload", "people", "all", "members"].map(t => (
              <button key={t} className={`tab ${tab === t ? "on" : ""}`} onClick={() => setTab(t)}>
                {{ upload: "Upload", people: "People", all: "All Photos", members: "Members" }[t]}
              </button>
            ))}
          </div>

          {tab === "upload" && (
            <div>
              <div className="upload-zone" onClick={() => fileRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add("drag"); }}
                onDragLeave={e => e.currentTarget.classList.remove("drag")}
                onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove("drag"); handleFiles(e.dataTransfer.files); }}>
                <div className="upload-icon">📁</div>
                <h3>Drop photos here or click to browse</h3>
                <p>Sent to DeepFace → {firebaseOk ? "Synced via Firebase" : "Saved locally"}</p>
                <input ref={fileRef} type="file" multiple accept="image/*" style={{ display: "none" }} onChange={e => { handleFiles(e.target.files); e.target.value = ""; }} />
              </div>

              <div className="log-controls">
                <button className="bs sm" onClick={() => setShowLogs(!showLogs)}>{showLogs ? "Hide" : "Show"} Logs ({logs.length})</button>
                <button className="bs sm" onClick={() => apiHealth(addLog)}>Test Backend</button>
                {logs.length > 0 && <button className="bs sm" onClick={() => setLogs([])}>Clear</button>}
              </div>

              {showLogs && (
                <div className="log-panel" ref={logRef}>
                  {logs.map((l, i) => (<div key={i} className={`log-entry ${l.type}`}><span className="log-time">{l.t}</span> {l.msg}</div>))}
                  {logs.length === 0 && <div className="log-entry">Upload photos to see DeepFace activity.</div>}
                </div>
              )}

              {(group.photos?.length || 0) > 0 && (
                <div className="photo-grid">
                  {group.photos.slice(-30).map((p, i) => (
                    <div key={i} className="photo-card" onClick={() => setLbox(p.dataUrl)}>
                      <img src={p.dataUrl} alt="" loading="lazy" />
                      <div className="photo-badges">
                        {(p.faces?.length || 0) === 0 ? <span className="badge-tag scene">🏞</span> : <span className="badge-tag">👤{p.faces.length}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === "people" && (
            <div>
              {(group.people?.length || 0) === 0 ? (
                <div className="empty"><div className="empty-icon">🧑‍🤝‍🧑</div><h3>No people detected</h3><p>Upload photos for DeepFace to analyze</p></div>
              ) : (
                <>
                  {[...(group.people || [])].sort((a, b) => (b.faceCount || 0) - (a.faceCount || 0)).map(person => {
                    const pp = group.photos?.filter(p => p.faces?.some(f => f.person_id === person.id)) || [];
                    const ci = person.id % PALETTE.length;
                    return (
                      <div key={person.id} className="person-section">
                        <div className="person-header">
                          <div className="person-avatar" style={{ borderColor: PALETTE[ci].border }}>
                            {person.thumbUrl ? <img src={person.thumbUrl} alt="" /> : <div className="avatar-placeholder" style={{ background: PALETTE[ci].bg }}>{person.name[0]}</div>}
                          </div>
                          <div><div className="person-name">{person.name}</div><div className="person-count">{pp.length} photos</div></div>
                          <div className="person-actions">
                            <input defaultValue={person.name} className="inp sm" onKeyDown={e => e.key === "Enter" && rename(person.id, e.target.value)} />
                            <button className="bs sm" onClick={e => rename(person.id, e.currentTarget.previousElementSibling.value)}>Save</button>
                            <button className="bp sm" onClick={() => dlPerson(person.id)}>⬇</button>
                          </div>
                        </div>
                        <div className="photo-grid sm">
                          {pp.map((p, pi) => <div key={pi} className="photo-card" onClick={() => setLbox(p.dataUrl)}><img src={p.dataUrl} alt="" loading="lazy" /></div>)}
                        </div>
                      </div>
                    );
                  })}
                  <div className="download-all">
                    <span className="dl-icon">📦</span>
                    <div><h3>Download All</h3><p>Every photo from this group</p></div>
                    <button className="bp" onClick={() => group.photos?.forEach((p, i) => { setTimeout(() => { const a = document.createElement("a"); a.href = p.dataUrl; a.download = `${group.name?.replace(/\s+/g, "_")}_${i + 1}.jpg`; a.click(); }, i * 200); })} style={{ marginLeft: "auto" }}>Download</button>
                  </div>
                </>
              )}
            </div>
          )}

          {tab === "all" && (
            (group.photos?.length || 0) === 0 ? <div className="empty"><div className="empty-icon">📷</div><h3>No photos yet</h3></div> :
              <div className="photo-grid">
                {group.photos.map((p, i) => (
                  <div key={i} className="photo-card" onClick={() => setLbox(p.dataUrl)}>
                    <img src={p.dataUrl} alt="" loading="lazy" />
                    {(p.faces || []).map((f, fi) => f.box && <div key={fi} className="face-box" style={{ left: `${f.box.x}%`, top: `${f.box.y}%`, width: `${f.box.w}%`, height: `${f.box.h}%`, borderColor: PALETTE[(f.person_id ?? 0) % PALETTE.length].border }} />)}
                    <div className="photo-badges">
                      {(p.faces || []).map((f, fi) => <span key={fi} className="badge-tag" style={{ borderBottom: `2px solid ${PALETTE[(f.person_id ?? 0) % PALETTE.length].border}` }}>{f.personName || `P${(f.person_id ?? 0) + 1}`}</span>)}
                      {(p.faces?.length || 0) > 1 && <span className="badge-tag group">Group</span>}
                    </div>
                  </div>
                ))}
              </div>
          )}

          {tab === "members" && (
            <div className="members-grid">
              {(group.members || []).map((m, i) => (
                <div key={m.id || i} className="member-card">
                  <div className="member-avatar" style={{ background: PALETTE[i % PALETTE.length].bg }}>{m.name?.[0]?.toUpperCase()}</div>
                  <div><div className="member-name">{m.name}</div><div className="member-role">{m.isCreator ? "👑 Creator" : "Member"}{m.name === user ? " (You)" : ""}</div></div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
