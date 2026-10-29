/**
 * ============================================================================
 * DREVALITH GAMES™ — CLEAN REALTIME GAME CATALOG ENGINE (v17)
 * ============================================================================
 * - 100% Free Firebase Realtime Database live catalog sync (<150ms HTTPS REST
 *   initial load + live WebSocket updates whenever the Studio Owner publishes
 *   a game or posts a new game update).
 * - Direct itch.io Buy Link routing (zero payment gateways, zero player login).
 * - Supports direct Cover Image uploads (Realtime DB) & Google Drive images.
 * ============================================================================
 */
(function () {
  "use strict";

  const CFG = window.DREVALITH_CONFIG || {};
  const API_BASE = String(CFG.BACKEND_API_URL || "").replace(/\/+$/, "");

  const broadcastBus =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("drevalith_catalog_realtime_v17")
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

  function isStaticGithubHostWithoutBackend() {
    if (API_BASE) return false;
    const h = (typeof location !== "undefined" && location.hostname) || "";
    return h.endsWith(".github.io") || h.endsWith(".pages.dev") || h.endsWith(".netlify.app");
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

  function normalizePublicCoverUrl(url) {
    const u = String(url || "").trim();
    if (!u) return "";
    if (u.startsWith("data:image/") || u.startsWith("blob:")) return u;
    if (u.startsWith("/") && API_BASE) return `${API_BASE}${u}`;
    const driveId = extractGoogleDriveId(u);
    if (driveId) return `https://lh3.googleusercontent.com/d/${driveId}=w1280`;
    if (/^https?:\/\//i.test(u) || u.startsWith("/")) return u;
    return "";
  }

  function normalizeItchBuyUrl(rawUrl) {
    let u = String(rawUrl || "").trim();
    if (!u) return "";
    if (/^(javascript|data|vbscript|file):/i.test(u)) return "";
    if (!/^https?:\/\//i.test(u)) {
      u = `https://${u.replace(/^\/+/, "")}`;
    }
    try {
      const parsed = new URL(u);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
      return parsed.href;
    } catch (_) {
      return "";
    }
  }

  function getRtdbRestBaseUrl() {
    const fc = CFG.FIREBASE_CONFIG || {};
    return String(fc.databaseURL || "").trim().replace(/\/+$/, "");
  }

  async function rtdbRestGet(path) {
    const base = getRtdbRestBaseUrl();
    if (!base) return null;
    const cleanPath = String(path || "").replace(/^\/+|\/+$/g, "");
    const res = await fetch(`${base}/${cleanPath}.json`, {
      method: "GET",
      headers: { "Accept": "application/json" },
      cache: "no-store"
    });
    if (!res.ok) return null;
    return res.json();
  }

  let rtdbSdkPromise = null;
  async function getPublicRealtimeDb() {
    if (rtdbSdkPromise) return rtdbSdkPromise;
    rtdbSdkPromise = (async () => {
      const ver = CFG.FIREBASE_SDK_VERSION || "11.0.2";
      const [appMod, dbMod] = await Promise.all([
        import(`https://www.gstatic.com/firebasejs/${ver}/firebase-app.js`),
        import(`https://www.gstatic.com/firebasejs/${ver}/firebase-database.js`)
      ]);
      const existing = appMod.getApps().find((a) => a.name === "DrevalithPublicCatalog");
      const app = existing || appMod.initializeApp(CFG.FIREBASE_CONFIG, "DrevalithPublicCatalog");
      const rtdb = dbMod.getDatabase(app, CFG.FIREBASE_CONFIG.databaseURL);
      return { rtdb, dbMod };
    })();
    return rtdbSdkPromise;
  }

  function normalizeGameRecord(id, raw) {
    const obj = raw && typeof raw === "object" ? raw : {};
    const itchUrl = normalizeItchBuyUrl(obj.itchUrl || obj.buyUrl || "");
    return {
      id: String(id || obj.id || ""),
      title: String(obj.title || "Untitled Game").trim(),
      subtitle: String(obj.subtitle || "").trim(),
      badgeText: String(obj.badgeText || "").trim(),
      description: String(obj.description || "").trim(),
      gameplayText: String(obj.gameplayText || "").trim(),
      featuresList: Array.isArray(obj.featuresList)
        ? obj.featuresList.map((x) => String(x || "").trim()).filter(Boolean)
        : [],
      updateNotes: String(obj.updateNotes || "").trim(),
      releaseDate: String(obj.releaseDate || obj.comingSoonLabel || "").trim(),
      platform: String(obj.platform || "Windows PC (64-bit)").trim(),
      modes: String(obj.modes || "").trim(),
      version: String(obj.version || "").trim(),
      coverImageUrl: normalizePublicCoverUrl(obj.coverImageUrl),
      itchUrl,
      buyButtonText: String(obj.buyButtonText || "Buy on itch.io ↗").trim(),
      published: obj.published !== false,
      createdAt: Number(obj.createdAt || 0),
      updatedAt: Number(obj.updatedAt || obj.buildUpdatedAt || 0)
    };
  }

  function parseGamesMap(val) {
    const obj = val && typeof val === "object" ? val : {};
    return Object.keys(obj)
      .filter((id) => obj[id] && typeof obj[id] === "object")
      .map((id) => normalizeGameRecord(id, obj[id]))
      .filter((g) => g.published !== false)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }

  function subscribePublicStore(onChange) {
    if (isRealtimeDbConfigured()) {
      let unsubGames = null;
      let restPollTimer = null;
      let latestGames = [];
      let loaded = false;
      let lastSig = "";

      const emit = () => {
        let sig = "";
        try {
          sig = JSON.stringify({ loaded, games: latestGames });
        } catch (_) {}
        if (sig && sig === lastSig) return;
        lastSig = sig;
        onChange({
          mode: "firebase_rtdb",
          loaded,
          games: latestGames
        });
      };

      const fetchViaRest = async () => {
        try {
          const gMap = await rtdbRestGet("games");
          latestGames = parseGamesMap(gMap);
          loaded = true;
          emit();
        } catch (_) {}
      };

      fetchViaRest();
      restPollTimer = setInterval(fetchViaRest, 15000);

      getPublicRealtimeDb()
        .then(({ rtdb, dbMod }) => {
          unsubGames = dbMod.onValue(dbMod.ref(rtdb, "games"), (snap) => {
            latestGames = parseGamesMap(snap.val());
            loaded = true;
            emit();
          });
        })
        .catch(() => {});

      return () => {
        if (restPollTimer) clearInterval(restPollTimer);
        if (unsubGames) unsubGames();
      };
    }

    if (isStaticGithubHostWithoutBackend()) {
      onChange({ mode: "unconfigured", loaded: true, games: [] });
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
          const arr = Array.isArray(state.games)
            ? state.games.map((g) => normalizeGameRecord(g.id, g)).filter((g) => g.published !== false)
            : [];
          onChange({ mode: "server_realtime", loaded: true, games: arr });
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
              const arr = Array.isArray(msg.state.games)
                ? msg.state.games.map((g) => normalizeGameRecord(g.id, g)).filter((g) => g.published !== false)
                : [];
              onChange({ mode: "server_realtime", loaded: true, games: arr });
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

  window.DrevalithStore = {
    isFirebaseConfigured,
    isRealtimeDbConfigured,
    normalizePublicCoverUrl,
    normalizeItchBuyUrl,
    subscribePublicStore
  };
})();
