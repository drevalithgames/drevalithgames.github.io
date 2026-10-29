/**
 * ============================================================================
 * DREVALITH GAMES™ — CLEAN REALTIME GAME CATALOG ENGINE (v19)
 * ============================================================================
 * - 100% Free Firebase Realtime Database live catalog sync (<150ms HTTPS REST
 *   initial load + live WebSocket updates whenever the Studio Owner publishes
 *   a game, toggles the Buy button, or posts a new game update).
 * - Explicit Owner Buy Button Enable / Disable / Hide control + Automatic
 *   Future Release Date & "Coming Soon" Lock (never shows an active Buy button
 *   before release day or while disabled).
 * - Direct itch.io Buy Link routing (zero payment gateways, zero player login).
 * ============================================================================
 */
(function () {
  "use strict";

  const CFG = window.DREVALITH_CONFIG || {};
  const API_BASE = String(CFG.BACKEND_API_URL || "").replace(/\/+$/, "");

  const broadcastBus =
    typeof BroadcastChannel !== "undefined"
      ? new BroadcastChannel("drevalith_catalog_realtime_v18")
      : null;

  const MONTH_LOOKUP = {
    jan: 0, january: 0,
    feb: 1, february: 1,
    mar: 2, march: 2,
    apr: 3, april: 3,
    may: 4,
    jun: 5, june: 5,
    jul: 6, july: 6,
    aug: 7, august: 7,
    sep: 8, sept: 8, september: 8,
    oct: 9, october: 9,
    nov: 10, november: 10,
    dec: 11, december: 11
  };

  const SHORT_MONTHS = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
  ];

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

  function formatNiceDate(y, mIdx, d) {
    if (mIdx < 0 || mIdx > 11) return "";
    if (!d) return `${SHORT_MONTHS[mIdx]} ${y}`;
    return `${SHORT_MONTHS[mIdx]} ${d}, ${y}`;
  }

  /**
   * Determines whether a game's release schedule is still in the future or
   * marked as "Coming Soon" so an active Buy button is NEVER displayed early.
   */
  function analyzeReleaseSchedule(releaseDate, releaseStatus, releaseDateIso, nowRef) {
    const now = nowRef instanceof Date ? nowRef : nowRef ? new Date(nowRef) : new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

    const statusNorm = String(releaseStatus || "").trim().toLowerCase();
    const rawText = String(releaseDate || "").trim();
    const isoText = String(releaseDateIso || "").trim();

    if (statusNorm === "coming_soon") {
      return {
        isUnreleased: true,
        reason: "coming_soon_status",
        formattedDate: rawText && !/^coming\s*soon$/i.test(rawText) ? rawText : ""
      };
    }

    // 1. Explicit ISO YYYY-MM-DD from calendar picker
    const isoMatch = isoText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (isoMatch) {
      const y = Number(isoMatch[1]);
      const m = Number(isoMatch[2]) - 1;
      const d = Number(isoMatch[3]);
      const dt = new Date(y, m, d);
      if (!Number.isNaN(dt.getTime())) {
        const isFuture = dt.getTime() > todayStart;
        return {
          isUnreleased: isFuture,
          reason: isFuture ? "future_date" : "released_date",
          formattedDate: formatNiceDate(y, m, d)
        };
      }
    }

    if (!rawText) {
      return { isUnreleased: false, reason: "unspecified", formattedDate: "" };
    }

    // 2. Explicit Coming Soon / Unreleased keywords
    if (
      /\b(coming\s*soon|upcoming|unreleased|tba|tbd|to\s*be\s*announced|wishlist|in\s*development|next\s*month|next\s*year|pre-?release)\b/i.test(
        rawText
      ) ||
      /^soon$/i.test(rawText)
    ) {
      return { isUnreleased: true, reason: "coming_soon_keyword", formattedDate: "" };
    }

    if (/\b(out\s*now|available\s*now|live\s*now)\b/i.test(rawText) || /^released$/i.test(rawText)) {
      return { isUnreleased: false, reason: "released_keyword", formattedDate: rawText };
    }

    // 3. YYYY-MM-DD or YYYY/MM/DD inside releaseDate text
    const ymd = rawText.match(/\b(20\d{2})[-\/](\d{1,2})[-\/](\d{1,2})\b/);
    if (ymd) {
      const y = Number(ymd[1]);
      const m = Number(ymd[2]) - 1;
      const d = Number(ymd[3]);
      const dt = new Date(y, m, d);
      if (!Number.isNaN(dt.getTime())) {
        const isFuture = dt.getTime() > todayStart;
        return {
          isUnreleased: isFuture,
          reason: isFuture ? "future_date" : "released_date",
          formattedDate: formatNiceDate(y, m, d)
        };
      }
    }

    // 4. DD/MM/YYYY or DD-MM-YYYY (with automatic MM/DD fallback when 2nd > 12)
    const dmy = rawText.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](20\d{2})\b/);
    if (dmy) {
      const n1 = Number(dmy[1]);
      const n2 = Number(dmy[2]);
      const y = Number(dmy[3]);
      const m = n2 > 12 && n1 <= 12 ? n1 - 1 : n2 - 1;
      const d = n2 > 12 && n1 <= 12 ? n2 : n1;
      const dt = new Date(y, m, d);
      if (!Number.isNaN(dt.getTime()) && m >= 0 && m <= 11 && d >= 1 && d <= 31) {
        const isFuture = dt.getTime() > todayStart;
        return {
          isUnreleased: isFuture,
          reason: isFuture ? "future_date" : "released_date",
          formattedDate: formatNiceDate(y, m, d)
        };
      }
    }

    // 5. Month Name + Day + Year (e.g. "Nov 15, 2026" or "November 15 2026")
    const mdy = rawText.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\s*,?\s*(20\d{2})\b/i
    );
    if (mdy) {
      const m = MONTH_LOOKUP[mdy[1].toLowerCase()];
      const d = Number(mdy[2]);
      const y = Number(mdy[3]);
      if (m !== undefined) {
        const dt = new Date(y, m, d);
        const isFuture = dt.getTime() > todayStart;
        return {
          isUnreleased: isFuture,
          reason: isFuture ? "future_date" : "released_date",
          formattedDate: formatNiceDate(y, m, d)
        };
      }
    }

    // 6. Day + Month Name + Year (e.g. "15 Nov 2026" or "15th November 2026")
    const dMonthY = rawText.match(
      /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,?\s*(20\d{2})\b/i
    );
    if (dMonthY) {
      const d = Number(dMonthY[1]);
      const m = MONTH_LOOKUP[dMonthY[2].toLowerCase()];
      const y = Number(dMonthY[3]);
      if (m !== undefined) {
        const dt = new Date(y, m, d);
        const isFuture = dt.getTime() > todayStart;
        return {
          isUnreleased: isFuture,
          reason: isFuture ? "future_date" : "released_date",
          formattedDate: formatNiceDate(y, m, d)
        };
      }
    }

    // 7. Month Name + Year only (e.g. "Nov 2026", "November 2026")
    const myOnly = rawText.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*,?\s*(20\d{2})\b/i
    );
    if (myOnly) {
      const m = MONTH_LOOKUP[myOnly[1].toLowerCase()];
      const y = Number(myOnly[2]);
      if (m !== undefined) {
        const monthStart = new Date(y, m, 1).getTime();
        const isFuture = monthStart > todayStart;
        return {
          isUnreleased: isFuture,
          reason: isFuture ? "future_date" : "released_date",
          formattedDate: formatNiceDate(y, m, 0)
        };
      }
    }

    // 8. YYYY-MM or MM/YYYY (e.g. "2026-11" or "11/2026")
    const ymNum =
      rawText.match(/^\s*(20\d{2})[-\/](\d{1,2})\s*$/) ||
      rawText.match(/^\s*(\d{1,2})[-\/](20\d{2})\s*$/);
    if (ymNum) {
      const firstIsYear = ymNum[1].length === 4;
      const y = Number(firstIsYear ? ymNum[1] : ymNum[2]);
      const m = Number(firstIsYear ? ymNum[2] : ymNum[1]) - 1;
      if (m >= 0 && m <= 11) {
        const monthStart = new Date(y, m, 1).getTime();
        const isFuture = monthStart > todayStart;
        return {
          isUnreleased: isFuture,
          reason: isFuture ? "future_date" : "released_date",
          formattedDate: formatNiceDate(y, m, 0)
        };
      }
    }

    // 9. Quarter + Year (e.g. "Q1 2027")
    const qMatch = rawText.match(/\bQ([1-4])\s*(20\d{2})\b/i);
    if (qMatch) {
      const q = Number(qMatch[1]);
      const y = Number(qMatch[2]);
      const qStart = new Date(y, (q - 1) * 3, 1).getTime();
      const isFuture = qStart > todayStart;
      return {
        isUnreleased: isFuture,
        reason: isFuture ? "future_date" : "released_date",
        formattedDate: `Q${q} ${y}`
      };
    }

    // 10. Bare 4-digit Year (e.g. "2027")
    const yOnly = rawText.match(/^\s*(20\d{2})\s*$/);
    if (yOnly) {
      const y = Number(yOnly[1]);
      const isFuture = y > now.getFullYear();
      return {
        isUnreleased: isFuture,
        reason: isFuture ? "future_date" : "released_date",
        formattedDate: String(y)
      };
    }

    return { isUnreleased: false, reason: "released_text", formattedDate: rawText };
  }

  /**
   * Computes exact Buy button visibility and active state for a game record.
   */
  function evaluateBuyButtonState(game, nowRef) {
    const g = game && typeof game === "object" ? game : {};
    const itchHref = normalizeItchBuyUrl(g.itchUrl || g.buyUrl || "");
    const schedule = analyzeReleaseSchedule(
      g.releaseDate,
      g.releaseStatus,
      g.releaseDateIso,
      nowRef
    );
    const manuallyEnabled = g.buyButtonEnabled !== false;
    const disabledMode = g.disabledButtonMode === "locked" ? "locked" : "hidden";
    const buyLabel = String(g.buyButtonText || "Buy on itch.io ↗").trim() || "Buy on itch.io ↗";

    const isActive = Boolean(manuallyEnabled && !schedule.isUnreleased && itchHref);

    let customDisabled = String(g.disabledButtonText || "").trim();
    if (!customDisabled) {
      if (schedule.isUnreleased && schedule.formattedDate) {
        customDisabled = `Coming Soon • ${schedule.formattedDate}`;
      } else {
        customDisabled = "Coming Soon";
      }
    }

    let lockReason = "active";
    if (!manuallyEnabled) {
      lockReason = "disabled_by_owner";
    } else if (schedule.isUnreleased) {
      lockReason = schedule.reason || "coming_soon";
    } else if (!itchHref) {
      lockReason = "missing_itch_url";
    }

    return {
      isActive,
      renderMode: isActive ? "active" : disabledMode,
      itchHref: isActive ? itchHref : "",
      buyLabel,
      disabledLabel: customDisabled,
      lockReason,
      schedule
    };
  }

  function isBuyButtonActive(game, nowRef) {
    return evaluateBuyButtonState(game, nowRef).isActive;
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
    const releaseDate = String(obj.releaseDate || obj.comingSoonLabel || "").trim();
    const releaseDateIso = String(obj.releaseDateIso || "").trim();
    const rawStatus = String(obj.releaseStatus || "").trim().toLowerCase();
    const releaseStatus =
      rawStatus === "coming_soon" || rawStatus === "released" ? rawStatus : "";

    const buyButtonEnabled =
      typeof obj.buyButtonEnabled === "boolean"
        ? obj.buyButtonEnabled
        : String(obj.buyButtonState || "").toLowerCase() !== "disabled";

    const disabledButtonMode =
      String(obj.disabledButtonMode || "").toLowerCase() === "locked"
        ? "locked"
        : "hidden";

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
      releaseDate,
      releaseDateIso,
      releaseStatus,
      platform: String(obj.platform || "Windows PC (64-bit)").trim(),
      modes: String(obj.modes || "").trim(),
      version: String(obj.version || "").trim(),
      coverImageUrl: normalizePublicCoverUrl(obj.coverImageUrl),
      itchUrl,
      buyButtonEnabled,
      disabledButtonMode,
      buyButtonText: String(obj.buyButtonText || "Buy on itch.io ↗").trim(),
      disabledButtonText: String(obj.disabledButtonText || "").trim(),
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
        const dayKey = new Date().toDateString();
        let sig = "";
        try {
          sig = JSON.stringify({ loaded, dayKey, games: latestGames });
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
    analyzeReleaseSchedule,
    evaluateBuyButtonState,
    isBuyButtonActive,
    subscribePublicStore
  };
})();
