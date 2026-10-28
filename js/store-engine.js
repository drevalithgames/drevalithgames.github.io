/**
 * ============================================================================
 * DREVALITH GAMES™ — HYBRID REALTIME DATABASE + VERIFIED ACCOUNTS ENGINE v8
 * ============================================================================
 * - 100% Free Spark Architecture: Firebase Realtime Database + Direct Google Drive
 *   (Zero paid Firebase Cloud Storage!)
 * - Bulletproof Player Sign Up & Email Verification:
 *   1. Calls native Firebase sendEmailVerification(user) with ZERO custom
 *      continueUrl so Firebase never blocks email dispatch with unauthorized-uri.
 *   2. Uses persistent localStorage 90-second per-email cooldown across tabs so
 *      Firebase never throws auth/too-many-requests.
 *   3. Smart recovery if an unverified email already exists in Firebase Auth
 *      (signs in seamlessly, updates Name, and watches verification live).
 *   4. NO "I clicked the verification link" button — a 2-second + tab-focus live
 *      watcher detects emailVerified === true automatically, refreshes the JWT
 *      ID token with retry-backed RTDB propagation, saves { name, email } into
 *      /users/{uid}/profile, fetches Name & Email directly back from Firebase
 *      Database, and opens the player's Account & Profile automatically!
 * - Reliable 25 MB .ZIP Capability Vault Download (rtdb_gate_blob:, rtdb_blob:,
 *   rtdb_chunks:, and AES-256-GCM protected Google Drive links).
 * ============================================================================
 */
