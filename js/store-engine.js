/**
 * ============================================================================
 * DREVALITH GAMES™ — PUBLIC STOREFRONT, PLAYER AUTH & UPDATE ENGINE (v5)
 * ============================================================================
 * Features:
 *   1. Real-Time Game Catalog from Free Firebase Realtime Database (/games)
 *   2. Separate Secure Player Accounts (/users/{uid}) with Mandatory Email
 *      Verification Link BEFORE account creation in Firebase Database!
 *   3. Permanent Cloud Purchase Library (/users/{uid}/purchases/{gameId}) +
 *      Automatic Game Update Detection & Free Update Downloads for Buyers!
 *   4. Streaming Chunked .ZIP Downloads up to 500 MB (/zip_blobs/{token}) +
 *      Direct Google Drive Streaming with ZERO "No Permission" errors!
 *   5. Razorpay Checkout + AES-256-GCM Private Key Unlocking.
 * ============================================================================
 */

(function () {
  const CFG = window.DREVALITH_CONFIG || {};
  const API_BASE = (CFG.BACKEND_API_URL || "").replace(/\/+$/, "");
  const UNLOCK_STORAGE_KEY = "drevalith_verified_unlocks_v5";
  const BC_NAME = "drevalith_realtime_bus_v5";

  const broadcastBus =
    typeof BroadcastChannel !== "undefined" ? new BroadcastChannel(BC_NAME) : null;

  function isStaticGithubHostWithoutBackend() {
    if (API_BASE) return false;
    const h = (window.location.hostname || "").toLowerCase();
    return (
      h.endsWith(".github.io") ||
      h.endsWith(".netlify.app") ||
      h.endsWith(".pages.dev") ||
      h.endsWith(".web.app") ||
      h.endsWith(".firebaseapp.com")
    );
  }

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

  function isRazorpayLiveKeyConfigured() {
    const k = CFG.RAZORPAY_KEY_ID;
    return Boolean(k && !String(k).startsWith("YOUR_") && String(k).startsWith("rzp_"));
  }

  function normalizePrivateKey(code) {
    return String(code || "")
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  function formatPrivateKeyInput(val) {
    const clean = normalizePrivateKey(val).slice(0, 16);
    const groups = clean.match(/.{1,4}/g);
    return groups ? groups.join("-") : clean;
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!n || n <= 0) return "ZIP Build";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(2)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatCurrency(price, currency) {
    const num = Number(price || 0);
    if (num <= 0) return "FREE";
    const cur = String(currency || "USD").toUpperCase();
    if (cur === "INR") {
      return `₹${num % 1 === 0 ? num.toFixed(0) : num.toFixed(2)} INR`;
    }
    return `$${num.toFixed(2)} USD`;
  }

  // --------------------------------------------------------------------------
  // Web Crypto SHA-256 & AES-256-GCM Decryption
  // --------------------------------------------------------------------------
  function b64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function sha256Hex(str) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function decryptAesGcmEnvelope(passphrase, saltB64, ivB64, cipherB64) {
    const salt = b64ToBytes(saltB64);
    const iv = b64ToBytes(ivB64);
    const cipherBytes = b64ToBytes(cipherB64);
    const keyMat = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const aesKey = await crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      keyMat,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plainBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, cipherBytes);
    return new TextDecoder().decode(plainBuf);
  }

  function extractGoogleDriveId(url) {
    const u = String(url || "").trim();
    let m = u.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]{10,})/);
    if (!m) {
      m = u.match(
        /drive\.(?:google|usercontent)\.com\/(?:open|uc|download)\?.*?[?&]?id=([a-zA-Z0-9_-]{10,})/
      );
    }
    return m ? m[1] : "";
  }

  function normalizeExternalDownloadUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    const fid = extractGoogleDriveId(u);
    if (fid) {
      return `https://drive.usercontent.google.com/download?id=${fid}&export=download&confirm=t`;
    }
    if (u.includes("dropbox.com/")) {
      const cleaned = u.replace(/[?&]dl=0\b/, "");
      return cleaned + (cleaned.includes("?") ? "&dl=1" : "?dl=1");
    }
    return u;
  }

  // --------------------------------------------------------------------------
  // Local Unlock Receipt Cache (Never stores expiring blob: URLs!)
  // --------------------------------------------------------------------------
  function getSavedUnlocks() {
    try {
      const raw = localStorage.getItem(UNLOCK_STORAGE_KEY);
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
      if (changed) localStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify(parsed));
      return parsed;
    } catch (_) {
      return {};
    }
  }

  function saveUnlockReceipt(gameId, receiptData) {
    try {
      const map = getSavedUnlocks();
      const ttlMs = Number(receiptData.expiresInMinutes || 10080) * 60 * 1000; // 7 days local cache
      const copy = { ...receiptData };
      // Never persist ephemeral blob: URLs across reloads (causes Chrome "No permission" error!)
      if (copy.downloadUrl && String(copy.downloadUrl).startsWith("blob:")) {
        delete copy.downloadUrl;
      }
      map[gameId] = {
        ...copy,
        unlockedAt: Date.now(),
        expiresAt: Date.now() + ttlMs
      };
      localStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function getUnlockForGame(gameId) {
    if (currentPlayerPurchases && currentPlayerPurchases[gameId]) {
      return {
        gameId,
        method: currentPlayerPurchases[gameId].unlockMethod || "account_purchase",
        paymentId: currentPlayerPurchases[gameId].paymentId || "",
        rawDownloadRef: currentPlayerPurchases[gameId].downloadRef || "",
        fromCloudAccount: true
      };
    }
    const map = getSavedUnlocks();
    return map[gameId] || null;
  }

  // --------------------------------------------------------------------------
  // Firebase SDK Clients (Realtime DB + Player Auth)
  // --------------------------------------------------------------------------
  let fbClientPromise = null;
  async function getFirebasePublicServices() {
    if (!isFirebaseConfigured()) return null;
    if (fbClientPromise) return fbClientPromise;
    const ver = CFG.FIREBASE_SDK_VERSION || "11.0.2";
    const base = `https://www.gstatic.com/firebasejs/${ver}`;
    fbClientPromise = (async () => {
      const [appMod, authMod, dbMod] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`),
        import(`${base}/firebase-database.js`)
      ]);
      const app = appMod.getApps().length
        ? appMod.getApp()
        : appMod.initializeApp(CFG.FIREBASE_CONFIG);
      const auth = authMod.getAuth(app);
      const rtdb = isRealtimeDbConfigured() ? dbMod.getDatabase(app) : null;
      return { app, auth, rtdb, appMod, authMod, dbMod };
    })();
    return fbClientPromise;
  }

  async function getPublicRealtimeDb() {
    const svc = await getFirebasePublicServices();
    if (!svc || !svc.rtdb) return null;
    return { rtdb: svc.rtdb, dbMod: svc.dbMod };
  }

  let fsPromise = null;
  async function getPublicFirestore() {
    if (!isFirebaseConfigured()) return null;
    if (fsPromise) return fsPromise;
    const ver = CFG.FIREBASE_SDK_VERSION || "11.0.2";
    const base = `https://www.gstatic.com/firebasejs/${ver}`;
    fsPromise = (async () => {
      const svc = await getFirebasePublicServices();
      const fsMod = await import(`${base}/firebase-firestore.js`);
      return { db: fsMod.getFirestore(svc.app), fsMod };
    })();
    return fsPromise;
  }

  // --------------------------------------------------------------------------
  // PLAYER ACCOUNT AUTH + MANDATORY EMAIL LINK VERIFICATION (/users/{uid})
  // --------------------------------------------------------------------------
  let currentVerifiedPlayer = null;
  let pendingVerificationEmail = "";
  let currentPlayerPurchases = {};
  let unsubPurchasesRef = null;
  const authSubscribers = new Set();
  let authWatcherStarted = false;

  function buildPlayerSummary(user) {
    if (!user || !user.emailVerified) return null;
    return {
      uid: user.uid,
      email: (user.email || "").toLowerCase(),
      displayName: user.displayName || (user.email ? user.email.split("@")[0] : "Player"),
      emailVerified: Boolean(user.emailVerified)
    };
  }

  function emitAuthState() {
    const snapshot = {
      user: currentVerifiedPlayer,
      pendingVerificationEmail,
      purchases: { ...currentPlayerPurchases }
    };
    authSubscribers.forEach((cb) => {
      try {
        cb(snapshot);
      } catch (_) {}
    });
  }

  async function ensureVerifiedUserNodeInDatabase(user, optionalDisplayName) {
    if (!user || !user.emailVerified || !isRealtimeDbConfigured()) return;
    const { rtdb, dbMod } = await getPublicRealtimeDb();
    // Force fresh JWT so auth.token.email_verified === true in Firebase Rules!
    await user.getIdToken(true);
    const profRef = dbMod.ref(rtdb, `users/${user.uid}/profile`);
    const existingSnap = await dbMod.get(profRef).catch(() => null);
    const prev = existingSnap && existingSnap.exists() ? existingSnap.val() : {};
    const nameToSave =
      optionalDisplayName ||
      user.displayName ||
      prev.displayName ||
      (user.email ? user.email.split("@")[0] : "Player");
    await dbMod.set(profRef, {
      uid: user.uid,
      email: (user.email || "").toLowerCase(),
      displayName: nameToSave,
      emailVerified: true,
      createdAt: prev.createdAt || Date.now(),
      lastLoginAt: Date.now()
    });
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
    const { rtdb, dbMod } = await getPublicRealtimeDb();
    await user.getIdToken(true).catch(() => {});

    // Sync any local browser unlocks made earlier into user's verified cloud account
    const localMap = getSavedUnlocks();
    for (const gid of Object.keys(localMap)) {
      const rec = localMap[gid];
      const gObj = latestPublicGamesCache.find((x) => x.id === gid) || {};
      const pRef = dbMod.ref(rtdb, `users/${user.uid}/purchases/${gid}`);
      const snap = await dbMod.get(pRef).catch(() => null);
      if (snap && !snap.exists()) {
        await dbMod
          .set(pRef, {
            gameId: gid,
            gameTitle: gObj.title || rec.gameTitle || "Studio Game",
            unlockMethod: rec.method || "razorpay",
            paymentId: rec.paymentId || "",
            amount: Number(gObj.price || 0),
            currency: gObj.currency || "USD",
            purchasedAt: rec.unlockedAt || Date.now(),
            purchasedVersion: gObj.version || "v1.0.0",
            lastDownloadedVersion: gObj.version || "v1.0.0",
            lastDownloadedBuildUpdatedAt: Number(gObj.buildUpdatedAt || gObj.updatedAt || Date.now()),
            downloadRef: rec.rawDownloadRef || ""
          })
          .catch(() => {});
      }
    }

    const listRef = dbMod.ref(rtdb, `users/${user.uid}/purchases`);
    unsubPurchasesRef = dbMod.onValue(
      listRef,
      (snap) => {
        currentPlayerPurchases = snap.exists() ? snap.val() || {} : {};
        emitAuthState();
      },
      () => {
        emitAuthState();
      }
    );
  }

  async function initPlayerAuthWatcher() {
    if (authWatcherStarted || !isFirebaseConfigured()) return;
    authWatcherStarted = true;
    try {
      const { auth, authMod } = await getFirebasePublicServices();
      authMod.onAuthStateChanged(auth, async (user) => {
        if (!user) {
          currentVerifiedPlayer = null;
          if (unsubPurchasesRef) {
            unsubPurchasesRef();
            unsubPurchasesRef = null;
          }
          currentPlayerPurchases = {};
          emitAuthState();
          return;
        }
        try {
          await authMod.reload(user);
        } catch (_) {}
        if (user.emailVerified) {
          pendingVerificationEmail = "";
          currentVerifiedPlayer = buildPlayerSummary(user);
          await ensureVerifiedUserNodeInDatabase(user).catch(() => {});
          await bindPlayerPurchasesListener(user);
        } else {
          // Account NOT active until email verification link is clicked!
          currentVerifiedPlayer = null;
          pendingVerificationEmail = (user.email || "").toLowerCase();
          currentPlayerPurchases = {};
          emitAuthState();
        }
      });
    } catch (_) {}
  }

  function subscribePlayerAuth(onChange) {
    authSubscribers.add(onChange);
    onChange({
      user: currentVerifiedPlayer,
      pendingVerificationEmail,
      purchases: { ...currentPlayerPurchases }
    });
    initPlayerAuthWatcher();
    return () => authSubscribers.delete(onChange);
  }

  function getCurrentPlayer() {
    return currentVerifiedPlayer;
  }

  function getPlayerPurchases() {
    return { ...currentPlayerPurchases };
  }

  function hasGameUpdateAvailable(game, purchaseRecord) {
    if (!game || !purchaseRecord) return false;
    const latestTs = Number(game.buildUpdatedAt || 0);
    const downloadedTs = Number(
      purchaseRecord.lastDownloadedBuildUpdatedAt || purchaseRecord.purchasedAt || 0
    );
    if (latestTs > 0 && latestTs > downloadedTs + 2000) return true;
    const liveVer = String(game.version || "").trim();
    const dlVer = String(
      purchaseRecord.lastDownloadedVersion || purchaseRecord.purchasedVersion || ""
    ).trim();
    if (liveVer && dlVer && liveVer !== dlVer && latestTs >= downloadedTs) return true;
    return false;
  }

  async function registerPlayerAccount({ displayName, email, password }) {
    if (!isFirebaseConfigured()) {
      throw new Error("Firebase Authentication is not configured in js/store-config.js yet.");
    }
    const cleanEmail = String(email || "").trim().toLowerCase();
    const cleanName = String(displayName || "").trim();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      throw new Error("Please enter a valid email address.");
    }
    if (!password || String(password).length < 6) {
      throw new Error("Password must be at least 6 characters long.");
    }

    const { auth, authMod } = await getFirebasePublicServices();
    const actionSettings = {
      url: window.location.origin + window.location.pathname + "#account",
      handleCodeInApp: false
    };

    try {
      const cred = await authMod.createUserWithEmailAndPassword(auth, cleanEmail, password);
      if (cleanName) {
        await authMod.updateProfile(cred.user, { displayName: cleanName }).catch(() => {});
      }
      await authMod.sendEmailVerification(cred.user, actionSettings);
      pendingVerificationEmail = cleanEmail;
      currentVerifiedPlayer = null;
      emitAuthState();
      return {
        status: "verification_sent",
        email: cleanEmail
      };
    } catch (err) {
      const code = String(err.code || err.message || "");
      // If user already started signup earlier with same email+password but hasn't verified yet, resend link cleanly!
      if (code.includes("auth/email-already-in-use")) {
        try {
          const existingCred = await authMod.signInWithEmailAndPassword(auth, cleanEmail, password);
          await authMod.reload(existingCred.user);
          if (!existingCred.user.emailVerified) {
            await authMod.sendEmailVerification(existingCred.user, actionSettings);
            pendingVerificationEmail = cleanEmail;
            currentVerifiedPlayer = null;
            emitAuthState();
            return { status: "verification_sent", email: cleanEmail };
          }
          throw new Error("EXISTING_VERIFIED");
        } catch (innerErr) {
          if (String(innerErr.message) === "EXISTING_VERIFIED") {
            throw new Error(
              "This email is already verified and registered! Please switch to the 'Sign In' tab."
            );
          }
          throw new Error(
            "An account with this email already exists. Please switch to 'Sign In' (or use 'Forgot Password')."
          );
        }
      }
      if (code.includes("auth/invalid-email")) {
        throw new Error("Invalid email address format.");
      }
      if (code.includes("auth/weak-password")) {
        throw new Error("Password is too weak — please use at least 6 characters.");
      }
      throw new Error(err.message || "Could not send verification email.");
    }
  }

  async function resendPlayerVerificationLink() {
    if (!isFirebaseConfigured()) throw new Error("Firebase Auth not configured.");
    const { auth, authMod } = await getFirebasePublicServices();
    if (!auth.currentUser) {
      throw new Error("Please enter your email and password again to resend the verification link.");
    }
    await authMod.reload(auth.currentUser);
    if (auth.currentUser.emailVerified) {
      return checkAndCompletePlayerVerification();
    }
    await authMod.sendEmailVerification(auth.currentUser, {
      url: window.location.origin + window.location.pathname + "#account",
      handleCodeInApp: false
    });
    return { status: "resent", email: (auth.currentUser.email || "").toLowerCase() };
  }

  async function checkAndCompletePlayerVerification() {
    if (!isFirebaseConfigured()) return { verified: false };
    const { auth, authMod } = await getFirebasePublicServices();
    const user = auth.currentUser;
    if (!user) return { verified: false };
    await authMod.reload(user);
    if (!user.emailVerified) {
      return { verified: false, email: (user.email || "").toLowerCase() };
    }
    // Email is now verified! Create account profile inside /users/{uid} in Firebase!
    pendingVerificationEmail = "";
    await ensureVerifiedUserNodeInDatabase(user);
    currentVerifiedPlayer = buildPlayerSummary(user);
    await bindPlayerPurchasesListener(user);
    emitAuthState();
    return { verified: true, user: currentVerifiedPlayer };
  }

  async function loginPlayerAccount({ email, password }) {
    if (!isFirebaseConfigured()) {
      throw new Error("Firebase Authentication is not configured in js/store-config.js yet.");
    }
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !password) {
      throw new Error("Please enter both your email and password.");
    }
    const { auth, authMod } = await getFirebasePublicServices();
    try {
      const cred = await authMod.signInWithEmailAndPassword(auth, cleanEmail, password);
      await authMod.reload(cred.user);

      if (!cred.user.emailVerified) {
        pendingVerificationEmail = cleanEmail;
        currentVerifiedPlayer = null;
        await authMod
          .sendEmailVerification(cred.user, {
            url: window.location.origin + window.location.pathname + "#account",
            handleCodeInApp: false
          })
          .catch(() => {});
        emitAuthState();
        return {
          verified: false,
          status: "verification_required",
          email: cleanEmail
        };
      }

      pendingVerificationEmail = "";
      await ensureVerifiedUserNodeInDatabase(cred.user);
      currentVerifiedPlayer = buildPlayerSummary(cred.user);
      await bindPlayerPurchasesListener(cred.user);
      emitAuthState();
      return {
        verified: true,
        user: currentVerifiedPlayer
      };
    } catch (err) {
      const code = String(err.code || err.message || "");
      if (
        code.includes("auth/invalid-credential") ||
        code.includes("auth/user-not-found") ||
        code.includes("auth/wrong-password")
      ) {
        throw new Error("Incorrect email or password. Please check your credentials or Sign Up first.");
      }
      if (code.includes("auth/too-many-requests")) {
        throw new Error("Too many failed attempts. Please wait a minute or reset your password.");
      }
      throw new Error(err.message || "Sign in failed.");
    }
  }

  async function sendPlayerPasswordReset(email) {
    const cleanEmail = String(email || "").trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      throw new Error("Enter your registered email address first so we can send a reset link.");
    }
    const { auth, authMod } = await getFirebasePublicServices();
    await authMod.sendPasswordResetEmail(auth, cleanEmail);
    return { sent: true, email: cleanEmail };
  }

  async function logoutPlayerAccount() {
    if (!isFirebaseConfigured()) return;
    const { auth, authMod } = await getFirebasePublicServices();
    if (unsubPurchasesRef) {
      unsubPurchasesRef();
      unsubPurchasesRef = null;
    }
    currentVerifiedPlayer = null;
    pendingVerificationEmail = "";
    currentPlayerPurchases = {};
    await authMod.signOut(auth).catch(() => {});
    emitAuthState();
  }

  async function savePurchaseToVerifiedAccount(gameId, purchaseMeta) {
    if (!currentVerifiedPlayer || !isRealtimeDbConfigured()) return;
    const { auth } = await getFirebasePublicServices();
    if (!auth.currentUser || !auth.currentUser.emailVerified) return;
    await auth.currentUser.getIdToken(true).catch(() => {});
    const { rtdb, dbMod } = await getPublicRealtimeDb();
    const gameObj = latestPublicGamesCache.find((g) => g.id === gameId) || {};
    const ver = gameObj.version || "v1.0.0";
    const buildTs = Number(gameObj.buildUpdatedAt || gameObj.updatedAt || Date.now());
    const pRef = dbMod.ref(rtdb, `users/${auth.currentUser.uid}/purchases/${gameId}`);
    await dbMod.set(pRef, {
      gameId,
      gameTitle: gameObj.title || purchaseMeta.gameTitle || "Studio Game",
      coverImageUrl: gameObj.coverImageUrl || "",
      unlockMethod: purchaseMeta.method || "razorpay",
      paymentId: purchaseMeta.paymentId || "",
      amount: Number(gameObj.price || 0),
      currency: gameObj.currency || "USD",
      purchasedAt: Date.now(),
      purchasedVersion: ver,
      lastDownloadedVersion: ver,
      lastDownloadedBuildUpdatedAt: buildTs,
      downloadRef: purchaseMeta.rawDownloadRef || ""
    });
  }

  // --------------------------------------------------------------------------
  // STREAMING .ZIP DOWNLOADER (Supports up to 500 MB RTDB Chunks + Google Drive!)
  // Fixes "Could not download / No permission" completely!
  // --------------------------------------------------------------------------
  async function resolveLatestRawDownloadRefForBuyer(game) {
    if (!game) throw new Error("Game not found.");

    // Always prefer live buyer_gate/{gateHash} in Realtime DB so buyers get NEW GAME UPDATES!
    if (isRealtimeDbConfigured()) {
      try {
        const { rtdb, dbMod } = await getPublicRealtimeDb();
        const gateHash = await sha256Hex(`drevalith-buyer-gate-v4:${game.id}`);
        const gateSnap = await dbMod.get(dbMod.ref(rtdb, `buyer_gate/${gateHash}`));
        if (gateSnap.exists()) {
          const gv = gateSnap.val();
          const liveTarget = await decryptAesGcmEnvelope(
            `drevalith-paid-unlock-v4:${game.id}:${gv.nonce || ""}`,
            gv.saltB64,
            gv.ivB64,
            gv.cipherB64
          );
          if (liveTarget) return liveTarget;
        }
      } catch (_) {}
    }

    if (game.isFree && game.freeDirectUrl) {
      return game.freeDirectUrl;
    }

    const pRec = currentPlayerPurchases && currentPlayerPurchases[game.id];
    if (pRec && pRec.downloadRef) return pRec.downloadRef;

    const localRec = getSavedUnlocks()[game.id];
    if (localRec && (localRec.rawDownloadRef || localRec.downloadUrl)) {
      return localRec.rawDownloadRef || localRec.downloadUrl;
    }

    if (!isStaticGithubHostWithoutBackend() && game.isFree) {
      return `${API_BASE}/api/download/${encodeURIComponent(game.id)}`;
    }

    throw new Error("Download archive is not linked yet. Please contact the studio or try again.");
  }

  function triggerBrowserSaveBlob(blob, fileName) {
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = fileName || "Drevalith_Game_Build.zip";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
        URL.revokeObjectURL(blobUrl);
      } catch (_) {}
    }, 180000); // Keep alive 3 minutes so large 500 MB writes complete cleanly!
  }

  function triggerExternalDirectUrl(rawUrl) {
    const finalUrl = normalizeExternalDownloadUrl(rawUrl);
    const a = document.createElement("a");
    a.href = finalUrl;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try {
        document.body.removeChild(a);
      } catch (_) {}
    }, 2000);
  }

  async function triggerVerifiedDownload(gameId, onProgress) {
    const game =
      latestPublicGamesCache.find((g) => g.id === gameId) ||
      (currentPlayerPurchases[gameId]
        ? { id: gameId, title: currentPlayerPurchases[gameId].gameTitle || "Game" }
        : null);
    if (!game) throw new Error("Game metadata is still loading — please click again in a moment.");

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

    if (String(rawRef).startsWith("rtdb_blob:")) {
      const blobToken = String(rawRef).slice("rtdb_blob:".length).trim();
      const { rtdb, dbMod } = await getPublicRealtimeDb();
      let metaSnap;
      try {
        metaSnap = await dbMod.get(dbMod.ref(rtdb, `zip_blobs/${blobToken}/meta`));
      } catch (permErr) {
        throw new Error(
          "Firebase Database Rules need a 1-click update to allow /zip_blobs downloads! (Studio Owner: click 'Copy Firebase Rules' in your console and Publish in Firebase.)"
        );
      }
      if (!metaSnap.exists()) {
        throw new Error("Game .ZIP archive was not found in database. Please wait if an update is uploading.");
      }
      const meta = metaSnap.val();
      const totalChunks = Number(meta.totalChunks || 0);
      if (totalChunks <= 0) throw new Error("Invalid archive metadata.");

      const byteParts = new Array(totalChunks);
      let completed = 0;
      const CONCURRENCY = 3;

      for (let i = 0; i < totalChunks; i += CONCURRENCY) {
        const batchIndices = [];
        for (let j = i; j < Math.min(i + CONCURRENCY, totalChunks); j++) {
          batchIndices.push(j);
        }
        await Promise.all(
          batchIndices.map(async (idx) => {
            const cSnap = await dbMod.get(dbMod.ref(rtdb, `zip_blobs/${blobToken}/chunks/${idx}`));
            if (!cSnap.exists()) {
              throw new Error(`Archive chunk #${idx + 1} missing — please retry download.`);
            }
            byteParts[idx] = b64ToBytes(cSnap.val());
            completed += 1;
            if (typeof onProgress === "function") {
              onProgress(Math.min(99, Math.round((completed / totalChunks) * 100)));
            }
          })
        );
      }

      if (typeof onProgress === "function") onProgress(100);
      const zipBlob = new Blob(byteParts, { type: "application/zip" });
      triggerBrowserSaveBlob(zipBlob, meta.fileName || safeFileName);
    } else if (String(rawRef).startsWith("rtdb_chunks:")) {
      // Legacy chunk path support
      const chunkPath = String(rawRef).slice("rtdb_chunks:".length);
      const { rtdb, dbMod } = await getPublicRealtimeDb();
      let snap;
      try {
        snap = await dbMod.get(dbMod.ref(rtdb, chunkPath));
      } catch (_) {
        throw new Error(
          "This build used an older locked vault path. Studio Owner: re-upload the .ZIP in your console once + publish updated Firebase Rules!"
        );
      }
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

    // Mark latest version as downloaded in player's cloud purchase record!
    if (currentVerifiedPlayer && currentPlayerPurchases[gameId] && isRealtimeDbConfigured()) {
      try {
        const { auth } = await getFirebasePublicServices();
        const { rtdb, dbMod } = await getPublicRealtimeDb();
        if (auth.currentUser) {
          await dbMod.update(dbMod.ref(rtdb, `users/${auth.currentUser.uid}/purchases/${gameId}`), {
            lastDownloadedVersion: game.version || "v1.0.0",
            lastDownloadedBuildUpdatedAt: Number(game.buildUpdatedAt || game.updatedAt || Date.now()),
            lastDownloadedAt: Date.now()
          });
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

  let latestPublicGamesCache = [];

  function subscribePublicStore(onChange) {
    if (isRealtimeDbConfigured()) {
      let unsubGames = null;
      let unsubSettings = null;
      let latestGames = [];
      let latestSettings = { showDefaultComingSoon: true };

      const emit = () => {
        latestPublicGamesCache = latestGames;
        onChange({
          mode: "firebase_rtdb",
          settings: latestSettings,
          games: latestGames
        });
      };

      getPublicRealtimeDb()
        .then(({ rtdb, dbMod }) => {
          unsubGames = dbMod.onValue(dbMod.ref(rtdb, "games"), (snap) => {
            const val = snap.val() || {};
            const items = Object.keys(val)
              .map((k) => ({ id: k, ...val[k] }))
              .filter((g) => g && g.published !== false);
            items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            latestGames = items;
            emit();
          });

          unsubSettings = dbMod.onValue(dbMod.ref(rtdb, "settings/public_store"), (snap) => {
            if (snap.exists()) {
              latestSettings = { showDefaultComingSoon: true, ...snap.val() };
            }
            emit();
          });
        })
        .catch((err) => console.error("Realtime Database connection error:", err));

      return () => {
        if (unsubGames) unsubGames();
        if (unsubSettings) unsubSettings();
      };
    }

    if (isFirebaseConfigured()) {
      let unsubGames = null;
      let unsubSettings = null;
      let latestGames = [];
      let latestSettings = { showDefaultComingSoon: true };

      const emit = () => {
        latestPublicGamesCache = latestGames;
        onChange({
          mode: "firebase",
          settings: latestSettings,
          games: latestGames
        });
      };

      getPublicFirestore()
        .then(({ db, fsMod }) => {
          const gamesRef = fsMod.collection(db, "games");
          unsubGames = fsMod.onSnapshot(gamesRef, (snap) => {
            const items = [];
            snap.forEach((d) => {
              const data = d.data();
              if (data.published !== false) items.push({ id: d.id, ...data });
            });
            items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            latestGames = items;
            emit();
          });

          const settingsRef = fsMod.doc(db, "settings", "public_store");
          unsubSettings = fsMod.onSnapshot(settingsRef, (snap) => {
            if (snap.exists()) {
              latestSettings = { showDefaultComingSoon: true, ...snap.data() };
            }
            emit();
          });
        })
        .catch((err) => console.error("Firestore connection error:", err));

      return () => {
        if (unsubGames) unsubGames();
        if (unsubSettings) unsubSettings();
      };
    }

    if (isStaticGithubHostWithoutBackend()) {
      onChange({
        mode: "unconfigured_static",
        settings: { showDefaultComingSoon: true },
        games: []
      });
      return () => {};
    }

    let es = null;
    let active = true;

    async function fetchInitial() {
      try {
        const res = await fetch(`${API_BASE}/api/public/state`);
        if (!res.ok) return;
        const state = await res.json();
        if (active) {
          latestPublicGamesCache = state.games || [];
          onChange({
            mode: "server_realtime",
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
              onChange({
                mode: "server_realtime",
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
    const fc = CFG.FIREBASE_CONFIG || {};
    const backendOrder = await tryBackendJson("/api/razorpay/create-order", {
      gameId: game.id,
      firebaseDatabaseUrl: isRealtimeDbConfigured() ? fc.databaseURL : "",
      firebaseProjectId: isFirebaseConfigured() ? fc.projectId : ""
    });
    if (backendOrder) return backendOrder;

    const amountSubunits = Math.round(Number(game.price || 0) * 100);
    const currency = String(game.currency || "USD").toUpperCase() === "INR" ? "INR" : "USD";
    if (isRazorpayLiveKeyConfigured()) {
      return {
        mode: "live_razorpay_serverless",
        keyId: CFG.RAZORPAY_KEY_ID,
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
        method: "razorpay",
        paymentId: payload.razorpay_payment_id,
        orderId: payload.razorpay_order_id,
        rawDownloadRef: downloadUrl,
        expiresInMinutes: backendVer.expiresInMinutes || 60
      };
      saveUnlockReceipt(payload.gameId, receipt);
      await savePurchaseToVerifiedAccount(payload.gameId, receipt).catch(() => {});
      notifyOtherTabs();
      return receipt;
    }

    if (!payload.razorpay_payment_id) {
      throw new Error("Payment ID missing — download remains locked.");
    }
    if (!isRealtimeDbConfigured()) {
      throw new Error("Configure FIREBASE_CONFIG.databaseURL in js/store-config.js.");
    }

    const { rtdb, dbMod } = await getPublicRealtimeDb();
    const gateHash = await sha256Hex(`drevalith-buyer-gate-v4:${payload.gameId}`);
    const gateSnap = await dbMod.get(dbMod.ref(rtdb, `buyer_gate/${gateHash}`));
    if (!gateSnap.exists()) {
      throw new Error("Download archive not configured for this game yet.");
    }
    const gateVal = gateSnap.val();
    const rawRef = await decryptAesGcmEnvelope(
      `drevalith-paid-unlock-v4:${payload.gameId}:${gateVal.nonce || ""}`,
      gateVal.saltB64,
      gateVal.ivB64,
      gateVal.cipherB64
    );

    const safePid = String(payload.razorpay_payment_id).replace(/[^a-zA-Z0-9_-]/g, "_");
    const gameObj = latestPublicGamesCache.find((g) => g.id === payload.gameId) || {};
    const buyerEmail =
      (currentVerifiedPlayer && currentVerifiedPlayer.email) ||
      String(payload.buyerEmail || "").toLowerCase();

    await dbMod
      .set(dbMod.ref(rtdb, `transactions/txn_${safePid}`), {
        id: `txn_${safePid}`,
        type: "razorpay_payment",
        mode: payload.sandboxSimulated ? "sandbox_preview" : "live_razorpay",
        gameId: payload.gameId,
        gameTitle: gameObj.title || "Game",
        gameVersion: gameObj.version || "v1.0.0",
        amount: Number(gameObj.price || 0),
        currency: gameObj.currency || "USD",
        paymentId: payload.razorpay_payment_id,
        buyerUid: currentVerifiedPlayer ? currentVerifiedPlayer.uid : "",
        buyerEmail,
        createdAt: Date.now()
      })
      .catch(() => {});

    const receipt = {
      gameId: payload.gameId,
      gameTitle: gameObj.title || "Game",
      method: "razorpay",
      paymentId: payload.razorpay_payment_id,
      rawDownloadRef: rawRef,
      expiresInMinutes: 10080
    };
    saveUnlockReceipt(payload.gameId, receipt);
    await savePurchaseToVerifiedAccount(payload.gameId, receipt).catch(() => {});
    return receipt;
  }

  async function redeemPrivateKey({ gameId, gameTitle, privateKey, redeemerLabel }) {
    const clean = normalizePrivateKey(privateKey);
    if (!clean || clean.length < 6) {
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
      if (Number(curr.maxUses) > 0 && Number(curr.usedCount || 0) >= Number(env.maxUses)) return;
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
    if (!pid) throw new Error("Please enter your Razorpay Payment ID (starts with pay_).");

    const backendRes = await tryBackendJson("/api/purchases/restore", { gameId, paymentId: pid, buyerEmail });
    if (backendRes && backendRes.verified) {
      const downloadUrl =
        backendRes.downloadUrl && backendVerDownloadUrl(backendRes.downloadUrl);
      const receipt = {
        gameId,
        method: "razorpay_restored",
        paymentId: pid,
        rawDownloadRef: downloadUrl,
        expiresInMinutes: 60
      };
      saveUnlockReceipt(gameId, receipt);
      await savePurchaseToVerifiedAccount(gameId, receipt).catch(() => {});
      return receipt;
    }

    throw new Error(
      "Sign in to your Drevalith Account ('My Purchases' in top menu) to access all your purchased games & updates!"
    );
  }

  function backendVerDownloadUrl(u) {
    return u && String(u).startsWith("/") ? `${API_BASE}${u}` : u;
  }

  function getFreeGameDownloadUrl(game) {
    if (!game || !game.isFree) return "";
    if (game.freeDirectUrl) return game.freeDirectUrl;
    return `${API_BASE}/api/download/${encodeURIComponent(game.id)}`;
  }

  window.DrevalithStore = {
    isFirebaseConfigured,
    isRealtimeDbConfigured,
    isRazorpayLiveKeyConfigured,
    formatPrivateKeyInput,
    formatBytes,
    formatCurrency,
    getUnlockForGame,
    getFreeGameDownloadUrl,
    subscribePublicStore,
    subscribePlayerAuth,
    getCurrentPlayer,
    getPlayerPurchases,
    hasGameUpdateAvailable,
    registerPlayerAccount,
    resendPlayerVerificationLink,
    checkAndCompletePlayerVerification,
    loginPlayerAccount,
    sendPlayerPasswordReset,
    logoutPlayerAccount,
    triggerVerifiedDownload,
    loadRazorpayCheckoutScript,
    createPaymentOrder,
    verifyRazorpayPayment,
    redeemPrivateKey,
    restorePurchase
  };
})();
