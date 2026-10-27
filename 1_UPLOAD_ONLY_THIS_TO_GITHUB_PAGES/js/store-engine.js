/**
 * ============================================================================
 * DREVALITH GAMES™ — PUBLIC STOREFRONT REALTIME & CRYPTO CHECKOUT ENGINE
 * ============================================================================
 * Works seamlessly on BOTH:
 *   1. GitHub Pages (drevalithgames.github.io) + Free Firebase Realtime DB
 *      using Web Crypto AES-256-GCM Private Key Envelopes & Razorpay Checkout!
 *   2. Python Security Backend (secure_backend.py) when BACKEND_API_URL is set.
 * Zero owner/admin routes, emails, or management logic exist in public JS.
 * ============================================================================
 */

(function () {
  const CFG = window.DREVALITH_CONFIG || {};
  const API_BASE = (CFG.BACKEND_API_URL || "").replace(/\/+$/, "");
  const UNLOCK_STORAGE_KEY = "drevalith_verified_unlocks_v4";
  const BC_NAME = "drevalith_realtime_bus_v4";

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
  // Web Crypto SHA-256 & AES-256-GCM Decryption for Serverless Key Envelopes
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
    const keyMat = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(passphrase),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const aesKey = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt: b64ToBytes(saltB64),
        iterations: 100000,
        hash: "SHA-256"
      },
      keyMat,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const plainBuf = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64ToBytes(ivB64) },
      aesKey,
      b64ToBytes(cipherB64)
    );
    return new TextDecoder().decode(plainBuf);
  }

  function getSavedUnlocks() {
    try {
      const map = JSON.parse(localStorage.getItem(UNLOCK_STORAGE_KEY) || "{}");
      const now = Date.now();
      let changed = false;
      for (const gid of Object.keys(map)) {
        if (map[gid].expiresAt && now > map[gid].expiresAt) {
          delete map[gid];
          changed = true;
        }
      }
      if (changed) localStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify(map));
      return map;
    } catch (_) {
      return {};
    }
  }

  function saveUnlockReceipt(gameId, receiptData) {
    try {
      const map = getSavedUnlocks();
      const ttlMs = Number(receiptData.expiresInMinutes || 60) * 60 * 1000;
      map[gameId] = {
        ...receiptData,
        unlockedAt: Date.now(),
        expiresAt: Date.now() + ttlMs
      };
      localStorage.setItem(UNLOCK_STORAGE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function getUnlockForGame(gameId) {
    const map = getSavedUnlocks();
    return map[gameId] || null;
  }

  let rtdbPromise = null;
  async function getPublicRealtimeDb() {
    if (!isRealtimeDbConfigured()) return null;
    if (rtdbPromise) return rtdbPromise;
    const ver = CFG.FIREBASE_SDK_VERSION || "11.0.2";
    const base = `https://www.gstatic.com/firebasejs/${ver}`;
    rtdbPromise = (async () => {
      const [appMod, dbMod] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-database.js`)
      ]);
      const app = appMod.getApps().length
        ? appMod.getApp()
        : appMod.initializeApp(CFG.FIREBASE_CONFIG);
      const rtdb = dbMod.getDatabase(app);
      return { rtdb, dbMod };
    })();
    return rtdbPromise;
  }

  let fsPromise = null;
  async function getPublicFirestore() {
    if (!isFirebaseConfigured()) return null;
    if (fsPromise) return fsPromise;
    const ver = CFG.FIREBASE_SDK_VERSION || "11.0.2";
    const base = `https://www.gstatic.com/firebasejs/${ver}`;
    fsPromise = (async () => {
      const [appMod, fsMod] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-firestore.js`)
      ]);
      const app = appMod.getApps().length
        ? appMod.getApp()
        : appMod.initializeApp(CFG.FIREBASE_CONFIG);
      const db = fsMod.getFirestore(app);
      return { db, fsMod };
    })();
    return fsPromise;
  }

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

  async function resolveRtdbOrDirectUrl(rawTarget) {
    if (!rawTarget || !String(rawTarget).startsWith("rtdb_chunks:")) return rawTarget;
    // Reassemble base64 chunks stored directly in Firebase Realtime Database into a Blob download URL!
    const chunkPath = String(rawTarget).slice("rtdb_chunks:".length);
    const { rtdb, dbMod } = await getPublicRealtimeDb();
    const snap = await dbMod.get(dbMod.ref(rtdb, chunkPath));
    if (!snap.exists()) throw new Error("Game build archive not found in Realtime Database.");
    const chunks = snap.val();
    const parts = (Array.isArray(chunks) ? chunks : Object.values(chunks)).map((b64) => b64ToBytes(b64));
    const blob = new Blob(parts, { type: "application/zip" });
    return URL.createObjectURL(blob);
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

    // GitHub Pages Serverless Razorpay Mode (reads authoritative price from Firebase Realtime DB!)
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
        downloadUrl,
        expiresInMinutes: backendVer.expiresInMinutes || 15
      };
      saveUnlockReceipt(payload.gameId, receipt);
      notifyOtherTabs();
      return receipt;
    }

    // Serverless GitHub Pages + Firebase Realtime Database Fulfillment
    if (!payload.razorpay_payment_id) {
      throw new Error("Payment ID missing — download remains locked.");
    }
    if (!isRealtimeDbConfigured()) {
      throw new Error("Configure FIREBASE_CONFIG.databaseURL in js/store-config.js or set BACKEND_API_URL.");
    }

    const { rtdb, dbMod } = await getPublicRealtimeDb();
    const gateHash = await sha256Hex(`drevalith-buyer-gate-v4:${payload.gameId}`);
    const gateSnap = await dbMod.get(dbMod.ref(rtdb, `buyer_gate/${gateHash}`));
    if (!gateSnap.exists()) {
      throw new Error("Download archive not configured for this game yet.");
    }
    const gateVal = gateSnap.val();
    const rawUrl = await decryptAesGcmEnvelope(
      `drevalith-paid-unlock-v4:${payload.gameId}:${gateVal.nonce || ""}`,
      gateVal.saltB64,
      gateVal.ivB64,
      gateVal.cipherB64
    );
    const finalUrl = await resolveRtdbOrDirectUrl(rawUrl);

    const safePid = String(payload.razorpay_payment_id).replace(/[^a-zA-Z0-9_-]/g, "_");
    const gameObj = latestPublicGamesCache.find((g) => g.id === payload.gameId) || {};
    await dbMod.set(dbMod.ref(rtdb, `transactions/txn_${safePid}`), {
      id: `txn_${safePid}`,
      type: "razorpay_payment",
      mode: payload.sandboxSimulated ? "sandbox_preview" : "live_razorpay",
      gameId: payload.gameId,
      gameTitle: gameObj.title || "Game",
      amount: Number(gameObj.price || 0),
      currency: gameObj.currency || "USD",
      paymentId: payload.razorpay_payment_id,
      buyerEmail: String(payload.buyerEmail || "").toLowerCase(),
      createdAt: Date.now()
    }).catch(() => {});

    const receipt = {
      gameId: payload.gameId,
      method: "razorpay",
      paymentId: payload.razorpay_payment_id,
      downloadUrl: finalUrl,
      expiresInMinutes: 60
    };
    saveUnlockReceipt(payload.gameId, receipt);
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
        method: "private_key",
        downloadUrl,
        expiresInMinutes: backendRed.expiresInMinutes || 15
      };
      saveUnlockReceipt(gameId, receipt);
      notifyOtherTabs();
      return receipt;
    }

    // Serverless GitHub Pages AES-256-GCM Private Key Envelope Redemption!
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

    // Atomic single-use / max-uses transaction lock in Firebase Realtime Database!
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

    // Decrypt the download link using the secret Private Key itself (AES-256-GCM)!
    let decryptedTarget = "";
    if (env.cipherMap && env.cipherMap[gameId]) {
      const m = env.cipherMap[gameId];
      decryptedTarget = await decryptAesGcmEnvelope(clean, m.saltB64, m.ivB64, m.cipherB64);
    } else if (env.cipherB64) {
      decryptedTarget = await decryptAesGcmEnvelope(clean, env.saltB64, env.ivB64, env.cipherB64);
    } else {
      throw new Error("No game archive linked to this key yet.");
    }

    const finalUrl = await resolveRtdbOrDirectUrl(decryptedTarget);
    await dbMod.set(dbMod.ref(rtdb, `transactions/txn_key_${Date.now()}_${ lookupHash.slice(0, 6) }`), {
      id: `txn_key_${Date.now()}`,
      type: "private_key",
      mode: "owner_key",
      gameId,
      gameTitle: gameTitle || "Game",
      amount: 0,
      currency: "FREE (KEY)",
      keyCodeMasked: `${clean.slice(0, 8)}-****`,
      buyerEmail: String(redeemerLabel || ""),
      createdAt: Date.now()
    }).catch(() => {});

    const receipt = {
      gameId,
      method: "private_key",
      downloadUrl: finalUrl,
      expiresInMinutes: 60
    };
    saveUnlockReceipt(gameId, receipt);
    return receipt;
  }

  async function restorePurchase({ gameId, paymentId, buyerEmail }) {
    const pid = String(paymentId || "").trim();
    if (!pid) throw new Error("Please enter your Razorpay Payment ID (starts with pay_).");

    const backendRes = await tryBackendJson("/api/purchases/restore", { gameId, paymentId: pid, buyerEmail });
    if (backendRes && backendRes.verified) {
      const downloadUrl =
        backendRes.downloadUrl && backendRes.downloadUrl.startsWith("/")
          ? `${API_BASE}${backendRes.downloadUrl}`
          : backendRes.downloadUrl;
      const receipt = { gameId, method: "razorpay_restored", paymentId: pid, downloadUrl, expiresInMinutes: 15 };
      saveUnlockReceipt(gameId, receipt);
      return receipt;
    }

    throw new Error("Purchase restore requires an active backend server or valid Private Key.");
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
    loadRazorpayCheckoutScript,
    createPaymentOrder,
    verifyRazorpayPayment,
    redeemPrivateKey,
    restorePurchase
  };
})();