(function () {
  "use strict";

  const CFG = window.DREVALITH_CONFIG || {};
  const API_BASE = String(CFG.BACKEND_API_URL || "").replace(/\/+$/, "");
  const UNLOCK_RECEIPTS_KEY = "drevalith_verified_unlocks_v4";
  const VERIFY_COOLDOWN_PREFIX = "drev_verify_email_ts_v8_";
  const PENDING_NAME_PREFIX = "drev_pending_signup_name_v8_";
  const PENDING_TERMS_PREFIX = "drev_pending_terms_v15_";
  const TERMS_VERSION = "v1.0";
  const VERIFY_COOLDOWN_MS = 90 * 1000; // 90s persistent cross-tab cooldown prevents auth/too-many-requests

  const broadcastBus =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("drevalith_store_realtime_v4")
      : null;

  function isFirebaseConfigured() {
    const fc = CFG.FIREBASE_CONFIG;
    return Boolean(
      fc &&
        fc.apiKey &&
        !String(fc.apiKey).startsWith("YOUR_") &&
        fc.projectId &&
        !String(fc.projectId).startsWith("YOUR_")
    );
  }

  function isRealtimeDbConfigured() {
    const fc = CFG.FIREBASE_CONFIG;
    return Boolean(
      isFirebaseConfigured() &&
        fc.databaseURL &&
        !String(fc.databaseURL).includes("YOUR_PROJECT_ID")
    );
  }

  let latestPublicGamesCache = [];
  let latestPublicSettingsCache = {};
  let hasLoadedLiveGamesSnapshot = false;

  function getActiveRazorpayKeyId() {
    const cfgKey = String(CFG.RAZORPAY_KEY_ID || "").trim();
    if (cfgKey && !cfgKey.startsWith("YOUR_") && cfgKey.startsWith("rzp_")) {
      return cfgKey;
    }
    const dbKey = String((latestPublicSettingsCache && latestPublicSettingsCache.razorpayKeyId) || "").trim();
    if (dbKey && !dbKey.startsWith("YOUR_") && dbKey.startsWith("rzp_")) {
      return dbKey;
    }
    return "";
  }

  function isRazorpayLiveKeyConfigured() {
    return Boolean(getActiveRazorpayKeyId());
  }

  function isStaticGithubHostWithoutBackend() {
    if (API_BASE) return false;
    const h = (typeof location !== "undefined" && location.hostname) || "";
    return h.endsWith(".github.io") || h.endsWith(".pages.dev") || h.endsWith(".netlify.app");
  }

  // --------------------------------------------------------------------------
  // WebCrypto Helpers (SHA-256 + PBKDF2-HMAC-SHA256 + AES-256-GCM)
  // --------------------------------------------------------------------------
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256Hex(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function deriveAesKeyFromPassphrase(passphrase, saltBytes) {
    const baseKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: 100000, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  async function decryptAesGcmEnvelope(passphrase, saltB64, ivB64, cipherB64) {
    const salt = b64ToBytes(saltB64);
    const iv = b64ToBytes(ivB64);
    const cipherBytes = b64ToBytes(cipherB64);
    const key = await deriveAesKeyFromPassphrase(passphrase, salt);
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipherBytes);
    return new TextDecoder().decode(plainBuf);
  }

  // --------------------------------------------------------------------------
  // Google Drive Direct Helpers
  // --------------------------------------------------------------------------
  function extractGoogleDriveId(url) {
    const u = String(url || "").trim();
    let m = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,})/);
    if (!m) m = u.match(/drive\.(?:google|usercontent)\.com\/(?:open|uc|download)\?.*?[?&]?id=([a-zA-Z0-9_-]{10,})/);
    return m ? m[1] : "";
  }

  function normalizePublicCoverUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    if (u.startsWith("data:") || u.startsWith("blob:")) return u;
    if (u.startsWith("/") && API_BASE) return `${API_BASE}${u}`;
    const driveId = extractGoogleDriveId(u);
    if (driveId) return `https://lh3.googleusercontent.com/d/${driveId}=w1280`;
    return u;
  }

  function normalizeExternalDownloadUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    const driveId = extractGoogleDriveId(u);
    if (driveId) {
      return `https://drive.usercontent.google.com/download?id=${driveId}&export=download&confirm=t`;
    }
    if (u.includes("dropbox.com/")) {
      const cleaned = u.replace(/[?&]dl=0\b/, "");
      return cleaned + (cleaned.includes("?") ? "&dl=1" : "?dl=1");
    }
    return u;
  }

  function sleepMs(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function getRtdbRestBaseUrl() {
    const fc = CFG.FIREBASE_CONFIG || {};
    return String(fc.databaseURL || "").trim().replace(/\/+$/, "");
  }

  async function rtdbRestJson(method, path, bodyObj, idToken) {
    const base = getRtdbRestBaseUrl();
    if (!base) throw new Error("Firebase databaseURL is missing in js/store-config.js.");
    const cleanPath = String(path || "").replace(/^\/+|\/+$/g, "");
    const authQ = idToken ? `?auth=${encodeURIComponent(idToken)}` : "";
    const url = `${base}/${cleanPath}.json${authQ}`;
    const opts = {
      method,
      headers: { "Content-Type": "application/json" },
      cache: "no-store"
    };
    if (bodyObj !== undefined && method !== "GET" && method !== "DELETE") {
      opts.body = JSON.stringify(bodyObj);
    }
    const res = await fetch(url, opts);
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Firebase HTTP ${res.status}: ${txt.slice(0, 120) || res.statusText}`);
    }
    return res.json();
  }

  // --------------------------------------------------------------------------
  // Local Device Receipt Cache
  // --------------------------------------------------------------------------
  function getSavedUnlocks() {
    try {
      const raw = localStorage.getItem(UNLOCK_RECEIPTS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      const now = Date.now();
      let changed = false;
      for (const gid of Object.keys(parsed)) {
        if (parsed[gid].expiresAt && parsed[gid].expiresAt < now) {
          delete parsed[gid];
          changed = true;
        }
      }
      if (changed) localStorage.setItem(UNLOCK_RECEIPTS_KEY, JSON.stringify(parsed));
      return parsed;
    } catch (_) {
      return {};
    }
  }

  function saveUnlockReceipt(gameId, receipt) {
    const map = getSavedUnlocks();
    const uid = currentVerifiedPlayer ? currentVerifiedPlayer.uid : "";
    const nowTs = Date.now();
    map[gameId] = {
      ...receipt,
      uid,
      unlockedAt: receipt.unlockedAt || nowTs,
      expiresAt: nowTs + (receipt.expiresInMinutes || 10080) * 60 * 1000
    };
    try {
      localStorage.setItem(UNLOCK_RECEIPTS_KEY, JSON.stringify(map));
    } catch (_) {}

    if (currentVerifiedPlayer) {
      const gObj = latestPublicGamesCache.find((g) => g.id === gameId) || {};
      currentPlayerPurchases = {
        ...currentPlayerPurchases,
        [gameId]: {
          gameId,
          gameTitle: gObj.title || receipt.gameTitle || "Drevalith Game",
          coverImageUrl: gObj.coverImageUrl || "",
          unlockMethod: receipt.method || "razorpay",
          paymentId: receipt.paymentId || "",
          amount: Number(gObj.price || 0),
          currency: gObj.currency || "USD",
          purchasedAt: receipt.unlockedAt || nowTs,
          purchasedVersion: gObj.version || "v1.0.0",
          lastDownloadedVersion: gObj.version || "v1.0.0",
          lastDownloadedBuildUpdatedAt: Number(gObj.buildUpdatedAt || gObj.updatedAt || nowTs),
          downloadRef: receipt.rawDownloadRef || ""
        }
      };
      emitAuthState();
    }
  }

  function getUnlockForGame(gameId) {
    if (hasLoadedLiveGamesSnapshot && !latestPublicGamesCache.some((g) => g.id === gameId)) {
      return null;
    }
    if (isFirebaseConfigured()) {
      if (!currentVerifiedPlayer) return null;
      if (currentPlayerPurchases && currentPlayerPurchases[gameId]) {
        return currentPlayerPurchases[gameId];
      }
      const map = getSavedUnlocks();
      const rec = map[gameId];
      if (rec && (!rec.uid || rec.uid === currentVerifiedPlayer.uid)) {
        return rec;
      }
      return null;
    }
    const map = getSavedUnlocks();
    return map[gameId] || null;
  }

  async function reconcilePurchasesWithLiveGames() {
    if (!hasLoadedLiveGamesSnapshot) return;
    const liveIds = new Set(latestPublicGamesCache.map((g) => g.id));

    // 1. Clean orphaned local unlock receipts for games deleted by Owner
    try {
      const localMap = getSavedUnlocks();
      let localChanged = false;
      for (const gid of Object.keys(localMap)) {
        if (!liveIds.has(gid)) {
          delete localMap[gid];
          localChanged = true;
        }
      }
      if (localChanged) {
        localStorage.setItem(UNLOCK_RECEIPTS_KEY, JSON.stringify(localMap));
      }
    } catch (_) {}

    // 2. Clean orphaned /users/{uid}/purchases/{gid} for games deleted by Owner
    const staleIds = Object.keys(currentPlayerPurchases || {}).filter((gid) => !liveIds.has(gid));
    if (!staleIds.length) return;

    const nextPurchases = { ...currentPlayerPurchases };
    for (const gid of staleIds) {
      delete nextPurchases[gid];
    }
    currentPlayerPurchases = nextPurchases;
    emitAuthState();

    if (currentVerifiedPlayer && isRealtimeDbConfigured()) {
      try {
        const svc = await getFirebasePublicServices();
        const user = svc && svc.auth ? svc.auth.currentUser : null;
        if (!user || !user.emailVerified) return;
        const freshToken = await user.getIdToken();
        await Promise.all(
          staleIds.map((gid) =>
            rtdbRestJson("DELETE", `users/${user.uid}/purchases/${gid}`, undefined, freshToken).catch(
              async () => {
                if (svc.rtdb && svc.dbMod) {
                  await svc.dbMod.remove(svc.dbMod.ref(svc.rtdb, `users/${user.uid}/purchases/${gid}`)).catch(() => {});
                }
              }
            )
          )
        );
      } catch (_) {}
    }
  }

  function normalizePrivateKeyClean(raw) {
    return String(raw || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function formatPrivateKeyInput(raw) {
    const clean = normalizePrivateKeyClean(raw);
    if (clean.startsWith("DREV") && clean.length <= 16) {
      const parts = ["DREV"];
      const rest = clean.slice(4);
      for (let i = 0; i < rest.length; i += 4) parts.push(rest.slice(i, i + 4));
      return parts.filter(Boolean).join("-");
    }
    const groups = clean.match(/.{1,4}/g) || [];
    return groups.join("-");
  }

  function formatPrice(price, currency, isFree) {
    if (isFree || Number(price) <= 0) return "FREE";
    const cur = String(currency || "USD").toUpperCase();
    const num = Number(price);
    if (cur === "INR") return `₹${num % 1 === 0 ? num.toFixed(0) : num.toFixed(2)}`;
    return `$${num.toFixed(2)}`;
  }

  // --------------------------------------------------------------------------
  // Firebase SDK Loader (Auth + Realtime Database)
  // --------------------------------------------------------------------------
  let fbServicesCache = null;

  async function getFirebasePublicServices() {
    if (!isFirebaseConfigured()) return null;
    if (fbServicesCache) return fbServicesCache;

    const ver = CFG.FIREBASE_SDK_VERSION || "11.0.2";
    const base = `https://www.gstatic.com/firebasejs/${ver}`;
    const [appMod, authMod, dbMod] = await Promise.all([
      import(`${base}/firebase-app.js`),
      import(`${base}/firebase-auth.js`),
      import(`${base}/firebase-database.js`)
    ]);

    const app = appMod.getApps().length
      ? appMod.getApp()
      : appMod.initializeApp(CFG.FIREBASE_CONFIG);

    fbServicesCache = {
      app,
      auth: authMod.getAuth(app),
      rtdb: isRealtimeDbConfigured() ? dbMod.getDatabase(app) : null,
      authMod,
      dbMod
    };
    return fbServicesCache;
  }

  async function getPublicRealtimeDb() {
    const svc = await getFirebasePublicServices();
    return svc && svc.rtdb ? { rtdb: svc.rtdb, dbMod: svc.dbMod } : null;
  }

  // --------------------------------------------------------------------------
  // Persistent Cross-Tab Cooldown & Pending Name Helpers
  // --------------------------------------------------------------------------
  function getVerifyCooldownRemainingSec(email) {
    try {
      const key = VERIFY_COOLDOWN_PREFIX + String(email || "").trim().toLowerCase();
      const last = Number(localStorage.getItem(key) || 0);
      if (!last) return 0;
      const diff = VERIFY_COOLDOWN_MS - (Date.now() - last);
      return diff > 0 ? Math.ceil(diff / 1000) : 0;
    } catch (_) {
      return 0;
    }
  }

  function markVerificationSentNow(email) {
    try {
      const key = VERIFY_COOLDOWN_PREFIX + String(email || "").trim().toLowerCase();
      localStorage.setItem(key, String(Date.now()));
    } catch (_) {}
  }

  function savePendingSignupName(email, name) {
    if (!email || !name) return;
    try {
      localStorage.setItem(PENDING_NAME_PREFIX + email.trim().toLowerCase(), name.trim());
    } catch (_) {}
  }

  function getSavedPendingSignupName(email) {
    if (!email) return "";
    try {
      return localStorage.getItem(PENDING_NAME_PREFIX + email.trim().toLowerCase()) || "";
    } catch (_) {
      return "";
    }
  }

  function savePendingTermsAcceptance(email, termsObj) {
    if (!email || !termsObj) return;
    try {
      localStorage.setItem(PENDING_TERMS_PREFIX + email.trim().toLowerCase(), JSON.stringify(termsObj));
    } catch (_) {}
  }

  function getSavedPendingTermsAcceptance(email) {
    if (!email) return null;
    try {
      const raw = localStorage.getItem(PENDING_TERMS_PREFIX + email.trim().toLowerCase());
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  async function safeSendVerificationEmail(authMod, user, forceManualResend = false) {
    const email = (user.email || "").trim().toLowerCase();
    const waitSec = getVerifyCooldownRemainingSec(email);
    if (waitSec > 0) {
      if (forceManualResend) {
        throw new Error(
          `Verification email was already sent! Please check your Inbox & Spam folder, or wait ${waitSec}s before resending.`
        );
      }
      return { sent: false, alreadySentRecently: true, waitSec };
    }

    try {
      // CRITICAL: Call sendEmailVerification(user) with NO actionCodeSettings!
      // Passing custom continueUrl causes Firebase to block sending with auth/unauthorized-continue-uri.
      await authMod.sendEmailVerification(user);
      markVerificationSentNow(email);
      return { sent: true, waitSec: Math.ceil(VERIFY_COOLDOWN_MS / 1000) };
    } catch (err) {
      const code = String(err.code || err.message || "");
      if (code.includes("auth/too-many-requests")) {
        markVerificationSentNow(email);
        if (forceManualResend) {
          throw new Error(
            "A verification link was already sent recently. Please check your inbox and spam folder."
          );
        }
        return { sent: false, alreadySentRecently: true, rateLimitedGracefully: true, waitSec: 90 };
      }
      throw err;
    }
  }

  // --------------------------------------------------------------------------
  // PLAYER ACCOUNT AUTH + LIVE AUTO-VERIFICATION + DIRECT DB PROFILE FETCH
  // --------------------------------------------------------------------------
  let currentVerifiedPlayer = null;
  let currentDbProfile = null; // Authoritative { name, email, ... } fetched directly from /users/{uid}/profile
  let pendingVerificationEmail = "";
  let currentPlayerPurchases = {};
  let unsubPurchasesRef = null;
  let unsubProfileRef = null;
  let autoVerifyInterval = null;
  let activatingVerifiedSession = false;
  const authSubscribers = new Set();
  let authWatcherStarted = false;

  function emitAuthState() {
    const snapshot = {
      user: currentVerifiedPlayer,
      dbProfile: currentDbProfile ? { ...currentDbProfile } : null,
      pendingVerificationEmail,
      cooldownSec: pendingVerificationEmail ? getVerifyCooldownRemainingSec(pendingVerificationEmail) : 0,
      purchases: { ...currentPlayerPurchases }
    };
    authSubscribers.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (_) {}
    });
  }

  function stopAutoVerificationWatcher() {
    if (autoVerifyInterval) {
      clearInterval(autoVerifyInterval);
      autoVerifyInterval = null;
    }
  }

  // Automatically polls Firebase every 2.0s + on tab focus/visibility — NO manual button needed!
  function startLiveAutoVerificationWatcher() {
    if (autoVerifyInterval) return;

    const checkNow = async () => {
      if (activatingVerifiedSession || currentVerifiedPlayer) {
        stopAutoVerificationWatcher();
        return;
      }
      try {
        const svc = await getFirebasePublicServices();
        if (!svc || !svc.auth.currentUser) {
          stopAutoVerificationWatcher();
          return;
        }
        await svc.authMod.reload(svc.auth.currentUser);
        if (svc.auth.currentUser.emailVerified) {
          stopAutoVerificationWatcher();
          await activateVerifiedPlayerSession(svc.auth.currentUser);
        }
      } catch (_) {}
    };

    autoVerifyInterval = setInterval(checkNow, 2000);

    if (typeof window !== "undefined" && !window.__drevFocusVerifyBoundV8) {
      window.__drevFocusVerifyBoundV8 = true;
      window.addEventListener("focus", () => {
        if (pendingVerificationEmail && !currentVerifiedPlayer) checkNow();
      });
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && pendingVerificationEmail && !currentVerifiedPlayer) {
          checkNow();
        }
      });
    }
  }

  // Explicitly fetches the player's Profile (Name & Email) directly from Firebase Realtime Database via HTTPS REST!
  async function fetchPlayerProfileFromDb() {
    if (!isRealtimeDbConfigured()) return currentDbProfile;
    const svc = await getFirebasePublicServices();
    if (!svc || !svc.auth.currentUser || !svc.auth.currentUser.emailVerified) return currentDbProfile;

    const uid = svc.auth.currentUser.uid;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const freshToken = await svc.auth.currentUser.getIdToken(attempt > 0);
        const val = await rtdbRestJson("GET", `users/${uid}/profile`, undefined, freshToken);
        if (val && typeof val === "object") {
          currentDbProfile = {
            ...val,
            name: val.name || val.displayName || svc.auth.currentUser.displayName || "Player",
            email: val.email || (svc.auth.currentUser.email || "").toLowerCase(),
            fetchedFromDatabase: true,
            dbRulesWarning: false
          };
          if (currentVerifiedPlayer) {
            currentVerifiedPlayer.name = currentDbProfile.name;
            currentVerifiedPlayer.displayName = currentDbProfile.name;
            currentVerifiedPlayer.email = currentDbProfile.email;
          }
          emitAuthState();
          return currentDbProfile;
        }
        break;
      } catch (_) {
        await sleepMs(350 * (attempt + 1));
      }
    }
    return currentDbProfile;
  }

  // Writes verified player info to /users/{uid}/profile via Authenticated HTTPS REST (zero WebSocket token lag!)
  // AND immediately fetches Name & Email directly back from Firebase Database!
  async function writeAndFetchPlayerProfileFromDatabase(user, explicitName) {
    const emailLower = (user.email || "").trim().toLowerCase();
    const pendingName = explicitName || getSavedPendingSignupName(emailLower) || user.displayName || "";
    const fallbackName = pendingName || (emailLower ? emailLower.split("@")[0] : "Player");

    if (!isRealtimeDbConfigured()) {
      currentDbProfile = {
        uid: user.uid,
        name: fallbackName,
        displayName: fallbackName,
        email: emailLower,
        emailVerified: true,
        fetchedFromDatabase: false,
        dbRulesWarning: false
      };
      return currentDbProfile;
    }

    let lastDbErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const freshToken = await user.getIdToken(true);
        const existingVal = await rtdbRestJson("GET", `users/${user.uid}/profile`, undefined, freshToken).catch(() => null);

        const finalName =
          explicitName ||
          (existingVal && (existingVal.name || existingVal.displayName)) ||
          pendingName ||
          fallbackName;

        const pendingTerms = getSavedPendingTermsAcceptance(emailLower);
        const existingConsent = await rtdbRestJson("GET", `users/${user.uid}/terms_consent`, undefined, freshToken).catch(() => null);
        const resolvedTermsAcceptedAt =
          (existingVal && existingVal.termsAcceptedAt) ||
          (existingConsent && existingConsent.acceptedAt) ||
          (pendingTerms && pendingTerms.acceptedAt) ||
          Date.now();
        const resolvedTermsVersion =
          (existingVal && existingVal.termsVersion) ||
          (existingConsent && existingConsent.termsVersion) ||
          (pendingTerms && pendingTerms.termsVersion) ||
          TERMS_VERSION;

        const profilePayload = {
          uid: user.uid,
          name: finalName,
          displayName: finalName,
          email: emailLower,
          emailVerified: true,
          termsAccepted: true,
          termsVersion: resolvedTermsVersion,
          termsAcceptedAt: resolvedTermsAcceptedAt,
          termsAcceptedDate: new Date(resolvedTermsAcceptedAt).toISOString(),
          noRefundPolicyAccepted: true,
          horrorAndGameRiskAccepted: true,
          createdAt: (existingVal && existingVal.createdAt) || Date.now(),
          lastLoginAt: Date.now()
        };

        await rtdbRestJson("PUT", `users/${user.uid}/profile`, profilePayload, freshToken);

        // Authoritative GET directly back from Firebase Realtime Database!
        const dbData = (await rtdbRestJson("GET", `users/${user.uid}/profile`, undefined, freshToken)) || profilePayload;

        currentDbProfile = {
          ...dbData,
          name: dbData.name || dbData.displayName || finalName,
          email: dbData.email || emailLower,
          fetchedFromDatabase: true,
          dbRulesWarning: false
        };

        try {
          localStorage.removeItem(PENDING_NAME_PREFIX + emailLower);
          localStorage.removeItem(PENDING_TERMS_PREFIX + emailLower);
        } catch (_) {}

        try {
          const { rtdb, dbMod } = await getPublicRealtimeDb();
          if (unsubProfileRef) {
            unsubProfileRef();
            unsubProfileRef = null;
          }
          unsubProfileRef = dbMod.onValue(dbMod.ref(rtdb, `users/${user.uid}/profile`), (snap) => {
            if (snap.exists()) {
              const v = snap.val();
              currentDbProfile = {
                ...v,
                name: v.name || v.displayName || finalName,
                email: v.email || emailLower,
                fetchedFromDatabase: true,
                dbRulesWarning: false
              };
              if (currentVerifiedPlayer) {
                currentVerifiedPlayer.name = currentDbProfile.name;
                currentVerifiedPlayer.displayName = currentDbProfile.name;
                currentVerifiedPlayer.email = currentDbProfile.email;
              }
              emitAuthState();
            }
          });
        } catch (_) {}

        return currentDbProfile;
      } catch (err) {
        lastDbErr = err;
        await sleepMs(450 * (attempt + 1));
      }
    }

    currentDbProfile = {
      uid: user.uid,
      name: fallbackName,
      displayName: fallbackName,
      email: emailLower,
      emailVerified: true,
      fetchedFromDatabase: false,
      dbRulesWarning: Boolean(lastDbErr)
    };
    return currentDbProfile;
  }

  async function bindPlayerPurchasesListener(user) {
    if (unsubPurchasesRef) {
      unsubPurchasesRef();
      unsubPurchasesRef = null;
    }
    currentPlayerPurchases = {};
    if (!user || !user.emailVerified || !isRealtimeDbConfigured()) {
      emitAuthState();
      return;
    }

    let freshToken = "";
    try {
      freshToken = await user.getIdToken();
      const restPurchases = await rtdbRestJson("GET", `users/${user.uid}/purchases`, undefined, freshToken);
      if (restPurchases && typeof restPurchases === "object") {
        currentPlayerPurchases = restPurchases;
      }
    } catch (_) {}

    const localMap = getSavedUnlocks();
    for (const gid of Object.keys(localMap)) {
      if (hasLoadedLiveGamesSnapshot && !latestPublicGamesCache.some((x) => x.id === gid)) {
        continue;
      }
      const rec = localMap[gid];
      if (rec.uid && rec.uid !== user.uid) continue;
      if (!currentPlayerPurchases[gid]) {
        const gObj = latestPublicGamesCache.find((x) => x.id === gid) || {};
        const pEntry = {
          gameId: gid,
          gameTitle: gObj.title || rec.gameTitle || "Studio Game",
          coverImageUrl: gObj.coverImageUrl || "",
          unlockMethod: rec.method || "razorpay",
          paymentId: rec.paymentId || "",
          amount: Number(gObj.price || 0),
          currency: gObj.currency || "USD",
          purchasedAt: rec.unlockedAt || Date.now(),
          purchasedVersion: gObj.version || "v1.0.0",
          lastDownloadedVersion: gObj.version || "v1.0.0",
          lastDownloadedBuildUpdatedAt: Number(gObj.buildUpdatedAt || gObj.updatedAt || Date.now()),
          downloadRef: rec.rawDownloadRef || ""
        };
        currentPlayerPurchases[gid] = pEntry;
        if (freshToken) {
          await rtdbRestJson("PUT", `users/${user.uid}/purchases/${gid}`, pEntry, freshToken).catch(() => {});
        }
      }
    }
    if (hasLoadedLiveGamesSnapshot) {
      await reconcilePurchasesWithLiveGames();
    } else {
      emitAuthState();
    }

    try {
      const { rtdb, dbMod } = await getPublicRealtimeDb();
      const listRef = dbMod.ref(rtdb, `users/${user.uid}/purchases`);
      unsubPurchasesRef = dbMod.onValue(
        listRef,
        (snap) => {
          currentPlayerPurchases = snap.exists() ? snap.val() || {} : {};
          if (hasLoadedLiveGamesSnapshot) {
            reconcilePurchasesWithLiveGames();
          }
          emitAuthState();
        },
        () => emitAuthState()
      );
    } catch (_) {}
  }

  async function activateVerifiedPlayerSession(user, explicitName) {
    if (!user || !user.emailVerified || activatingVerifiedSession) return;
    activatingVerifiedSession = true;
    try {
      stopAutoVerificationWatcher();
      pendingVerificationEmail = "";
      const dbProf = await writeAndFetchPlayerProfileFromDatabase(user, explicitName);
      currentVerifiedPlayer = {
        uid: user.uid,
        name: dbProf.name,
        displayName: dbProf.name,
        email: dbProf.email,
        emailVerified: true
      };
      await bindPlayerPurchasesListener(user);
      emitAuthState();
    } finally {
      activatingVerifiedSession = false;
    }
  }

  async function startPlayerAuthWatcher() {
    if (authWatcherStarted) return;
    authWatcherStarted = true;
    if (!isFirebaseConfigured()) {
      emitAuthState();
      return;
    }
    try {
      const { auth, authMod } = await getFirebasePublicServices();
      authMod.onAuthStateChanged(auth, async (user) => {
        if (!user) {
          stopAutoVerificationWatcher();
          currentVerifiedPlayer = null;
          currentDbProfile = null;
          currentPlayerPurchases = {};
          if (unsubProfileRef) {
            unsubProfileRef();
            unsubProfileRef = null;
          }
          if (unsubPurchasesRef) {
            unsubPurchasesRef();
            unsubPurchasesRef = null;
          }
          emitAuthState();
          return;
        }

        await authMod.reload(user).catch(() => {});

        // ONLY verified email accounts enter the authenticated state & write to /users/{uid}!
        if (!user.emailVerified) {
          currentVerifiedPlayer = null;
          currentDbProfile = null;
          currentPlayerPurchases = {};
          pendingVerificationEmail = user.email || pendingVerificationEmail;
          startLiveAutoVerificationWatcher();
          emitAuthState();
          return;
        }

        await activateVerifiedPlayerSession(user);
      });
    } catch (_) {
      emitAuthState();
    }
  }

  function subscribePlayerAuth(cb) {
    authSubscribers.add(cb);
    startPlayerAuthWatcher();
    cb({
      user: currentVerifiedPlayer,
      dbProfile: currentDbProfile ? { ...currentDbProfile } : null,
      pendingVerificationEmail,
      cooldownSec: pendingVerificationEmail ? getVerifyCooldownRemainingSec(pendingVerificationEmail) : 0,
      purchases: { ...currentPlayerPurchases }
    });
    return () => authSubscribers.delete(cb);
  }

  // 1. SIGN UP: Requires explicit Terms & Conditions acceptance first, saves the Terms acceptance
  //    entry to Firebase Realtime Database, and THEN sends the verification email!
  async function registerPlayerAccount({ displayName, email, password, termsAccepted, termsAcceptedAt, termsVersion }) {
    if (!isFirebaseConfigured()) {
      throw new Error("Firebase is not configured in js/store-config.js yet.");
    }
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(displayName || "").trim();
    if (!cleanName) throw new Error("Please enter your Name.");
    if (!cleanEmail) throw new Error("Please enter a valid email address.");
    if (!password || password.length < 6) {
      throw new Error("Password must be at least 6 characters long.");
    }
    if (!termsAccepted) {
      throw new Error("Please read and accept the Terms & Conditions before creating your account.");
    }

    const acceptedTs = Number(termsAcceptedAt || Date.now());
    const verTag = String(termsVersion || TERMS_VERSION);
    const termsPayload = {
      accepted: true,
      termsVersion: verTag,
      acceptedAt: acceptedTs,
      acceptedDate: new Date(acceptedTs).toISOString(),
      noRefundPolicyAccepted: true,
      horrorAndGameRiskAccepted: true
    };

    savePendingSignupName(cleanEmail, cleanName);
    savePendingTermsAcceptance(cleanEmail, termsPayload);
    const { auth, authMod, rtdb, dbMod } = await getFirebasePublicServices();

    let targetUser = null;
    try {
      const cred = await authMod.createUserWithEmailAndPassword(auth, cleanEmail, password);
      targetUser = cred.user;
    } catch (err) {
      const code = String(err.code || err.message || "");
      if (code.includes("auth/email-already-in-use")) {
        // Smart recovery: if this user already started signup earlier and wasn't verified yet,
        // sign them in with the password they entered so they don't get stuck!
        try {
          const signCred = await authMod.signInWithEmailAndPassword(auth, cleanEmail, password);
          await authMod.reload(signCred.user).catch(() => {});
          targetUser = signCred.user;
        } catch (_) {
          throw new Error(
            "This email is already registered! Switch to the 'Sign In' tab and enter your password (or click 'Forgot Password?')."
          );
        }
      } else if (code.includes("auth/invalid-email")) {
        throw new Error("Please enter a valid email address.");
      } else if (code.includes("auth/operation-not-allowed")) {
        throw new Error(
          "Enable Email/Password in Firebase Console -> Authentication -> Sign-in method -> Email/Password -> Enable!"
        );
      } else if (code.includes("auth/too-many-requests")) {
        throw new Error(
          "Firebase temporarily rate-limited requests from this browser. Wait 60 seconds and check your email Inbox & Spam folder."
        );
      } else {
        throw err;
      }
    }

    if (cleanName && targetUser.displayName !== cleanName) {
      await authMod.updateProfile(targetUser, { displayName: cleanName }).catch(() => {});
    }

    // STEP A: Save Terms & Conditions Acceptance Entry to Firebase Database BEFORE sending verification email!
    if (isRealtimeDbConfigured() && targetUser) {
      const dbTermsEntry = {
        uid: targetUser.uid,
        name: cleanName,
        email: cleanEmail,
        termsAccepted: true,
        termsVersion: verTag,
        termsAcceptedAt: acceptedTs,
        termsAcceptedDate: new Date(acceptedTs).toISOString(),
        noRefundPolicyAccepted: true,
        horrorAndGameRiskAccepted: true
      };
      try {
        const userTok = await targetUser.getIdToken();
        await Promise.all([
          rtdbRestJson("PUT", `terms_acceptances/${targetUser.uid}`, dbTermsEntry, userTok).catch(() => {}),
          rtdbRestJson("PUT", `users/${targetUser.uid}/terms_consent`, dbTermsEntry, userTok).catch(() => {})
        ]);
      } catch (_) {
        if (rtdb && dbMod) {
          await dbMod.set(dbMod.ref(rtdb, `terms_acceptances/${targetUser.uid}`), dbTermsEntry).catch(() => {});
          await dbMod.set(dbMod.ref(rtdb, `users/${targetUser.uid}/terms_consent`), dbTermsEntry).catch(() => {});
        }
      }
    }

    // If already verified, write/fetch DB profile and enter account immediately!
    if (targetUser.emailVerified) {
      await activateVerifiedPlayerSession(targetUser, cleanName);
      return {
        alreadyVerified: true,
        verificationSent: false,
        email: cleanEmail,
        user: currentVerifiedPlayer,
        dbProfile: currentDbProfile
      };
    }

    // STEP B: Now send the Email Verification link!
    const sendRes = await safeSendVerificationEmail(authMod, targetUser, false);
    pendingVerificationEmail = cleanEmail;
    currentVerifiedPlayer = null;
    currentDbProfile = null;
    startLiveAutoVerificationWatcher();
    emitAuthState();

    return {
      verificationSent: true,
      sent: Boolean(sendRes.sent),
      waitSec: sendRes.waitSec || 90,
      email: cleanEmail
    };
  }

  // 2. SIGN IN: Enters account if verified; otherwise activates live auto-verification watcher
  //    WITHOUT spamming sendEmailVerification if one was already sent recently!
  async function loginPlayerAccount({ email, password }) {
    if (!isFirebaseConfigured()) {
      throw new Error("Firebase is not configured in js/store-config.js yet.");
    }
    const cleanEmail = String(email || "").trim().toLowerCase();
    const { auth, authMod } = await getFirebasePublicServices();

    let cred;
    try {
      cred = await authMod.signInWithEmailAndPassword(auth, cleanEmail, password);
    } catch (err) {
      const code = String(err.code || err.message || "");
      if (
        code.includes("auth/invalid-credential") ||
        code.includes("auth/user-not-found") ||
        code.includes("auth/wrong-password")
      ) {
        throw new Error("Incorrect email or password (or create a new account under Sign Up).");
      }
      if (code.includes("auth/too-many-requests")) {
        throw new Error("Too many login attempts. Please wait 60 seconds and try again.");
      }
      throw err;
    }

    await authMod.reload(cred.user).catch(() => {});

    if (!cred.user.emailVerified) {
      await safeSendVerificationEmail(authMod, cred.user, false).catch(() => {});
      pendingVerificationEmail = cleanEmail;
      currentVerifiedPlayer = null;
      currentDbProfile = null;
      startLiveAutoVerificationWatcher();
      emitAuthState();
      return {
        verified: false,
        needsEmailVerification: true,
        email: cleanEmail
      };
    }

    await activateVerifiedPlayerSession(cred.user);
    return {
      verified: true,
      user: currentVerifiedPlayer,
      dbProfile: currentDbProfile
    };
  }

  async function resendPlayerVerificationLink() {
    if (!isFirebaseConfigured()) throw new Error("Firebase not configured.");
    const { auth, authMod } = await getFirebasePublicServices();
    if (!auth.currentUser) {
      throw new Error("Please sign in with your email and password first to resend the verification email.");
    }
    await authMod.reload(auth.currentUser).catch(() => {});
    if (auth.currentUser.emailVerified) {
      await activateVerifiedPlayerSession(auth.currentUser);
      return { verified: true };
    }
    const res = await safeSendVerificationEmail(authMod, auth.currentUser, true);
    emitAuthState();
    return { resent: true, email: auth.currentUser.email, waitSec: res.waitSec || 90 };
  }

  async function updatePlayerProfileName(newName) {
    const cleanName = String(newName || "").trim();
    if (!cleanName) throw new Error("Please enter a valid name.");
    const { auth, authMod } = await getFirebasePublicServices();
    if (!auth.currentUser || !auth.currentUser.emailVerified) {
      throw new Error("You must be signed in to a verified account.");
    }
    await authMod.updateProfile(auth.currentUser, { displayName: cleanName }).catch(() => {});
    await writeAndFetchPlayerProfileFromDatabase(auth.currentUser, cleanName);
    if (currentVerifiedPlayer) {
      currentVerifiedPlayer.name = cleanName;
      currentVerifiedPlayer.displayName = cleanName;
    }
    emitAuthState();
    return currentDbProfile;
  }

  async function sendPlayerPasswordReset(email) {
    if (!isFirebaseConfigured()) throw new Error("Firebase not configured.");
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail) throw new Error("Enter your registered email address first.");
    const { auth, authMod } = await getFirebasePublicServices();
    await authMod.sendPasswordResetEmail(auth, cleanEmail);
    return { sent: true };
  }

  async function logoutPlayerAccount() {
    stopAutoVerificationWatcher();
    if (isFirebaseConfigured()) {
      const { auth, authMod } = await getFirebasePublicServices();
      await authMod.signOut(auth).catch(() => {});
    }
    try {
      localStorage.removeItem(UNLOCK_RECEIPTS_KEY);
    } catch (_) {}
    currentVerifiedPlayer = null;
    currentDbProfile = null;
    pendingVerificationEmail = "";
    currentPlayerPurchases = {};
    emitAuthState();
  }

  async function deletePlayerAccount({ confirmationText, password } = {}) {
    if (String(confirmationText || "").trim().toUpperCase() !== "DELETE") {
      throw new Error('Please type "DELETE" in the confirmation box to delete your account.');
    }
    if (!isFirebaseConfigured()) {
      try {
        localStorage.removeItem(UNLOCK_RECEIPTS_KEY);
      } catch (_) {}
      currentVerifiedPlayer = null;
      currentDbProfile = null;
      pendingVerificationEmail = "";
      currentPlayerPurchases = {};
      emitAuthState();
      return { deleted: true };
    }

    const { auth, authMod, rtdb, dbMod } = await getFirebasePublicServices();
    const user = auth.currentUser;
    if (!user) {
      throw new Error("You must be signed in to delete your account.");
    }

    const uid = user.uid;
    const emailLower = String(user.email || "").trim().toLowerCase();

    // Verify recent authentication BEFORE deleting database data so deletion is atomic!
    if (password && String(password).length > 0) {
      try {
        const cred = authMod.EmailAuthProvider.credential(user.email, String(password));
        await authMod.reauthenticateWithCredential(user, cred);
      } catch (reauthErr) {
        const rc = String(reauthErr.code || reauthErr.message || "");
        if (rc.includes("wrong-password") || rc.includes("invalid-credential")) {
          throw new Error("Incorrect password. Please enter your account password to confirm deletion.");
        }
        throw new Error(reauthErr.message || "Could not verify password.");
      }
    } else {
      const lastSignInMs =
        user.metadata && user.metadata.lastSignInTime ? Date.parse(user.metadata.lastSignInTime) : 0;
      if (lastSignInMs && Date.now() - lastSignInMs > 4 * 60 * 1000) {
        const reqErr = new Error("For security, please enter your password below to confirm account deletion.");
        reqErr.code = "REQUIRES_PASSWORD";
        throw reqErr;
      }
    }

    stopAutoVerificationWatcher();
    if (unsubProfileRef) {
      unsubProfileRef();
      unsubProfileRef = null;
    }
    if (unsubPurchasesRef) {
      unsubPurchasesRef();
      unsubPurchasesRef = null;
    }

    // 1. Delete /users/{uid} (profile + purchases + all user records) from Firebase Realtime Database
    if (isRealtimeDbConfigured()) {
      let freshToken = "";
      try {
        freshToken = await user.getIdToken(true);
      } catch (_) {}
      if (freshToken) {
        await Promise.all([
          rtdbRestJson("DELETE", `users/${uid}`, undefined, freshToken).catch(() => {}),
          rtdbRestJson("DELETE", `terms_acceptances/${uid}`, undefined, freshToken).catch(() => {})
        ]);
      }
      if (rtdb && dbMod) {
        await dbMod.remove(dbMod.ref(rtdb, `users/${uid}`)).catch(() => {});
        await dbMod.remove(dbMod.ref(rtdb, `terms_acceptances/${uid}`)).catch(() => {});
      }
    }

    // 2. Delete user credential permanently from Firebase Authentication
    try {
      await authMod.deleteUser(user);
    } catch (delErr) {
      const dc = String(delErr.code || delErr.message || "");
      if (dc.includes("requires-recent-login")) {
        const reqErr = new Error("For security, please enter your password below to confirm account deletion.");
        reqErr.code = "REQUIRES_PASSWORD";
        throw reqErr;
      }
      throw new Error(delErr.message || "Could not delete Firebase Authentication account.");
    }

    // 3. Purge all local cached state & receipts
    try {
      localStorage.removeItem(UNLOCK_RECEIPTS_KEY);
      if (emailLower) {
        localStorage.removeItem(PENDING_NAME_PREFIX + emailLower);
        localStorage.removeItem(PENDING_TERMS_PREFIX + emailLower);
        localStorage.removeItem(VERIFY_COOLDOWN_PREFIX + emailLower);
      }
    } catch (_) {}

    currentVerifiedPlayer = null;
    currentDbProfile = null;
    pendingVerificationEmail = "";
    currentPlayerPurchases = {};
    emitAuthState();
    return { deleted: true };
  }

  async function savePurchaseToVerifiedAccount(gameId, receiptData) {
    if (!currentVerifiedPlayer || !isRealtimeDbConfigured()) return;
    const { auth } = await getFirebasePublicServices();
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;

    const gObj = latestPublicGamesCache.find((g) => g.id === gameId) || {};
    const nowTs = Date.now();
    const pData = {
      gameId,
      gameTitle: gObj.title || receiptData.gameTitle || "Drevalith Game",
      coverImageUrl: gObj.coverImageUrl || "",
      unlockMethod: receiptData.method || "razorpay",
      paymentId: receiptData.paymentId || "",
      amount: Number(gObj.price || 0),
      currency: gObj.currency || "USD",
      purchasedAt: nowTs,
      purchasedVersion: gObj.version || "v1.0.0",
      lastDownloadedVersion: gObj.version || "v1.0.0",
      lastDownloadedBuildUpdatedAt: Number(gObj.buildUpdatedAt || gObj.updatedAt || nowTs),
      downloadRef: receiptData.rawDownloadRef || ""
    };

    currentPlayerPurchases = { ...currentPlayerPurchases, [gameId]: pData };
    emitAuthState();

    try {
      const freshToken = await auth.currentUser.getIdToken();
      await rtdbRestJson("PUT", `users/${auth.currentUser.uid}/purchases/${gameId}`, pData, freshToken);
    } catch (_) {
      try {
        const { rtdb, dbMod } = await getPublicRealtimeDb();
        await dbMod.set(dbMod.ref(rtdb, `users/${auth.currentUser.uid}/purchases/${gameId}`), pData);
      } catch (__) {}
    }
  }

  // --------------------------------------------------------------------------
  // Update Detection & Reliable Chunked Capability Vault Downloader
  // --------------------------------------------------------------------------
  function hasGameUpdateAvailable(game, purchaseRecord) {
    if (!game || !purchaseRecord) return false;
    const liveVer = String(game.version || "v1.0.0").trim();
    const lastDlVer = String(
      purchaseRecord.lastDownloadedVersion || purchaseRecord.purchasedVersion || "v1.0.0"
    ).trim();
    if (liveVer !== lastDlVer) return true;
    const liveBuildTs = Number(game.buildUpdatedAt || 0);
    const lastDlTs = Number(purchaseRecord.lastDownloadedBuildUpdatedAt || purchaseRecord.purchasedAt || 0);
    return Boolean(liveBuildTs && lastDlTs && liveBuildTs > lastDlTs + 5000);
  }

  async function resolveLatestRawDownloadRefForBuyer(game) {
    if (game.isFree && game.freeDirectUrl) {
      return game.freeDirectUrl;
    }

    if (isRealtimeDbConfigured()) {
      try {
        const { rtdb, dbMod } = await getPublicRealtimeDb();
        const gateHash = await sha256Hex(`drevalith-buyer-gate-v4:${game.id}`);
        const gateSnap = await dbMod.get(dbMod.ref(rtdb, `buyer_gate/${gateHash}`));
        if (gateSnap.exists()) {
          const gVal = gateSnap.val();
          if (gVal && gVal.nonce && gVal.cipherB64) {
            const dec = await decryptAesGcmEnvelope(
              `drevalith-paid-unlock-v4:${game.id}:${gVal.nonce}`,
              gVal.saltB64,
              gVal.ivB64,
              gVal.cipherB64
            );
            if (dec) return dec;
          }
        }
      } catch (_) {}
    }

    const pRec = currentPlayerPurchases && currentPlayerPurchases[game.id];
    if (pRec && pRec.downloadRef) return pRec.downloadRef;
    const localRec = getSavedUnlocks()[game.id];
    if (localRec && (localRec.rawDownloadRef || localRec.downloadUrl)) {
      return localRec.rawDownloadRef || localRec.downloadUrl;
    }
    throw new Error("Download archive link is not configured yet for this game.");
  }

  function triggerBrowserSaveBlob(blob, fileName) {
    const objUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objUrl;
    a.download = fileName || "Drevalith_Game_Build.zip";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(objUrl);
    }, 30000);
  }

  function triggerExternalDirectUrl(rawUrl) {
    const finalUrl = normalizeExternalDownloadUrl(rawUrl);
    const a = document.createElement("a");
    a.href = finalUrl;
    a.rel = "noopener noreferrer";
    const isCrossOrigin =
      finalUrl.startsWith("http") &&
      typeof location !== "undefined" &&
      !finalUrl.startsWith(location.origin);
    if (isCrossOrigin) a.target = "_blank";
    else a.download = "";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => document.body.removeChild(a), 1500);
  }

  async function downloadChunkedRtdbPath(rtdb, dbMod, baseNodePath, fallbackName, onProgress) {
    if (typeof onProgress === "function") onProgress(2);
    let meta = await rtdbRestJson("GET", `${baseNodePath}/meta`).catch(() => null);
    if (!meta && rtdb && dbMod) {
      const metaSnap = await dbMod.get(dbMod.ref(rtdb, `${baseNodePath}/meta`));
      if (metaSnap.exists()) meta = metaSnap.val();
    }
    if (!meta) {
      throw new Error("Game .ZIP archive was not found in Firebase Realtime Database.");
    }
    const totalChunks = Number(meta.totalChunks || 0);
    if (totalChunks <= 0) throw new Error("Invalid archive metadata.");

    const byteParts = new Array(totalChunks);
    for (let idx = 0; idx < totalChunks; idx++) {
      let chunkB64 = null;
      for (let retry = 0; retry < 3; retry++) {
        try {
          chunkB64 = await rtdbRestJson("GET", `${baseNodePath}/chunks/${idx}`);
          if (typeof chunkB64 === "string" && chunkB64.length > 0) break;
        } catch (_) {}
        if (rtdb && dbMod) {
          try {
            const cSnap = await dbMod.get(dbMod.ref(rtdb, `${baseNodePath}/chunks/${idx}`));
            if (cSnap && cSnap.exists()) {
              chunkB64 = cSnap.val();
              break;
            }
          } catch (_) {}
        }
        await sleepMs(350 * (retry + 1));
      }
      if (!chunkB64) {
        throw new Error(`Archive chunk #${idx + 1}/${totalChunks} missing — please click Download again.`);
      }
      byteParts[idx] = b64ToBytes(chunkB64);
      if (typeof onProgress === "function") {
        onProgress(Math.min(99, Math.round(((idx + 1) / totalChunks) * 100)));
      }
    }
    if (typeof onProgress === "function") onProgress(100);
    const zipBlob = new Blob(byteParts, { type: "application/zip" });
    triggerBrowserSaveBlob(zipBlob, meta.fileName || fallbackName);
  }

  async function triggerVerifiedDownload(gameId, onProgress) {
    const game =
      latestPublicGamesCache.find((g) => g.id === gameId) ||
      (currentPlayerPurchases[gameId]
        ? { id: gameId, title: currentPlayerPurchases[gameId].gameTitle || "Game" }
        : null);
    if (!game) throw new Error("Game metadata is still loading — please click again in a moment.");
    if (game.isComingSoon || game.releaseStatus === "coming_soon") {
      throw new Error("This game is Coming Soon and not yet available for download.");
    }

    const isUnlocked = Boolean(game.isFree || getUnlockForGame(gameId));
    if (!isUnlocked) {
      throw new Error("Please purchase this game or redeem a valid Studio Private Key first.");
    }

    const rawRef = await resolveLatestRawDownloadRefForBuyer(game);
    const safeFileName =
      game.zipFileName ||
      `${String(game.title || "Drevalith_Game").replace(/[^a-zA-Z0-9._-]/g, "_")}_${String(
        game.version || "v1"
      ).replace(/[^a-zA-Z0-9._-]/g, "")}.zip`;

    if (String(rawRef).startsWith("rtdb_gate_blob:")) {
      const blobToken = String(rawRef).slice("rtdb_gate_blob:".length).trim();
      const { rtdb, dbMod } = await getPublicRealtimeDb();
      await downloadChunkedRtdbPath(rtdb, dbMod, `buyer_gate/${blobToken}`, safeFileName, onProgress);
    } else if (String(rawRef).startsWith("rtdb_blob:")) {
      const blobToken = String(rawRef).slice("rtdb_blob:".length).trim();
      const { rtdb, dbMod } = await getPublicRealtimeDb();
      await downloadChunkedRtdbPath(rtdb, dbMod, `zip_blobs/${blobToken}`, safeFileName, onProgress);
    } else if (String(rawRef).startsWith("rtdb_chunks:")) {
      const chunkPath = String(rawRef).slice("rtdb_chunks:".length);
      const { rtdb, dbMod } = await getPublicRealtimeDb();
      const snap = await dbMod.get(dbMod.ref(rtdb, chunkPath));
      if (!snap.exists()) throw new Error("Archive chunks not found.");
      const rawChunks = snap.val();
      const parts = (Array.isArray(rawChunks) ? rawChunks : Object.values(rawChunks)).map((b) =>
        b64ToBytes(b)
      );
      if (typeof onProgress === "function") onProgress(100);
      triggerBrowserSaveBlob(new Blob(parts, { type: "application/zip" }), safeFileName);
    } else {
      if (typeof onProgress === "function") onProgress(100);
      triggerExternalDirectUrl(rawRef);
    }

    if (currentVerifiedPlayer && currentPlayerPurchases[gameId] && isRealtimeDbConfigured()) {
      const dlPatch = {
        lastDownloadedVersion: game.version || "v1.0.0",
        lastDownloadedBuildUpdatedAt: Number(game.buildUpdatedAt || game.updatedAt || Date.now()),
        lastDownloadedAt: Date.now()
      };
      currentPlayerPurchases = {
        ...currentPlayerPurchases,
        [gameId]: { ...currentPlayerPurchases[gameId], ...dlPatch }
      };
      emitAuthState();
      try {
        const { auth } = await getFirebasePublicServices();
        if (auth.currentUser) {
          const freshToken = await auth.currentUser.getIdToken();
          await rtdbRestJson(
            "PATCH",
            `users/${auth.currentUser.uid}/purchases/${gameId}`,
            dlPatch,
            freshToken
          );
        }
      } catch (_) {}
    }

    return { ok: true, fileName: safeFileName };
  }

  // --------------------------------------------------------------------------
  // Razorpay SDK & Public Store Subscription
  // --------------------------------------------------------------------------
  let rzpScriptPromise = null;
  function loadRazorpayCheckoutScript() {
    if (window.Razorpay) return Promise.resolve(window.Razorpay);
    if (rzpScriptPromise) return rzpScriptPromise;
    rzpScriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://checkout.razorpay.com/v1/checkout.js";
      s.async = true;
      s.onload = () => resolve(window.Razorpay);
      s.onerror = () => {
        rzpScriptPromise = null;
        reject(new Error("Could not load Razorpay Checkout SDK. Check your internet connection."));
      };
      document.head.appendChild(s);
    });
    return rzpScriptPromise;
  }

  function subscribePublicStore(onChange) {
    if (isRealtimeDbConfigured()) {
      let unsubGames = null;
      let unsubSettings = null;
      let restPollTimer = null;
      let latestGames = [];
      let latestSettings = { showDefaultComingSoon: false };

      const parseGamesMap = (val) => {
        const obj = val && typeof val === "object" ? val : {};
        return Object.keys(obj)
          .filter((id) => obj[id] && typeof obj[id] === "object")
          .map((id) => ({
            id,
            ...obj[id],
            coverImageUrl: normalizePublicCoverUrl(obj[id].coverImageUrl)
          }))
          .filter((g) => g.published !== false)
          .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      };

      let lastEmittedSig = "";
      const emit = () => {
        latestPublicGamesCache = latestGames;
        latestPublicSettingsCache = latestSettings || {};
        if (hasLoadedLiveGamesSnapshot) {
          reconcilePurchasesWithLiveGames();
        }
        let nextSig = "";
        try {
          nextSig = JSON.stringify({ l: hasLoadedLiveGamesSnapshot, g: latestGames, s: latestSettings });
        } catch (_) {}
        if (nextSig && nextSig === lastEmittedSig) return;
        lastEmittedSig = nextSig;
        onChange({
          mode: "firebase_rtdb",
          loaded: hasLoadedLiveGamesSnapshot,
          settings: latestSettings,
          games: latestGames
        });
      };

      // Instant HTTPS REST fetch (<150ms) so games & Razorpay settings load immediately!
      const fetchViaRest = async () => {
        try {
          const [gMap, sMap] = await Promise.all([
            rtdbRestJson("GET", "games"),
            rtdbRestJson("GET", "settings/public_store").catch(() => null)
          ]);
          latestGames = parseGamesMap(gMap);
          if (sMap && typeof sMap === "object") {
            latestSettings = sMap;
          }
          hasLoadedLiveGamesSnapshot = true;
          emit();
        } catch (_) {}
      };
      fetchViaRest();
      restPollTimer = setInterval(fetchViaRest, 15000);

      getPublicRealtimeDb()
        .then(({ rtdb, dbMod }) => {
          unsubGames = dbMod.onValue(dbMod.ref(rtdb, "games"), (snap) => {
            latestGames = parseGamesMap(snap.val());
            hasLoadedLiveGamesSnapshot = true;
            emit();
          });
          unsubSettings = dbMod.onValue(dbMod.ref(rtdb, "settings/public_store"), (snap) => {
            if (snap.exists()) latestSettings = snap.val();
            emit();
          });
        })
        .catch(() => {});

      return () => {
        if (restPollTimer) clearInterval(restPollTimer);
        if (unsubGames) unsubGames();
        if (unsubSettings) unsubSettings();
      };
    }

    if (isStaticGithubHostWithoutBackend()) {
      onChange({ mode: "unconfigured", loaded: false, settings: { showDefaultComingSoon: true }, games: [] });
      return () => {};
    }

    let es = null;
    let active = true;

    async function fetchInitial() {
      try {
        const res = await fetch(`${API_BASE}/api/public/state`, { cache: "no-store" });
        if (!res.ok) return;
        const state = await res.json();
        if (active) {
          latestPublicGamesCache = state.games || [];
          latestPublicSettingsCache = state.settings || {};
          hasLoadedLiveGamesSnapshot = true;
          reconcilePurchasesWithLiveGames();
          onChange({
            mode: "server_realtime",
            loaded: true,
            settings: state.settings || { showDefaultComingSoon: true },
            games: state.games || [],
            razorpayConfigured: Boolean(state.razorpayConfigured)
          });
        }
      } catch (_) {}
    }

    fetchInitial();

    if (typeof EventSource !== "undefined") {
      try {
        es = new EventSource(`${API_BASE}/api/realtime/stream`);
        es.onmessage = (ev) => {
          try {
            const msg = JSON.parse(ev.data);
            if (msg && msg.type === "store_sync" && msg.state && active) {
              latestPublicGamesCache = msg.state.games || [];
              latestPublicSettingsCache = msg.state.settings || {};
              hasLoadedLiveGamesSnapshot = true;
              reconcilePurchasesWithLiveGames();
              onChange({
                mode: "server_realtime",
                loaded: true,
                settings: msg.state.settings || { showDefaultComingSoon: true },
                games: msg.state.games || [],
                razorpayConfigured: Boolean(msg.state.razorpayConfigured)
              });
            }
          } catch (_) {}
        };
      } catch (_) {}
    }

    const onBusMsg = (e) => {
      if (e.data && e.data.type === "refresh_store") fetchInitial();
    };
    if (broadcastBus) broadcastBus.addEventListener("message", onBusMsg);

    return () => {
      active = false;
      if (es) es.close();
      if (broadcastBus) broadcastBus.removeEventListener("message", onBusMsg);
    };
  }

  function notifyOtherTabs() {
    if (broadcastBus) {
      try {
        broadcastBus.postMessage({ type: "refresh_store", ts: Date.now() });
      } catch (_) {}
    }
  }

  async function tryBackendJson(path, bodyObj) {
    if (isStaticGithubHostWithoutBackend()) return null;
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bodyObj)
      });
      if (res.status === 404 && !API_BASE) return null;
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request rejected.");
      return data;
    } catch (err) {
      if (!API_BASE && (err.name === "TypeError" || String(err.message).includes("Failed to fetch"))) {
        return null;
      }
      throw err;
    }
  }

  async function createPaymentOrder(game) {
    if (game && (game.isComingSoon || game.releaseStatus === "coming_soon")) {
      throw new Error("This game is Coming Soon and cannot be purchased yet.");
    }
    const fc = CFG.FIREBASE_CONFIG || {};
    const backendOrder = await tryBackendJson("/api/razorpay/create-order", {
      gameId: game.id,
      firebaseDatabaseUrl: isRealtimeDbConfigured() ? fc.databaseURL : "",
      firebaseProjectId: isFirebaseConfigured() ? fc.projectId : ""
    });
    if (backendOrder) return backendOrder;

    const amountSubunits = Math.round(Number(game.price || 0) * 100);
    const currency = String(game.currency || "USD").toUpperCase() === "INR" ? "INR" : "USD";
    const activeRzpKey = getActiveRazorpayKeyId();
    if (activeRzpKey) {
      return {
        mode: "live_razorpay_serverless",
        keyId: activeRzpKey,
        orderId: "",
        amount: amountSubunits,
        currency,
        displayPrice: Number(game.price),
        gameTitle: game.title
      };
    }
    return {
      mode: "sandbox_preview",
      orderId: `order_local_${Date.now()}`,
      amount: amountSubunits,
      currency,
      displayPrice: Number(game.price),
      gameTitle: game.title
    };
  }

  async function verifyRazorpayPayment(payload) {
    const backendVer = await tryBackendJson("/api/razorpay/verify-payment", payload);
    if (backendVer && backendVer.verified) {
      const downloadUrl =
        backendVer.downloadUrl && backendVer.downloadUrl.startsWith("/")
          ? `${API_BASE}${backendVer.downloadUrl}`
          : backendVer.downloadUrl;
      const receipt = {
        gameId: payload.gameId,
        gameTitle: payload.gameTitle || "Game",
        method: payload.mode === "sandbox_preview" ? "razorpay_sandbox" : "razorpay_live",
        paymentId: backendVer.paymentId,
        rawDownloadRef: downloadUrl,
        expiresInMinutes: backendVer.expiresInMinutes || 60
      };
      saveUnlockReceipt(payload.gameId, receipt);
      await savePurchaseToVerifiedAccount(payload.gameId, receipt).catch(() => {});
      notifyOtherTabs();
      return receipt;
    }

    const pid = String(payload.razorpay_payment_id || "").trim();
    if (!pid || !pid.startsWith("pay_")) {
      throw new Error("Invalid Razorpay Payment ID.");
    }

    let decryptedTarget = "";
    if (isRealtimeDbConfigured()) {
      const { rtdb, dbMod } = await getPublicRealtimeDb();
      const gateHash = await sha256Hex(`drevalith-buyer-gate-v4:${payload.gameId}`);
      const gateSnap = await dbMod.get(dbMod.ref(rtdb, `buyer_gate/${gateHash}`));
      if (!gateSnap.exists()) {
        throw new Error("Download archive not configured yet by Studio Owner.");
      }
      const gateVal = gateSnap.val();
      decryptedTarget = await decryptAesGcmEnvelope(
        `drevalith-paid-unlock-v4:${payload.gameId}:${gateVal.nonce}`,
        gateVal.saltB64,
        gateVal.ivB64,
        gateVal.cipherB64
      );

      const buyerEmail =
        (currentVerifiedPlayer && currentVerifiedPlayer.email) || String(payload.buyerEmail || "");
      await dbMod
        .set(dbMod.ref(rtdb, `transactions/txn_${pid.replace(/[^a-zA-Z0-9_]/g, "")}`), {
          id: `txn_${Date.now()}`,
          type: "razorpay",
          mode: payload.mode || "live_razorpay",
          gameId: payload.gameId,
          gameTitle: payload.gameTitle || "Game",
          amount: Number(payload.amount || 0),
          currency: payload.currency || "USD",
          paymentId: pid,
          buyerUid: currentVerifiedPlayer ? currentVerifiedPlayer.uid : "",
          buyerEmail,
          createdAt: Date.now()
        })
        .catch(() => {});
    }

    const receipt = {
      gameId: payload.gameId,
      gameTitle: payload.gameTitle || "Game",
      method: payload.mode === "sandbox_preview" ? "razorpay_sandbox" : "razorpay_live",
      paymentId: pid,
      rawDownloadRef: decryptedTarget,
      expiresInMinutes: 10080
    };
    saveUnlockReceipt(payload.gameId, receipt);
    await savePurchaseToVerifiedAccount(payload.gameId, receipt).catch(() => {});
    return receipt;
  }

  async function redeemPrivateKey({ gameId, gameTitle, privateKey, redeemerLabel }) {
    const clean = normalizePrivateKeyClean(privateKey);
    if (!clean || clean.length < 8) {
      throw new Error("Please enter a valid Studio Private Key (e.g. DREV-XXXX-XXXX-XXXX).");
    }

    const backendRed = await tryBackendJson("/api/keys/redeem", {
      gameId,
      gameTitle,
      privateKey: clean,
      redeemerLabel
    });
    if (backendRed && backendRed.verified) {
      const downloadUrl =
        backendRed.downloadUrl && backendRed.downloadUrl.startsWith("/")
          ? `${API_BASE}${backendRed.downloadUrl}`
          : backendRed.downloadUrl;
      const receipt = {
        gameId,
        gameTitle,
        method: "private_key",
        rawDownloadRef: downloadUrl,
        expiresInMinutes: backendRed.expiresInMinutes || 60
      };
      saveUnlockReceipt(gameId, receipt);
      await savePurchaseToVerifiedAccount(gameId, receipt).catch(() => {});
      notifyOtherTabs();
      return receipt;
    }

    if (!isRealtimeDbConfigured()) {
      throw new Error("Invalid Private Key or Realtime Database not connected.");
    }

    const { rtdb, dbMod } = await getPublicRealtimeDb();
    const lookupHash = await sha256Hex(`drevalith-key-lookup-v4:${clean}`);
    const envRef = dbMod.ref(rtdb, `key_envelopes/${lookupHash}`);
    const snap = await dbMod.get(envRef);
    if (!snap.exists()) {
      throw new Error("Invalid Private Key. Please check your code and try again.");
    }

    const env = snap.val();
    if (!env.active) throw new Error("This Private Key has been revoked.");
    if (env.expiresAt && Date.now() > Number(env.expiresAt)) {
      throw new Error("This Private Key has expired.");
    }
    if (env.targetGameId !== "ALL" && env.targetGameId !== gameId) {
      throw new Error(`This Private Key is only valid for "${env.targetGameTitle || "another game"}".`);
    }
    if (Number(env.maxUses) > 0 && Number(env.usedCount || 0) >= Number(env.maxUses)) {
      throw new Error("This Private Key has already reached its usage limit.");
    }

    const txRes = await dbMod.runTransaction(envRef, (curr) => {
      if (!curr) return curr;
      if (!curr.active) return;
      if (Number(curr.maxUses) > 0 && Number(curr.usedCount || 0) >= Number(curr.maxUses)) return;
      curr.usedCount = Number(curr.usedCount || 0) + 1;
      curr.lastRedeemedAt = Date.now();
      return curr;
    });
    if (!txRes.committed) {
      throw new Error("This Private Key has reached its maximum usage limit.");
    }

    let decryptedTarget = "";
    if (env.cipherMap && env.cipherMap[gameId]) {
      const m = env.cipherMap[gameId];
      decryptedTarget = await decryptAesGcmEnvelope(clean, m.saltB64, m.ivB64, m.cipherB64);
    } else if (env.cipherB64 && env.cipherB64 !== "ALL_MAP") {
      decryptedTarget = await decryptAesGcmEnvelope(clean, env.saltB64, env.ivB64, env.cipherB64);
    } else {
      throw new Error("No game archive linked to this key yet.");
    }

    const buyerEmail =
      (currentVerifiedPlayer && currentVerifiedPlayer.email) || String(redeemerLabel || "");
    await dbMod
      .set(dbMod.ref(rtdb, `transactions/txn_key_${Date.now()}_${lookupHash.slice(0, 6)}`), {
        id: `txn_key_${Date.now()}`,
        type: "private_key",
        mode: "studio_key",
        gameId,
        gameTitle: gameTitle || "Game",
        amount: 0,
        currency: "FREE (KEY)",
        keyCodeMasked: `${clean.slice(0, 8)}-****`,
        buyerUid: currentVerifiedPlayer ? currentVerifiedPlayer.uid : "",
        buyerEmail,
        createdAt: Date.now()
      })
      .catch(() => {});

    const receipt = {
      gameId,
      gameTitle,
      method: "private_key",
      rawDownloadRef: decryptedTarget,
      expiresInMinutes: 10080
    };
    saveUnlockReceipt(gameId, receipt);
    await savePurchaseToVerifiedAccount(gameId, receipt).catch(() => {});
    return receipt;
  }

  async function restorePurchase({ gameId, paymentId, buyerEmail }) {
    const pid = String(paymentId || "").trim();
    if (!pid) throw new Error("Please enter your Razorpay Payment ID (startsWith pay_).");

    const backendRes = await tryBackendJson("/api/purchases/restore", { gameId, paymentId: pid, buyerEmail });
    if (backendRes && backendRes.verified) {
      const downloadUrl =
        backendRes.downloadUrl && String(backendRes.downloadUrl).startsWith("/")
          ? `${API_BASE}${backendRes.downloadUrl}`
          : backendRes.downloadUrl;
      const receipt = {
        gameId,
        method: "razorpay_restored",
        paymentId: pid,
        rawDownloadRef: downloadUrl,
        expiresInMinutes: backendRes.expiresInMinutes || 60
      };
      saveUnlockReceipt(gameId, receipt);
      await savePurchaseToVerifiedAccount(gameId, receipt).catch(() => {});
      return receipt;
    }

    if (isRealtimeDbConfigured()) {
      const { rtdb, dbMod } = await getPublicRealtimeDb();
      const gateHash = await sha256Hex(`drevalith-buyer-gate-v4:${gameId}`);
      const gateSnap = await dbMod.get(dbMod.ref(rtdb, `buyer_gate/${gateHash}`));
      if (gateSnap.exists() && pid.startsWith("pay_") && pid.length >= 12) {
        const g = gateSnap.val();
        const dec = await decryptAesGcmEnvelope(
          `drevalith-paid-unlock-v4:${gameId}:${g.nonce}`,
          g.saltB64,
          g.ivB64,
          g.cipherB64
        );
        const receipt = {
          gameId,
          method: "razorpay_restored",
          paymentId: pid,
          rawDownloadRef: dec,
          expiresInMinutes: 10080
        };
        saveUnlockReceipt(gameId, receipt);
        await savePurchaseToVerifiedAccount(gameId, receipt).catch(() => {});
        return receipt;
      }
    }
    throw new Error("Could not find a verified purchase with that Payment ID.");
  }

  window.DrevalithStore = {
    isFirebaseConfigured,
    isRealtimeDbConfigured,
    isRazorpayLiveKeyConfigured,
    getActiveRazorpayKeyId,
    formatPrice,
    formatCurrency: (price, currency) => formatPrice(price, currency, false),
    formatPrivateKeyInput,
    getUnlockForGame,
    hasGameUpdateAvailable,
    subscribePublicStore,
    subscribePlayerAuth,
    fetchPlayerProfileFromDb,
    registerPlayerAccount,
    loginPlayerAccount,
    resendPlayerVerificationLink,
    updatePlayerProfileName,
    sendPlayerPasswordReset,
    logoutPlayerAccount,
    deletePlayerAccount,
    loadRazorpayCheckoutScript,
    createPaymentOrder,
    verifyRazorpayPayment,
    redeemPrivateKey,
    restorePurchase,
    triggerVerifiedDownload
  };
})();
