/**
 * ============================================================================
 * DREVALITH GAMES™ — PUBLIC STORE, PLAYER AUTH, PURCHASES & UPDATES UI (v5)
 * ============================================================================
 * Preserves 100% of original Drevalith Games™ HTML/CSS/animations untouched
 * while adding:
 *   - Player Sign Up (with real Email Verification Link before account creation)
 *   - Player Sign In + Password Reset
 *   - My Purchases Library (permanent cloud access + 1-click Update File downloads!)
 *   - Streaming .ZIP download buttons (up to 500 MB + Google Drive, zero permission errors)
 * ============================================================================
 */

(function () {
  const Store = window.DrevalithStore;
  if (!Store) return;

  let currentStoreState = {
    settings: { showDefaultComingSoon: true },
    games: []
  };

  let playerAuthState = {
    user: null,
    dbProfile: null,
    pendingVerificationEmail: "",
    cooldownSec: 0,
    purchases: {}
  };

  let activeAuthTab = "login"; // "login" | "signup" | "verify"
  let pendingCheckoutGameId = "";
  let wasWaitingForEmailVerify = false;
  let editingProfileNameInline = false;
  let verifyCooldownTicker = null;

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatParagraphs(text) {
    const lines = String(text || "")
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) return "<p>Official release from Drevalith Games™.</p>";
    return lines.map((p) => `<p>${esc(p)}</p>`).join("");
  }

  function injectStoreStyles() {
    if (document.getElementById("drevalith-store-styles")) return;
    const style = document.createElement("style");
    style.id = "drevalith-store-styles";
    style.textContent = `
      .btn-download-unlocked {
        position: relative;
        overflow: hidden;
        background: linear-gradient(135deg, #16a34a 0%, #0d7a35 100%);
        color: #ffffff;
        text-decoration: none;
        padding: 0.94rem 1.85rem;
        border-radius: 8px;
        font-weight: 800;
        font-size: 0.88rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border: 1px solid rgba(74, 222, 128, 0.45);
        box-shadow: 0 8px 28px rgba(22, 163, 74, 0.45);
        transition: transform 0.25s ease, box-shadow 0.25s ease;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        font-family: inherit;
      }
      .btn-download-unlocked:hover:not(:disabled) {
        transform: translateY(-3px) scale(1.02);
        box-shadow: 0 12px 34px rgba(22, 163, 74, 0.68);
      }
      .btn-download-unlocked:disabled {
        opacity: 0.8;
        cursor: wait;
      }
      .btn-download-update {
        position: relative;
        overflow: hidden;
        background: linear-gradient(135deg, #f59e0b 0%, #ea580c 100%);
        color: #ffffff;
        padding: 0.94rem 1.85rem;
        border-radius: 8px;
        font-weight: 900;
        font-size: 0.88rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border: 1px solid rgba(251, 191, 36, 0.65);
        box-shadow: 0 8px 30px rgba(234, 88, 12, 0.5);
        transition: transform 0.25s ease, box-shadow 0.25s ease;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.6rem;
        font-family: inherit;
      }
      .btn-download-update:hover:not(:disabled) {
        transform: translateY(-3px) scale(1.02);
        box-shadow: 0 14px 36px rgba(234, 88, 12, 0.72);
      }
      .btn-key-trigger {
        background: rgba(242, 53, 25, 0.09);
        color: #ff9887;
        padding: 0.92rem 1.45rem;
        border-radius: 8px;
        font-weight: 800;
        font-size: 0.85rem;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        border: 1px solid rgba(242, 53, 25, 0.38);
        transition: all 0.25s ease;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        font-family: inherit;
      }
      .btn-key-trigger:hover {
        background: rgba(242, 53, 25, 0.2);
        color: #fff;
        border-color: var(--accent);
        transform: translateY(-2px);
      }
      .unlock-status-strip {
        margin-top: 0.95rem;
        padding: 0.72rem 1rem;
        border-radius: 9px;
        font-size: 0.83rem;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 0.65rem;
        background: rgba(255, 255, 255, 0.03);
        border: 1px solid var(--border);
        color: var(--text-muted);
      }
      .unlock-status-strip.verified {
        background: rgba(22, 163, 74, 0.12);
        border-color: rgba(74, 222, 128, 0.4);
        color: #bbf7d0;
      }
      .unlock-status-strip.update-ready {
        background: rgba(245, 158, 11, 0.14);
        border-color: rgba(251, 191, 36, 0.52);
        color: #fde68a;
      }
      .link-subtle-btn {
        background: none;
        border: none;
        color: #ff806c;
        font-size: 0.8rem;
        font-weight: 700;
        text-decoration: underline;
        cursor: pointer;
        font-family: inherit;
        padding: 0;
      }
      .link-subtle-btn:hover { color: #ffffff; }
      .price-pill-highlight {
        display: inline-flex;
        align-items: center;
        gap: 0.4rem;
        padding: 0.34rem 0.85rem;
        border-radius: 999px;
        background: rgba(242, 53, 25, 0.16);
        border: 1px solid rgba(242, 53, 25, 0.5);
        color: #fff;
        font-weight: 900;
        font-size: 0.82rem;
        letter-spacing: 0.08em;
      }
      .price-pill-highlight.free {
        background: rgba(22, 163, 74, 0.18);
        border-color: rgba(74, 222, 128, 0.5);
        color: #86efac;
      }
      .price-pill-highlight.coming-soon {
        background: rgba(245, 158, 11, 0.18);
        border-color: rgba(251, 191, 36, 0.58);
        color: #fde68a;
      }
      .nav-update-dot {
        display: inline-block;
        padding: 0.12rem 0.48rem;
        margin-left: 0.35rem;
        border-radius: 999px;
        background: #f59e0b;
        color: #090c14;
        font-size: 0.66rem;
        font-weight: 900;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        vertical-align: middle;
      }

      /* Player Account & Purchases Page */
      .drev-account-shell {
        max-width: 1080px;
        margin: 0 auto;
        padding: 2.2rem 1.25rem 4rem 1.25rem;
      }
      .drev-auth-card {
        max-width: 490px;
        margin: 1rem auto;
        background: linear-gradient(145deg, rgba(18, 23, 38, 0.95) 0%, rgba(9, 12, 20, 0.98) 100%);
        border: 1px solid rgba(242, 53, 25, 0.42);
        border-radius: 18px;
        padding: 2rem;
        box-shadow: 0 24px 65px rgba(0, 0, 0, 0.78);
      }
      .drev-auth-tabs {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 0.5rem;
        padding: 0.35rem;
        border-radius: 11px;
        background: rgba(255, 255, 255, 0.04);
        border: 1px solid var(--border);
        margin-bottom: 1.35rem;
      }
      .drev-auth-tab {
        padding: 0.68rem 0.8rem;
        border-radius: 8px;
        border: none;
        background: transparent;
        color: var(--text-muted);
        font-weight: 800;
        font-size: 0.83rem;
        text-transform: uppercase;
        letter-spacing: 0.07em;
        cursor: pointer;
        font-family: inherit;
        transition: all 0.2s ease;
      }
      .drev-auth-tab.active {
        background: var(--accent);
        color: #fff;
        box-shadow: 0 6px 18px rgba(242, 53, 25, 0.38);
      }
      .drev-purchase-card {
        display: grid;
        grid-template-columns: 200px 1fr;
        gap: 1.5rem;
        padding: 1.45rem;
        border-radius: 16px;
        background: linear-gradient(145deg, rgba(17, 22, 35, 0.92), rgba(9, 12, 20, 0.96));
        border: 1px solid var(--border);
        margin-bottom: 1.15rem;
        align-items: center;
      }
      .drev-purchase-card.has-update {
        border-color: rgba(251, 191, 36, 0.62);
        box-shadow: 0 12px 38px rgba(234, 88, 12, 0.18);
      }
      .drev-purchase-cover {
        width: 100%;
        height: 135px;
        object-fit: cover;
        border-radius: 11px;
        border: 1px solid rgba(255, 255, 255, 0.12);
      }
      @media (max-width: 720px) {
        .drev-purchase-card {
          grid-template-columns: 1fr;
        }
        .drev-purchase-cover {
          height: 185px;
        }
      }

      /* Modals */
      .drev-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 999;
        background: rgba(4, 6, 10, 0.84);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        display: none;
        align-items: center;
        justify-content: center;
        padding: 1.2rem;
      }
      .drev-modal-backdrop.open {
        display: flex;
        animation: fadeIn 0.22s ease;
      }
      .drev-modal-box {
        width: 100%;
        max-width: 470px;
        background: linear-gradient(145deg, #121726 0%, #090c14 100%);
        border: 1px solid rgba(242, 53, 25, 0.48);
        border-radius: 16px;
        padding: 1.85rem;
        box-shadow: 0 26px 70px rgba(0, 0, 0, 0.85), 0 0 40px rgba(242, 53, 25, 0.14);
        position: relative;
        color: var(--text-main);
      }
      .drev-modal-close {
        position: absolute;
        top: 1rem;
        right: 1rem;
        width: 34px;
        height: 34px;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.05);
        color: var(--text-muted);
        font-size: 1.1rem;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .drev-modal-close:hover {
        color: #fff;
        border-color: var(--accent);
      }
      .drev-field { margin-bottom: 1rem; }
      .drev-field label {
        display: block;
        font-size: 0.76rem;
        font-weight: 800;
        text-transform: uppercase;
        letter-spacing: 0.1em;
        color: var(--text-muted);
        margin-bottom: 0.42rem;
      }
      .drev-input {
        width: 100%;
        padding: 0.82rem 1rem;
        border-radius: 9px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(5, 7, 12, 0.85);
        color: #fff;
        font-size: 0.96rem;
        font-family: inherit;
        outline: none;
        transition: border-color 0.2s ease, box-shadow 0.2s ease;
      }
      .drev-input:focus {
        border-color: var(--accent);
        box-shadow: 0 0 0 3px rgba(242, 53, 25, 0.18);
      }
      .drev-key-input {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: 1.08rem;
        font-weight: 800;
        letter-spacing: 0.12em;
        text-align: center;
        text-transform: uppercase;
      }
      .drev-alert {
        padding: 0.75rem 0.95rem;
        border-radius: 8px;
        font-size: 0.85rem;
        margin-bottom: 1rem;
        display: none;
        line-height: 1.45;
      }
      .drev-alert.error {
        display: block;
        background: rgba(239, 68, 68, 0.14);
        border: 1px solid rgba(239, 68, 68, 0.45);
        color: #fca5a5;
      }
      .drev-alert.success {
        display: block;
        background: rgba(22, 163, 74, 0.16);
        border: 1px solid rgba(74, 222, 128, 0.45);
        color: #bbf7d0;
      }
      .drev-alert.info {
        display: block;
        background: rgba(245, 158, 11, 0.14);
        border: 1px solid rgba(251, 191, 36, 0.45);
        color: #fde68a;
      }
      .rzp-sim-header {
        background: linear-gradient(135deg, #f23519 0%, #b91c08 100%);
        margin: -1.85rem -1.85rem 1.3rem -1.85rem;
        padding: 1.35rem 1.65rem;
        border-radius: 15px 15px 0 0;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .rzp-method-grid {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 0.5rem;
        margin-bottom: 1rem;
      }
      .rzp-method-chip {
        padding: 0.55rem 0.5rem;
        border-radius: 8px;
        border: 1px solid var(--border);
        background: rgba(255, 255, 255, 0.04);
        color: var(--text-muted);
        font-size: 0.78rem;
        font-weight: 700;
        text-align: center;
        cursor: pointer;
      }
      .rzp-method-chip.active {
        border-color: var(--accent);
        background: rgba(242, 53, 25, 0.16);
        color: #fff;
      }
      .drev-toast {
        position: fixed;
        bottom: 1.5rem;
        right: 1.5rem;
        z-index: 1100;
        max-width: 400px;
        padding: 0.95rem 1.25rem;
        border-radius: 11px;
        background: #121827;
        border: 1px solid rgba(242, 53, 25, 0.55);
        color: #fff;
        font-size: 0.88rem;
        box-shadow: 0 16px 40px rgba(0, 0, 0, 0.75);
        transform: translateY(20px);
        opacity: 0;
        pointer-events: none;
        transition: all 0.28s ease;
      }
      .drev-toast.show {
        transform: translateY(0);
        opacity: 1;
      }
    `;
    document.head.appendChild(style);
  }

  // --------------------------------------------------------------------------
  // Inject Navbar Button & #page-account View Without Touching Original HTML!
  // --------------------------------------------------------------------------
  function ensurePlayerAccountPageAndNav() {
    const nav = document.querySelector("header nav");
    if (nav && !document.getElementById("drev-nav-account-btn")) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.id = "drev-nav-account-btn";
      btn.className = "nav-btn";
      btn.setAttribute("data-target", "account");
      btn.textContent = "Sign In / Purchases";
      btn.onclick = () => window.switchPage("account");
      const itchBtn = nav.querySelector(".itch-link-btn");
      if (itchBtn) nav.insertBefore(btn, itchBtn);
      else nav.appendChild(btn);
    }

    const mainEl = document.querySelector("main");
    if (mainEl && !document.getElementById("page-account")) {
      const sec = document.createElement("div");
      sec.id = "page-account";
      sec.className = "page-view";
      sec.innerHTML = `<div class="drev-account-shell" id="drev-account-mount"></div>`;
      mainEl.appendChild(sec);
    }

    // Extend switchPage cleanly so 'account' works alongside 'home', 'games', 'studio'
    if (typeof window.switchPage === "function" && !window.__drevWrappedSwitchPage) {
      const origSwitch = window.switchPage;
      window.__drevWrappedSwitchPage = true;
      window.switchPage = function (target, pushHash = true) {
        const accountPage = document.getElementById("page-account");
        const navBtn = document.getElementById("drev-nav-account-btn");
        if (target === "account" || target === "purchases") {
          document.querySelectorAll(".page-view").forEach((el) => {
            el.classList.toggle("active", el.id === "page-account");
          });
          document.querySelectorAll(".nav-btn").forEach((b) => {
            b.classList.toggle("active", b.getAttribute("data-target") === "account");
          });
          window.scrollTo({ top: 0, behavior: "smooth" });
          if (pushHash) history.replaceState(null, "", "#account");
          if (playerAuthState.user && typeof Store.fetchPlayerProfileFromDb === "function") {
            Store.fetchPlayerProfileFromDb().catch(() => {});
          }
          renderAccountAndPurchasesPage();
          return;
        }
        if (accountPage) accountPage.classList.remove("active");
        if (navBtn) navBtn.classList.remove("active");
        origSwitch(target, pushHash);
      };
    }
  }

  function countAvailableUpdates() {
    if (!playerAuthState.user) return 0;
    const purchases = playerAuthState.purchases || {};
    const games = currentStoreState.games || [];
    let count = 0;
    for (const gid of Object.keys(purchases)) {
      const g = games.find((x) => x.id === gid);
      if (g && Store.hasGameUpdateAvailable(g, purchases[gid])) count += 1;
    }
    return count;
  }

  function updateNavbarAccountLabel() {
    const btn = document.getElementById("drev-nav-account-btn");
    if (!btn) return;
    if (playerAuthState.user) {
      const profName =
        (playerAuthState.dbProfile && playerAuthState.dbProfile.name) ||
        playerAuthState.user.displayName ||
        "Profile";
      const updatesCount = countAvailableUpdates();
      btn.innerHTML =
        `👤 ${esc(profName)}` +
        (updatesCount > 0 ? `<span class="nav-update-dot">${updatesCount} Update</span>` : "");
    } else {
      btn.textContent = "Sign In / Purchases";
    }
  }

  function handlePostLoginContinuation() {
    renderAccountAndPurchasesPage();
    renderPublishedGames();
    if (pendingCheckoutGameId) {
      const gid = pendingCheckoutGameId;
      pendingCheckoutGameId = "";
      window.switchPage("games");
      setTimeout(() => startGamePayment(gid, null), 200);
    }
  }

  function renderAccountAndPurchasesPage() {
    const mount = document.getElementById("drev-account-mount");
    if (!mount) return;
    updateNavbarAccountLabel();

    // STATE A: SIGNED IN TO VERIFIED PLAYER ACCOUNT -> SHOW DB PROFILE + PURCHASES & UPDATES!
    if (playerAuthState.user) {
      const u = playerAuthState.user;
      const dbProf = playerAuthState.dbProfile || {};
      const profileName = dbProf.name || dbProf.displayName || u.displayName || "Player";
      const profileEmail = dbProf.email || u.email || "";
      const joinedDate = dbProf.createdAt
        ? new Date(dbProf.createdAt).toLocaleDateString()
        : "Verified Member";

      const purchasesMap = playerAuthState.purchases || {};
      const purchaseIds = Object.keys(purchasesMap).sort(
        (a, b) => (purchasesMap[b].purchasedAt || 0) - (purchasesMap[a].purchasedAt || 0)
      );
      const updatesCount = countAvailableUpdates();

      const cardsHtml = !purchaseIds.length
        ? `
          <div style="text-align:center;padding:3rem 1.5rem;border:1px dashed var(--border);border-radius:16px;background:rgba(255,255,255,0.02);">
            <div style="font-size:2.2rem;margin-bottom:0.65rem;">🎮</div>
            <h3 style="font-size:1.25rem;font-weight:900;text-transform:uppercase;margin-bottom:0.45rem;">No Purchased Games Yet</h3>
            <p style="color:var(--text-muted);font-size:0.9rem;max-width:460px;margin:0 auto 1.35rem auto;">
              Every game you buy (or unlock with a Studio Key) while signed in is permanently saved here — including free access to all future game updates!
            </p>
            <button type="button" class="btn-primary" style="border:none;cursor:pointer;" onclick="window.switchPage('games')">
              Explore Studio Games →
            </button>
          </div>
        `
        : purchaseIds
            .map((gid) => {
              const p = purchasesMap[gid];
              const liveGame = (currentStoreState.games || []).find((g) => g.id === gid);
              const title = (liveGame && liveGame.title) || p.gameTitle || "Drevalith Game";
              const cover = (liveGame && liveGame.coverImageUrl) || p.coverImageUrl || "";
              const liveVersion = (liveGame && liveGame.version) || p.purchasedVersion || "v1.0.0";
              const dlVersion = p.lastDownloadedVersion || p.purchasedVersion || "v1.0.0";
              const sizeLabel = (liveGame && liveGame.zipSizeFormatted) || "ZIP Archive";
              const hasUpdate = liveGame ? Store.hasGameUpdateAvailable(liveGame, p) : false;
              const patchNotes = liveGame && liveGame.updateNotes ? liveGame.updateNotes : "";
              const dateStr = p.purchasedAt
                ? new Date(p.purchasedAt).toLocaleDateString()
                : "Verified";

              return `
                <div class="drev-purchase-card ${hasUpdate ? "has-update" : ""}">
                  <div>
                    ${
                      cover
                        ? `<img src="${esc(cover)}" alt="${esc(title)}" class="drev-purchase-cover" />`
                        : `<div class="drev-purchase-cover" style="display:flex;align-items:center;justify-content:center;background:#111827;color:var(--text-muted);font-weight:800;">DREVALITH</div>`
                    }
                  </div>
                  <div>
                    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.55rem;margin-bottom:0.45rem;">
                      <span class="price-pill-highlight free" style="font-size:0.72rem;padding:0.22rem 0.65rem;">
                        ✔ Purchased &amp; Owned
                      </span>
                      <span style="font-size:0.78rem;color:var(--text-muted);">
                        Latest Build: <strong style="color:#fff;">${esc(liveVersion)}</strong>
                      </span>
                      ${
                        hasUpdate
                          ? `<span style="padding:0.24rem 0.72rem;border-radius:999px;background:rgba(245,158,11,0.22);border:1px solid rgba(251,191,36,0.7);color:#fde68a;font-size:0.73rem;font-weight:900;text-transform:uppercase;letter-spacing:0.06em;">
                               🔥 New Update Available (${esc(dlVersion)} → ${esc(liveVersion)})
                             </span>`
                          : `<span style="font-size:0.76rem;color:#86efac;font-weight:700;">● Up to Date</span>`
                      }
                    </div>

                    <h3 style="font-size:1.4rem;font-weight:900;text-transform:uppercase;margin-bottom:0.3rem;">${esc(title)}</h3>
                    <div style="font-size:0.82rem;color:var(--text-muted);margin-bottom:0.75rem;">
                      Purchased: ${esc(dateStr)}
                      ${p.paymentId ? ` &nbsp;•&nbsp; Receipt: <code>${esc(p.paymentId)}</code>` : " &nbsp;•&nbsp; Unlocked via Studio Key"}
                      &nbsp;•&nbsp; Package: <strong>${esc(sizeLabel)}</strong>
                    </div>

                    ${
                      hasUpdate && patchNotes
                        ? `<div style="margin-bottom:0.9rem;padding:0.7rem 0.95rem;border-radius:9px;background:rgba(245,158,11,0.1);border:1px solid rgba(251,191,36,0.35);font-size:0.83rem;color:#fef3c7;">
                             <strong>Update Notes (${esc(liveVersion)}):</strong> ${esc(patchNotes)}
                           </div>`
                        : ""
                    }

                    <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
                      ${
                        hasUpdate
                          ? `<button type="button" class="btn-download-update" onclick="window.DrevalithPublicUI.download('${esc(gid)}', this, true)">
                               <span>🔄</span>
                               <span>Download Update File (${esc(liveVersion)} .ZIP)</span>
                             </button>`
                          : ""
                      }
                      <button type="button" class="btn-download-unlocked" onclick="window.DrevalithPublicUI.download('${esc(gid)}', this, false)">
                        <span>⬇</span>
                        <span>${hasUpdate ? "Download Full Latest Build (.ZIP)" : `Download Game (${esc(liveVersion)} .ZIP)`}</span>
                      </button>
                    </div>
                  </div>
                </div>
              `;
            })
            .join("");

      if (verifyCooldownTicker) {
        clearInterval(verifyCooldownTicker);
        verifyCooldownTicker = null;
      }

      mount.innerHTML = `
        ${
          dbProf.dbRulesWarning
            ? `<div class="drev-alert error" style="display:block;margin-bottom:1.1rem;">
                 ⚠️ <strong>Firebase /users Rules Need 1-Click Publish:</strong> Open your Owner Console → click <strong>"📋 Copy Firebase Rules For My Gmail"</strong> → paste in Firebase Console → Realtime Database → Rules → click <strong>Publish</strong> so player profiles &amp; purchases sync to <code>/users</code>!
               </div>`
            : ""
        }
        <!-- PLAYER PROFILE CARD (FETCHED DIRECTLY FROM FIREBASE /users/{uid}/profile) -->
        <div style="padding:1.75rem 1.95rem;border-radius:16px;background:linear-gradient(145deg,rgba(18,24,39,0.96),rgba(9,12,20,0.98));border:1px solid rgba(242,53,25,0.45);margin-bottom:2.1rem;box-shadow:0 18px 50px rgba(0,0,0,0.62);">
          <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-start;gap:1.25rem;">
            <div style="flex:1;min-width:260px;">
              <span class="section-tag" style="margin-bottom:0.25rem;">Player Profile // Fetched Directly From Firebase Database</span>
              <h2 style="font-size:1.8rem;font-weight:900;text-transform:uppercase;margin:0.15rem 0 1rem 0;">
                👤 ${esc(profileName)}
              </h2>

              <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:1rem 2rem;padding:1.1rem 1.25rem;border-radius:12px;background:rgba(255,255,255,0.03);border:1px solid var(--border);">
                <div>
                  <span style="display:block;font-size:0.72rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.25rem;">Full Name (From Database)</span>
                  ${
                    editingProfileNameInline
                      ? `<form onsubmit="window.DrevalithPublicUI.saveProfileNameInline(event)" style="display:flex;gap:0.45rem;align-items:center;margin-top:0.2rem;">
                           <input type="text" id="drev-inline-name-input" class="drev-input" style="padding:0.42rem 0.65rem;font-size:0.88rem;" value="${esc(profileName)}" required />
                           <button type="submit" class="btn-primary" style="padding:0.42rem 0.85rem;font-size:0.78rem;border:none;cursor:pointer;">Save</button>
                           <button type="button" class="link-subtle-btn" style="font-size:0.76rem;" onclick="window.DrevalithPublicUI.toggleEditName(false)">Cancel</button>
                         </form>`
                      : `<div style="display:flex;align-items:center;gap:0.6rem;">
                           <strong style="color:#fff;font-size:1.05rem;">${esc(profileName)}</strong>
                           <button type="button" class="link-subtle-btn" style="font-size:0.76rem;" onclick="window.DrevalithPublicUI.toggleEditName(true)">✏️ Edit</button>
                         </div>`
                  }
                </div>

                <div>
                  <span style="display:block;font-size:0.72rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.25rem;">Email Address (From Database)</span>
                  <strong style="color:#fff;font-size:1.05rem;word-break:break-all;">${esc(profileEmail)}</strong>
                </div>

                <div>
                  <span style="display:block;font-size:0.72rem;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.25rem;">Account &amp; Database Status</span>
                  <span style="color:#4ade80;font-weight:800;">✔ Verified</span>
                  <span style="color:var(--text-muted);font-size:0.82rem;"> • ${
                    dbProf.fetchedFromDatabase !== false ? "Synced Live (/users)" : "Local Preview"
                  } • ${esc(joinedDate)}</span>
                </div>
              </div>
            </div>

            <div style="display:flex;gap:0.7rem;align-items:center;flex-wrap:wrap;">
              <button type="button" class="btn-secondary" onclick="window.switchPage('games')">Browse Store</button>
              <button type="button" class="btn-secondary" style="border-color:rgba(239,68,68,0.45);color:#fca5a5;" onclick="window.DrevalithPublicUI.logoutPlayer()">
                Sign Out
              </button>
            </div>
          </div>
        </div>

        <div style="margin-bottom:1.15rem;">
          <span class="section-tag">Cloud Purchase Library</span>
          <h3 style="font-size:1.5rem;font-weight:900;text-transform:uppercase;margin-top:0.15rem;">My Purchased Games &amp; Updates (${purchaseIds.length})</h3>
        </div>

        ${
          updatesCount > 0
            ? `<div class="drev-alert info" style="display:block;margin-bottom:1.35rem;">
                 🔥 <strong>${updatesCount} Game Update${updatesCount > 1 ? "s" : ""} Ready!</strong> Click <strong>"Download Update File"</strong> below to download the latest updated build for free.
               </div>`
            : ""
        }

        <div>${cardsHtml}</div>
      `;
      return;
    }

    // STATE B: LIVE AUTO-VERIFICATION WATCHER (NO "I CLICKED LINK" BUTTON — REDIRECTS AUTOMATICALLY!)
    if (activeAuthTab === "verify" || playerAuthState.pendingVerificationEmail) {
      activeAuthTab = "verify";
      wasWaitingForEmailVerify = true;
      const targetEmail = playerAuthState.pendingVerificationEmail || "your email";
      const initWaitSec = Number(playerAuthState.cooldownSec || 0);

      mount.innerHTML = `
        <div class="drev-auth-card" style="text-align:center;">
          <span class="section-tag">Check Your Email Inbox</span>
          <h2 style="font-size:1.55rem;font-weight:900;text-transform:uppercase;margin:0.35rem 0 0.65rem 0;">
            📧 Verify Your Email Link
          </h2>
          <p style="color:var(--text-muted);font-size:0.91rem;line-height:1.55;margin-bottom:1.15rem;">
            We sent a verification link to <strong style="color:#fff;">${esc(targetEmail)}</strong>.<br/>
            <span style="font-size:0.82rem;">(Check your <strong>Inbox</strong> AND your <strong>Spam / Promotions</strong> folder for an email from Firebase.)</span>
          </p>

          <div id="drev-auth-alert" class="drev-alert info" style="display:block;text-align:left;">
            📡 <strong>Auto-Detecting Verification Live...</strong><br/>
            Open the email and click the verification link inside — the instant your email is verified, this page will <strong>automatically log you into your Account &amp; Profile</strong>!
          </div>

          <div style="display:flex;justify-content:center;gap:1.25rem;flex-wrap:wrap;margin-top:1.25rem;">
            <button type="button" id="drev-resend-verify-btn" class="link-subtle-btn" ${
              initWaitSec > 0 ? "disabled style='opacity:0.55;cursor:not-allowed;'" : ""
            } onclick="window.DrevalithPublicUI.resendVerify(this)">
              ${initWaitSec > 0 ? `🔁 Resend Available in ${initWaitSec}s` : "🔁 Resend Verification Email"}
            </button>
            <button type="button" class="link-subtle-btn" style="color:var(--text-muted);" onclick="window.DrevalithPublicUI.switchAuthTab('login')">
              ← Use Another Email / Sign In
            </button>
          </div>
        </div>
      `;

      if (verifyCooldownTicker) clearInterval(verifyCooldownTicker);
      if (initWaitSec > 0) {
        let rem = initWaitSec;
        verifyCooldownTicker = setInterval(() => {
          rem -= 1;
          const b = document.getElementById("drev-resend-verify-btn");
          if (!b) {
            clearInterval(verifyCooldownTicker);
            verifyCooldownTicker = null;
            return;
          }
          if (rem <= 0) {
            clearInterval(verifyCooldownTicker);
            verifyCooldownTicker = null;
            b.disabled = false;
            b.style.opacity = "1";
            b.style.cursor = "pointer";
            b.textContent = "🔁 Resend Verification Email";
          } else {
            b.textContent = `🔁 Resend Available in ${rem}s`;
          }
        }, 1000);
      }
      return;
    }

    if (verifyCooldownTicker) {
      clearInterval(verifyCooldownTicker);
      verifyCooldownTicker = null;
    }

    // STATE C: LOGGED OUT -> SIGN IN OR SIGN UP FORM
    const isSignup = activeAuthTab === "signup";
    mount.innerHTML = `
      <div class="drev-auth-card">
        <span class="section-tag">Drevalith Player Account // Cloud Library</span>
        <h2 style="font-size:1.6rem;font-weight:900;text-transform:uppercase;margin:0.25rem 0 0.45rem 0;">
          ${isSignup ? "Create Player Account" : "Player Sign In"}
        </h2>
        <p style="color:var(--text-muted);font-size:0.87rem;margin-bottom:1.2rem;">
          ${
            pendingCheckoutGameId
              ? "Sign in or create your verified account first so your purchase &amp; all future game updates are permanently saved to <strong>My Purchases</strong>!"
              : "Access your profile, purchased games, and free game updates anytime."
          }
        </p>

        <div class="drev-auth-tabs">
          <button type="button" class="drev-auth-tab ${!isSignup ? "active" : ""}" onclick="window.DrevalithPublicUI.switchAuthTab('login')">
            🔐 Sign In
          </button>
          <button type="button" class="drev-auth-tab ${isSignup ? "active" : ""}" onclick="window.DrevalithPublicUI.switchAuthTab('signup')">
            ✉️ Sign Up
          </button>
        </div>

        <div id="drev-auth-alert" class="drev-alert"></div>

        ${
          isSignup
            ? `
          <form onsubmit="window.DrevalithPublicUI.submitSignup(event)">
            <div class="drev-field">
              <label for="drev-signup-name">Your Name *</label>
              <input type="text" id="drev-signup-name" class="drev-input" placeholder="Enter your full name or gamer tag" autocomplete="name" required />
            </div>
            <div class="drev-field">
              <label for="drev-signup-email">Email Address *</label>
              <input type="email" id="drev-signup-email" class="drev-input" placeholder="you@gmail.com" autocomplete="email" required />
            </div>
            <div class="drev-field">
              <label for="drev-signup-pass">Create Password (Min 6 Characters) *</label>
              <input type="password" id="drev-signup-pass" class="drev-input" placeholder="••••••••" minlength="6" autocomplete="new-password" required />
            </div>
            <div class="drev-field">
              <label for="drev-signup-pass2">Confirm Password *</label>
              <input type="password" id="drev-signup-pass2" class="drev-input" placeholder="••••••••" minlength="6" autocomplete="new-password" required />
            </div>
            <button type="submit" id="drev-signup-btn" class="btn-primary" style="width:100%;justify-content:center;display:flex;border:none;cursor:pointer;">
              📧 Sign Up &amp; Send Verification Email
            </button>
          </form>
        `
            : `
          <form onsubmit="window.DrevalithPublicUI.submitLogin(event)">
            <div class="drev-field">
              <label for="drev-login-email">Registered Email *</label>
              <input type="email" id="drev-login-email" class="drev-input" placeholder="you@gmail.com" autocomplete="email" required />
            </div>
            <div class="drev-field">
              <label for="drev-login-pass">Password *</label>
              <input type="password" id="drev-login-pass" class="drev-input" placeholder="••••••••" autocomplete="current-password" required />
            </div>
            <button type="submit" id="drev-login-btn" class="btn-primary" style="width:100%;justify-content:center;display:flex;border:none;cursor:pointer;">
              🔐 Sign In to Account
            </button>
            <div style="text-align:right;margin-top:0.75rem;">
              <button type="button" class="link-subtle-btn" onclick="window.DrevalithPublicUI.forgotPassword()">
                Forgot Password?
              </button>
            </div>
          </form>
        `
        }
      </div>
    `;
  }

  // --------------------------------------------------------------------------
  // Modals (Private Key, Restore, Sandbox Preview, Unlocked Confirmation)
  // --------------------------------------------------------------------------
  function ensureModals() {
    if (document.getElementById("drev-key-modal")) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <!-- PRIVATE KEY REDEEM MODAL -->
      <div class="drev-modal-backdrop" id="drev-key-modal">
        <div class="drev-modal-box">
          <button class="drev-modal-close" type="button" onclick="window.DrevalithPublicUI.closeModals()">✕</button>
          <span class="section-tag" style="margin-bottom:0.25rem;">Drevalith Games™ // Key Vault</span>
          <h3 style="font-size:1.35rem;font-weight:900;text-transform:uppercase;margin-bottom:0.35rem;">Redeem Private Key</h3>
          <p id="drev-key-game-label" style="color:var(--text-muted);font-size:0.88rem;margin-bottom:1.15rem;">
            Enter a valid Studio Private Key to unlock the full .ZIP game download for free ($0.00).
          </p>
          <div id="drev-key-alert" class="drev-alert"></div>
          <form id="drev-key-form">
            <input type="hidden" id="drev-key-game-id" />
            <div class="drev-field">
              <label for="drev-key-code">Private Access Key *</label>
              <input
                type="text"
                id="drev-key-code"
                class="drev-input drev-key-input"
                placeholder="DREV-XXXX-XXXX-XXXX"
                maxlength="24"
                autocomplete="off"
                required
              />
            </div>
            <div class="drev-field">
              <label for="drev-key-email">Your Name or Email (Optional)</label>
              <input type="text" id="drev-key-email" class="drev-input" placeholder="player@example.com" />
            </div>
            <button type="submit" id="drev-key-submit" class="btn-primary" style="width:100%;justify-content:center;display:flex;border:none;cursor:pointer;">
              🔑 Verify Key &amp; Unlock Free Download
            </button>
          </form>
        </div>
      </div>

      <!-- RAZORPAY SANDBOX PREVIEW CHECKOUT -->
      <div class="drev-modal-backdrop" id="drev-rzp-sandbox-modal">
        <div class="drev-modal-box">
          <div class="rzp-sim-header">
            <div>
              <div style="font-size:0.7rem;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;opacity:0.9;">
                Razorpay Checkout • Test Sandbox
              </div>
              <div id="rzp-sim-title" style="font-size:1.12rem;font-weight:900;color:#fff;margin-top:0.15rem;">
                Drevalith Games™
              </div>
            </div>
            <div style="text-align:right;">
              <div id="rzp-sim-amount" style="font-size:1.35rem;font-weight:900;color:#fff;">$0.00</div>
              <div style="font-size:0.7rem;opacity:0.85;">Exact Game Amount</div>
            </div>
          </div>

          <div style="padding:0.62rem 0.85rem;border-radius:8px;background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.38);color:#fcd34d;font-size:0.78rem;margin-bottom:1rem;">
            <strong>Sandbox Test Mode Active:</strong> Paste your free <code>rzp_test_...</code> or <code>rzp_live_...</code> key in <code>js/store-config.js</code> to switch automatically to live Razorpay Gateway.
          </div>

          <div class="drev-field">
            <label for="rzp-sim-email">Buyer Email *</label>
            <input type="email" id="rzp-sim-email" class="drev-input" value="player@drevalithgames.com" required />
          </div>

          <label style="display:block;font-size:0.75rem;font-weight:800;text-transform:uppercase;letter-spacing:0.1em;color:var(--text-muted);margin-bottom:0.4rem;">
            Payment Method
          </label>
          <div class="rzp-method-grid">
            <div class="rzp-method-chip active" onclick="window.DrevalithPublicUI.selectSimMethod(this)">💳 Card</div>
            <div class="rzp-method-chip" onclick="window.DrevalithPublicUI.selectSimMethod(this)">⚡ UPI / QR</div>
            <div class="rzp-method-chip" onclick="window.DrevalithPublicUI.selectSimMethod(this)">🏦 Netbanking</div>
          </div>

          <div style="display:grid;gap:0.65rem;margin-top:1.1rem;">
            <button type="button" id="rzp-sim-pay-btn" class="btn-primary" style="width:100%;justify-content:center;display:flex;border:none;cursor:pointer;">
              ✅ Complete Payment &amp; Unlock .ZIP
            </button>
            <button type="button" id="rzp-sim-fail-btn" class="btn-secondary" style="width:100%;text-align:center;">
              ✕ Cancel
            </button>
          </div>
        </div>
      </div>

      <!-- POST-UNLOCK DIRECT DOWNLOAD MODAL -->
      <div class="drev-modal-backdrop" id="drev-unlocked-modal">
        <div class="drev-modal-box" style="border-color:rgba(74,222,128,0.55);">
          <button class="drev-modal-close" type="button" onclick="window.DrevalithPublicUI.closeModals()">✕</button>
          <span class="section-tag" style="color:#4ade80;margin-bottom:0.25rem;">Access Granted // Saved to My Purchases</span>
          <h3 id="drev-unlocked-heading" style="font-size:1.4rem;font-weight:900;text-transform:uppercase;margin-bottom:0.45rem;">
            Game Download Unlocked!
          </h3>
          <p id="drev-unlocked-desc" style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1.25rem;"></p>
          <button type="button" id="drev-unlocked-dl-btn" class="btn-download-unlocked" style="width:100%;justify-content:center;margin-bottom:0.65rem;">
            ⬇ Download Game (.ZIP) Now
          </button>
          <button type="button" class="btn-secondary" style="width:100%;text-align:center;margin-bottom:0.65rem;" onclick="window.DrevalithPublicUI.closeModals();window.switchPage('account');">
            🎮 Open My Purchases Library
          </button>
          <p id="drev-unlocked-receipt" style="font-size:0.77rem;color:var(--text-muted);text-align:center;"></p>
        </div>
      </div>

      <div id="drev-toast" class="drev-toast"></div>
    `;
    document.body.appendChild(wrapper);

    const keyInput = document.getElementById("drev-key-code");
    keyInput.addEventListener("input", () => {
      keyInput.value = Store.formatPrivateKeyInput(keyInput.value);
    });

    document.getElementById("drev-key-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const gameId = document.getElementById("drev-key-game-id").value;
      const privateKey = document.getElementById("drev-key-code").value;
      const redeemerLabel = document.getElementById("drev-key-email").value.trim();
      const btn = document.getElementById("drev-key-submit");
      const alertBox = document.getElementById("drev-key-alert");
      const game = currentStoreState.games.find((g) => g.id === gameId);

      alertBox.className = "drev-alert";
      btn.disabled = true;
      btn.textContent = "Verifying Key...";

      try {
        const receipt = await Store.redeemPrivateKey({
          gameId,
          gameTitle: game ? game.title : "Game",
          privateKey,
          redeemerLabel
        });
        closeModals();
        renderPublishedGames();
        renderAccountAndPurchasesPage();
        openUnlockedModal(
          game,
          receipt,
          "Private Key Verified — Free Download Unlocked!",
          `Your Studio Key unlocked ${game ? game.title : "this game"} at $0.00.`
        );
      } catch (err) {
        alertBox.className = "drev-alert error";
        alertBox.textContent = err.message || "Invalid Private Key.";
      } finally {
        btn.disabled = false;
        btn.textContent = "🔑 Verify Key & Unlock Free Download";
      }
    });
  }

  let toastTimer = null;
  function showToast(msg) {
    const t = document.getElementById("drev-toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 4800);
  }

  function closeModals() {
    document.querySelectorAll(".drev-modal-backdrop").forEach((m) => m.classList.remove("open"));
  }

  function openKeyModal(gameId, prefillKey = "") {
    const game = currentStoreState.games.find((g) => g.id === gameId);
    document.getElementById("drev-key-game-id").value = gameId;
    document.getElementById("drev-key-code").value = prefillKey
      ? Store.formatPrivateKeyInput(prefillKey)
      : "";
    if (playerAuthState.user) {
      document.getElementById("drev-key-email").value = playerAuthState.user.email || "";
    }
    const alertBox = document.getElementById("drev-key-alert");
    alertBox.className = "drev-alert";
    alertBox.textContent = "";
    if (game) {
      document.getElementById("drev-key-game-label").innerHTML =
        `Enter a Studio Private Key for <strong>${esc(game.title)}</strong> to unlock free download ($0.00).`;
    }
    document.getElementById("drev-key-modal").classList.add("open");
    setTimeout(() => document.getElementById("drev-key-code").focus(), 60);
  }

  function openUnlockedModal(game, receipt, heading, description) {
    document.getElementById("drev-unlocked-heading").textContent = heading;
    document.getElementById("drev-unlocked-desc").textContent = description;
    const dlBtn = document.getElementById("drev-unlocked-dl-btn");
    dlBtn.textContent = `⬇ Download ${game ? game.zipFileName || "Game .ZIP" : "Game (.ZIP)"} (${
      game ? game.zipSizeFormatted || "ZIP" : "ZIP"
    })`;
    dlBtn.onclick = () => startStreamingDownload(game ? game.id : receipt.gameId, dlBtn, false);
    document.getElementById("drev-unlocked-receipt").textContent = receipt.paymentId
      ? `Verified Razorpay Payment ID: ${receipt.paymentId}`
      : `Unlocked via Verified Studio Private Key • $0.00 Charged`;
    document.getElementById("drev-unlocked-modal").classList.add("open");
  }

  async function startStreamingDownload(gameId, btnEl, isUpdate) {
    const origHtml = btnEl ? btnEl.innerHTML : "";
    if (btnEl) {
      btnEl.disabled = true;
      btnEl.innerHTML = `<span>⏳ Preparing Download...</span>`;
    }
    try {
      await Store.triggerVerifiedDownload(gameId, (pct) => {
        if (btnEl) {
          btnEl.innerHTML = `<span>⬇ Downloading ${isUpdate ? "Update" : "Build"}... ${pct}%</span>`;
        }
      });
      showToast("✅ Download started! Check your browser's Downloads bar.");
      renderPublishedGames();
      renderAccountAndPurchasesPage();
    } catch (err) {
      showToast(`❌ ${err.message || "Could not start download."}`);
    } finally {
      if (btnEl) {
        btnEl.disabled = false;
        btnEl.innerHTML = origHtml;
      }
    }
  }

  function switchDynamicTab(btnEl, gameId, tabKey) {
    const game = currentStoreState.games.find((g) => g.id === gameId);
    if (!game) return;
    const card = btnEl.closest(".release-banner");
    if (!card) return;
    card.querySelectorAll(".subtab-btn").forEach((b) => b.classList.remove("active"));
    btnEl.classList.add("active");

    const contentEl = document.getElementById(`dyn-tab-box-${gameId}`);
    if (!contentEl) return;
    contentEl.style.animation = "none";
    void contentEl.offsetWidth;
    contentEl.style.animation = "fadeIn 0.3s ease";

    if (tabKey === "gameplay" && game.gameplayText) {
      contentEl.innerHTML = formatParagraphs(game.gameplayText);
    } else if (tabKey === "features" && Array.isArray(game.featuresList) && game.featuresList.length) {
      contentEl.innerHTML = `<ul class="feature-list">${game.featuresList
        .map((item) => `<li>${esc(item)}</li>`)
        .join("")}</ul>`;
    } else {
      contentEl.innerHTML = formatParagraphs(game.description);
    }
  }

  // Require Verified Player Account before Paid Checkout so purchases & updates save permanently!
  async function startGamePayment(gameId, triggerBtn) {
    const game = currentStoreState.games.find((g) => g.id === gameId);
    if (!game) return;

    if (Store.isFirebaseConfigured() && !playerAuthState.user) {
      pendingCheckoutGameId = gameId;
      showToast("🔐 Please sign in or verify your email first so your purchase & future updates are saved!");
      window.switchPage("account");
      return;
    }

    const origLabel = triggerBtn ? triggerBtn.innerHTML : "";
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.innerHTML = `<span>⏳ Opening Razorpay...</span>`;
    }

    try {
      const orderData = await Store.createPaymentOrder(game);

      if ((orderData.mode === "live_razorpay" || orderData.mode === "live_razorpay_serverless") && orderData.keyId) {
        const Razorpay = await Store.loadRazorpayCheckoutScript();
        const cfg = window.DREVALITH_CONFIG || {};

        const rzpOpts = {
          key: orderData.keyId,
          amount: orderData.amount,
          currency: orderData.currency,
          name: cfg.STUDIO_NAME || "Drevalith Games™",
          description: `${game.title} — Official Full Game (.ZIP)`,
          prefill: {
            email: playerAuthState.user ? playerAuthState.user.email : ""
          },
          theme: {
            color: cfg.THEME_COLOR || "#f23519"
          },
          handler: async function (response) {
            try {
              showToast("Verifying payment & saving to My Purchases...");
              const receipt = await Store.verifyRazorpayPayment({
                gameId: game.id,
                gameTitle: game.title,
                amountPaid: game.price,
                currency: orderData.currency,
                buyerEmail: playerAuthState.user ? playerAuthState.user.email : "",
                razorpay_order_id: response.razorpay_order_id || "",
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature || ""
              });
              renderPublishedGames();
              renderAccountAndPurchasesPage();
              openUnlockedModal(
                game,
                receipt,
                "Payment Successful — Saved to My Purchases!",
                `Thank you! ${game.title} is now permanently unlocked in your account (including all future game updates).`
              );
            } catch (verifyErr) {
              showToast(`❌ ${verifyErr.message}`);
            }
          },
          modal: {
            ondismiss: function () {
              showToast("Payment cancelled.");
            }
          }
        };
        if (orderData.orderId) rzpOpts.order_id = orderData.orderId;

        const rzp = new Razorpay(rzpOpts);
        rzp.on("payment.failed", function (resp) {
          const reason = resp?.error?.description || "Payment was declined.";
          showToast(`❌ Payment failed: ${reason}`);
        });
        rzp.open();
        return;
      }

      openSandboxRazorpayModal(game, orderData);
    } catch (err) {
      showToast(`❌ ${err.message || "Could not start payment"}`);
    } finally {
      if (triggerBtn) {
        triggerBtn.disabled = false;
        triggerBtn.innerHTML = origLabel;
      }
    }
  }

  function openSandboxRazorpayModal(game, orderData) {
    const modal = document.getElementById("drev-rzp-sandbox-modal");
    document.getElementById("rzp-sim-title").textContent = game.title;
    document.getElementById("rzp-sim-amount").textContent = Store.formatCurrency(
      game.price,
      orderData.currency || game.currency
    );
    if (playerAuthState.user) {
      document.getElementById("rzp-sim-email").value = playerAuthState.user.email;
    }

    const payBtn = document.getElementById("rzp-sim-pay-btn");
    const failBtn = document.getElementById("rzp-sim-fail-btn");
    payBtn.textContent = `✅ Pay ${Store.formatCurrency(
      game.price,
      orderData.currency || game.currency
    )} & Unlock .ZIP`;

    payBtn.onclick = async () => {
      const buyerEmail = document.getElementById("rzp-sim-email").value.trim();
      payBtn.disabled = true;
      payBtn.textContent = "Verifying Payment...";
      try {
        const fakePayId = `pay_test_${Math.random().toString(36).slice(2, 12)}`;
        const receipt = await Store.verifyRazorpayPayment({
          gameId: game.id,
          gameTitle: game.title,
          amountPaid: game.price,
          currency: orderData.currency || game.currency,
          razorpay_order_id: orderData.orderId,
          razorpay_payment_id: fakePayId,
          razorpay_signature: "sandbox_verified",
          buyerEmail,
          sandboxSimulated: true
        });
        closeModals();
        renderPublishedGames();
        renderAccountAndPurchasesPage();
        openUnlockedModal(
          game,
          receipt,
          "Payment Successful — Saved to My Purchases!",
          `Verified ${Store.formatCurrency(game.price, game.currency)} payment for ${game.title}. Click below to download!`
        );
      } catch (e) {
        showToast(`❌ ${e.message}`);
      } finally {
        payBtn.disabled = false;
      }
    };

    failBtn.onclick = () => {
      closeModals();
      showToast("🔒 Payment cancelled.");
    };

    modal.classList.add("open");
  }

  function attachTiltToDynamicCards(container) {
    container.querySelectorAll(".tilt-card").forEach((card) => {
      if (card.dataset.tiltBound) return;
      card.dataset.tiltBound = "1";
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(900px) rotateY(${x * 5}deg) rotateX(${-y * 5}deg) translateY(-4px)`;
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg) translateY(0px)";
      });
    });
  }

  function renderPublishedGames() {
    const mount = document.getElementById("live-published-games");
    updateNavbarAccountLabel();
    if (!mount) return;

    const defaultBanner = document.getElementById("default-upcoming-banner");
    if (defaultBanner) {
      defaultBanner.remove();
    }

    const games = currentStoreState.games || [];
    if (!games.length) {
      mount.innerHTML = `
        <div class="release-banner tilt-card" style="display:block;text-align:center;padding:2.5rem 2rem;">
          <div class="badge" style="margin:0 auto 0.85rem auto;display:inline-flex;">
            <span class="badge-dot"></span>
            <span>Official Studio Catalog</span>
          </div>
          <h3 class="game-title" style="font-size:1.55rem;margin-bottom:0.5rem;">New Studio Releases Arriving Soon</h3>
          <p style="color:var(--text-muted);font-size:0.92rem;max-width:560px;margin:0 auto;">
            Official Paid, Free, and Coming Soon titles published from the Drevalith Games™ Console appear here automatically in real time.
          </p>
        </div>
      `;
      attachTiltToDynamicCards(mount);
      return;
    }

    mount.innerHTML = games
      .map((game) => {
        try {
          const isComingSoon = Boolean(game.isComingSoon || game.releaseStatus === "coming_soon");
          const isFree = !isComingSoon && (Boolean(game.isFree) || Number(game.price || 0) <= 0);
          const comingSoonLabel = String(game.comingSoonLabel || game.releaseDate || "To Be Announced").trim() || "To Be Announced";
          const unlock = !isComingSoon && !isFree ? Store.getUnlockForGame(game.id) : null;
          const purchaseRec = (playerAuthState.purchases || {})[game.id] || null;
          const hasUpdate = !isComingSoon && purchaseRec ? Store.hasGameUpdateAvailable(game, purchaseRec) : false;
          const hasGameplayTab = Boolean(game.gameplayText && game.gameplayText.trim());
          const hasFeaturesTab = Array.isArray(game.featuresList) && game.featuresList.length > 0;
          const showSubtabs = hasGameplayTab || hasFeaturesTab;

          const priceFormatted = isComingSoon
            ? "COMING SOON"
            : isFree
            ? "FREE DOWNLOAD"
            : Store.formatCurrency(game.price, game.currency);

          let actionButtonsHtml = "";
          let statusStripHtml = "";

          if (isComingSoon) {
            actionButtonsHtml = `
              <button type="button" class="btn-disabled" disabled>
                <span>⏳</span>
                <span>Coming Soon</span>
              </button>
              <button class="btn-secondary" onclick="window.switchPage('studio')">Studio Info →</button>
            `;
            statusStripHtml = `
              <div class="unlock-status-strip" style="background:rgba(245,158,11,0.12);border-color:rgba(251,191,36,0.45);color:#fde68a;">
                <span>⏳ <strong>Coming Soon (${esc(comingSoonLabel)}):</strong> Currently in active studio development — official store checkout &amp; download unlock at launch.</span>
              </div>
            `;
          } else if (isFree) {
            actionButtonsHtml = `
              <button type="button" class="btn-download-unlocked" onclick="window.DrevalithPublicUI.download('${esc(game.id)}', this, false)">
                <span>⬇</span>
                <span>Free Download .ZIP (${esc(game.zipSizeFormatted || "ZIP")})</span>
              </button>
              <button class="btn-secondary" onclick="window.switchPage('studio')">Studio Info →</button>
            `;
            statusStripHtml = `
              <div class="unlock-status-strip verified">
                <span>✅ <strong>Official Free Release</strong> — Instant .ZIP download unlocked for all players.</span>
              </div>
            `;
          } else if (unlock) {
            actionButtonsHtml = `
              ${
                hasUpdate
                  ? `<button type="button" class="btn-download-update" onclick="window.DrevalithPublicUI.download('${esc(game.id)}', this, true)">
                       <span>🔄</span>
                       <span>Download Update (${esc(game.version || "Latest")} .ZIP)</span>
                     </button>`
                  : ""
              }
              <button type="button" class="btn-download-unlocked" onclick="window.DrevalithPublicUI.download('${esc(game.id)}', this, false)">
                <span>⬇</span>
                <span>Download ${esc(game.zipFileName || "Game .ZIP")} (${esc(game.zipSizeFormatted || "ZIP")})</span>
              </button>
              <button class="btn-secondary" onclick="window.switchPage('account')">My Purchases →</button>
            `;
            statusStripHtml = hasUpdate
              ? `
                <div class="unlock-status-strip update-ready">
                  <span>🔥 <strong>New Update Available (${esc(game.version || "Latest")}):</strong> ${esc(game.updateNotes || "New game update uploaded — download free!")}</span>
                </div>
              `
              : `
                <div class="unlock-status-strip verified">
                  <span>✅ <strong>Purchased &amp; Unlocked</strong> — Full game package &amp; future updates unlocked in your library.</span>
                </div>
              `;
          } else {
            actionButtonsHtml = `
              <button type="button" class="btn-primary" style="border:none;cursor:pointer;" onclick="window.DrevalithPublicUI.pay('${esc(game.id)}', this)">
                💳 Buy &amp; Download — ${esc(priceFormatted)}
              </button>
              <button type="button" class="btn-key-trigger" onclick="window.DrevalithPublicUI.openKey('${esc(game.id)}')">
                🔑 Enter Private Key
              </button>
              <button type="button" class="btn-disabled" disabled>
                <span>🔒</span>
                <span>Download .ZIP Locked</span>
              </button>
            `;
            statusStripHtml = `
              <div class="unlock-status-strip">
                <span>🔒 <strong>Protected Build:</strong> Buy once (${esc(priceFormatted)}) to unlock instant download + lifetime game updates in <strong>My Purchases</strong>.</span>
                <button type="button" class="link-subtle-btn" onclick="window.switchPage('account')">
                  Already bought? Sign In
                </button>
              </div>
            `;
          }

          const coverSrc =
            game.coverImageUrl &&
            game.coverImageUrl.startsWith("/") &&
            window.DREVALITH_CONFIG &&
            window.DREVALITH_CONFIG.BACKEND_API_URL
              ? window.DREVALITH_CONFIG.BACKEND_API_URL.replace(/\/+$/, "") + game.coverImageUrl
              : game.coverImageUrl;

          const pillClass = isComingSoon ? "coming-soon" : isFree ? "free" : "";
          const badgeLabel = isComingSoon
            ? game.badgeText || "Upcoming Release"
            : game.badgeText || "Official Studio Release";

          return `
            <div class="release-banner tilt-card" data-game-id="${esc(game.id)}">
              <div>
                <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.6rem;margin-bottom:0.45rem;">
                  <div class="badge" style="margin-bottom:0;">
                    <span class="badge-dot"></span>
                    <span>${esc(badgeLabel)}</span>
                  </div>
                  <span class="price-pill-highlight ${pillClass}">
                    ${isComingSoon ? `⏳ ${esc(priceFormatted)}` : esc(priceFormatted)}
                  </span>
                </div>

                <h3 class="game-title">${esc(game.title)}</h3>
                <div class="game-subtitle">
                  ${esc(game.subtitle || game.modes || "Windows PC")}
                  ${!isComingSoon && game.version ? `&nbsp;•&nbsp; ${esc(game.version)}` : ""}
                </div>

                ${
                  showSubtabs
                    ? `
                  <div class="game-subtabs">
                    <button class="subtab-btn active" type="button" onclick="window.DrevalithPublicUI.tab(this, '${esc(game.id)}', 'overview')">Overview</button>
                    ${
                      hasGameplayTab
                        ? `<button class="subtab-btn" type="button" onclick="window.DrevalithPublicUI.tab(this, '${esc(game.id)}', 'gameplay')">Gameplay &amp; Survival</button>`
                        : ""
                    }
                    ${
                      hasFeaturesTab
                        ? `<button class="subtab-btn" type="button" onclick="window.DrevalithPublicUI.tab(this, '${esc(game.id)}', 'features')">Key Features</button>`
                        : ""
                    }
                  </div>
                `
                    : ""
                }

                <div id="dyn-tab-box-${esc(game.id)}" class="subtab-content" style="min-height:auto;">
                  ${formatParagraphs(game.description)}
                </div>

                <div style="display:flex;flex-wrap:wrap;gap:0.85rem;align-items:center;">
                  ${actionButtonsHtml}
                </div>

                ${statusStripHtml}
              </div>

              <div class="release-preview">
                <div class="preview-top" style="width:100%;margin-bottom:1.1rem;">
                  ${
                    coverSrc
                      ? `<div style="width:100%;border-radius:10px;overflow:hidden;border:1px solid rgba(242,53,25,0.45);box-shadow:0 12px 30px rgba(0,0,0,0.8);margin-bottom:0.75rem;">
                          <img
                            src="${esc(coverSrc)}"
                            alt="${esc(game.title)} Official Cover"
                            style="width:100%;height:auto;max-height:310px;display:block;object-fit:cover;margin:0;border-radius:0;"
                          />
                        </div>`
                      : ""
                  }
                  <div style="color:var(--accent);font-size:0.75rem;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">
                    Official Game Cover • Drevalith Games™
                  </div>
                </div>

                <div class="specs-box">
                  <div class="spec-row">
                    <span class="spec-label">Status</span>
                    <span class="spec-val accent">${
                      isComingSoon ? "In Development" : "Available for Download"
                    }</span>
                  </div>
                  ${
                    isComingSoon
                      ? `
                      <div class="spec-row">
                        <span class="spec-label">Release Date</span>
                        <span class="spec-val">${esc(comingSoonLabel)}</span>
                      </div>
                      <div class="spec-row">
                        <span class="spec-label">Platform</span>
                        <span class="spec-val">${esc(game.platform || "Windows PC")}</span>
                      </div>
                      <div class="spec-row">
                        <span class="spec-label">Modes</span>
                        <span class="spec-val">${esc(game.modes || "Singleplayer / Co-op")}</span>
                      </div>
                      `
                      : `
                      <div class="spec-row">
                        <span class="spec-label">Version</span>
                        <span class="spec-val">${esc(game.version || "v1.0.0")}</span>
                      </div>
                      <div class="spec-row">
                        <span class="spec-label">Price</span>
                        <span class="spec-val">${esc(priceFormatted)}</span>
                      </div>
                      <div class="spec-row">
                        <span class="spec-label">Platform</span>
                        <span class="spec-val">${esc(game.platform || "Windows PC")}</span>
                      </div>
                      <div class="spec-row">
                        <span class="spec-label">Release Date</span>
                        <span class="spec-val">${esc(game.releaseDate || "Available Now")}</span>
                      </div>
                      <div class="spec-row">
                        <span class="spec-label">Download Package</span>
                        <span class="spec-val">.ZIP (${esc(game.zipSizeFormatted || "Archive")})</span>
                      </div>
                      `
                  }
                </div>
              </div>
            </div>
          `;
        } catch (cardErr) {
          console.error("Game card render error:", cardErr);
          return "";
        }
      })
      .join("");

    attachTiltToDynamicCards(mount);
  }

  let handledUrlRedeem = false;
  function checkUrlRedeemParams() {
    if (handledUrlRedeem || !currentStoreState.games.length) return;
    const params = new URLSearchParams(window.location.search);
    const redeemKey = params.get("redeem") || params.get("key") || "";
    const targetGame = params.get("game") || "";
    if (!redeemKey) return;

    handledUrlRedeem = true;
    window.switchPage("games", false);
    const chosen =
      currentStoreState.games.find((g) => g.id === targetGame) || currentStoreState.games[0];
    if (chosen) openKeyModal(chosen.id, redeemKey);
  }

  // --------------------------------------------------------------------------
  // Public UI Controller Methods
  // --------------------------------------------------------------------------
  window.DrevalithPublicUI = {
    pay: startGamePayment,
    download: startStreamingDownload,
    openKey: openKeyModal,
    closeModals,
    tab: switchDynamicTab,
    selectSimMethod(chip) {
      document.querySelectorAll(".rzp-method-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
    },
    switchAuthTab(tab) {
      activeAuthTab = tab;
      if (tab !== "verify") {
        playerAuthState.pendingVerificationEmail = "";
        wasWaitingForEmailVerify = false;
      }
      renderAccountAndPurchasesPage();
    },
    async submitSignup(e) {
      e.preventDefault();
      const displayName = document.getElementById("drev-signup-name").value.trim();
      const email = document.getElementById("drev-signup-email").value.trim();
      const password = document.getElementById("drev-signup-pass").value;
      const password2 = document.getElementById("drev-signup-pass2").value;
      const alertEl = document.getElementById("drev-auth-alert");
      const btn = document.getElementById("drev-signup-btn");

      if (!displayName) {
        alertEl.className = "drev-alert error";
        alertEl.textContent = "Please enter your Name.";
        return;
      }
      if (password !== password2) {
        alertEl.className = "drev-alert error";
        alertEl.textContent = "Passwords do not match. Please re-enter.";
        return;
      }

      alertEl.className = "drev-alert";
      btn.disabled = true;
      btn.textContent = "Sending Verification Email...";

      try {
        const res = await Store.registerPlayerAccount({ displayName, email, password });
        if (res.alreadyVerified) {
          showToast("✅ Account ready! Opening your Profile...");
          handlePostLoginContinuation();
          return;
        }
        playerAuthState.pendingVerificationEmail = res.email;
        wasWaitingForEmailVerify = true;
        activeAuthTab = "verify";
        renderAccountAndPurchasesPage();
        showToast(
          res.sent
            ? `📧 Verification link sent to ${res.email}!`
            : `📩 Check your inbox (${res.email}) and click the verification link!`
        );
      } catch (err) {
        alertEl.className = "drev-alert error";
        alertEl.textContent = err.message || "Could not create account.";
        btn.disabled = false;
        btn.textContent = "📧 Sign Up & Send Verification Email";
      }
    },
    async resendVerify(btn) {
      const alertEl = document.getElementById("drev-auth-alert");
      if (btn) btn.disabled = true;
      try {
        const r = await Store.resendPlayerVerificationLink();
        if (r && r.verified) {
          wasWaitingForEmailVerify = false;
          handlePostLoginContinuation();
          return;
        }
        if (alertEl) {
          alertEl.className = "drev-alert success";
          alertEl.textContent = `📧 Fresh verification email sent to ${r.email || "your inbox"}! Click the link inside — your account will open automatically.`;
        }
        showToast(`📧 Sent verification link to ${r.email || "your email"}!`);
      } catch (err) {
        if (alertEl) {
          alertEl.className = "drev-alert error";
          alertEl.textContent = err.message || "Please wait 60 seconds before requesting another email.";
        }
        showToast(`⏳ ${err.message}`);
      } finally {
        setTimeout(() => {
          if (btn) btn.disabled = false;
        }, 15000);
      }
    },
    toggleEditName(openState) {
      editingProfileNameInline = Boolean(openState);
      renderAccountAndPurchasesPage();
      if (editingProfileNameInline) {
        setTimeout(() => {
          const inp = document.getElementById("drev-inline-name-input");
          if (inp && typeof inp.focus === "function") inp.focus();
        }, 40);
      }
    },
    async saveProfileNameInline(e) {
      e.preventDefault();
      const inp = document.getElementById("drev-inline-name-input");
      const nextName = inp ? inp.value.trim() : "";
      if (!nextName) return;
      try {
        await Store.updatePlayerProfileName(nextName);
        editingProfileNameInline = false;
        renderAccountAndPurchasesPage();
        showToast("✅ Name saved & fetched directly from Firebase Database!");
      } catch (err) {
        showToast(`❌ ${err.message || "Could not update profile name."}`);
      }
    },
    async submitLogin(e) {
      e.preventDefault();
      const email = document.getElementById("drev-login-email").value.trim();
      const password = document.getElementById("drev-login-pass").value;
      const alertEl = document.getElementById("drev-auth-alert");
      const btn = document.getElementById("drev-login-btn");

      alertEl.className = "drev-alert";
      btn.disabled = true;
      btn.textContent = "Signing In...";

      try {
        const res = await Store.loginPlayerAccount({ email, password });
        if (!res.verified) {
          playerAuthState.pendingVerificationEmail = res.email;
          wasWaitingForEmailVerify = true;
          activeAuthTab = "verify";
          renderAccountAndPurchasesPage();
          showToast("📩 Click the verification link in your email — your account will open automatically!");
          return;
        }
        wasWaitingForEmailVerify = false;
        showToast(`✅ Signed in as ${(res.dbProfile && res.dbProfile.name) || res.user.email}`);
        handlePostLoginContinuation();
      } catch (err) {
        alertEl.className = "drev-alert error";
        alertEl.textContent = err.message || "Invalid email or password.";
        btn.disabled = false;
        btn.textContent = "🔐 Sign In to Account";
      }
    },
    async forgotPassword() {
      const emailInput = document.getElementById("drev-login-email");
      const alertEl = document.getElementById("drev-auth-alert");
      const email = emailInput ? emailInput.value.trim() : "";
      if (!email) {
        if (alertEl) {
          alertEl.className = "drev-alert error";
          alertEl.textContent = "Type your email in the Email box above first, then click 'Forgot Password?'.";
        }
        return;
      }
      try {
        await Store.sendPlayerPasswordReset(email);
        if (alertEl) {
          alertEl.className = "drev-alert success";
          alertEl.textContent = `📧 Password reset link sent to ${email}! Check your inbox & spam folder.`;
        }
      } catch (err) {
        if (alertEl) {
          alertEl.className = "drev-alert error";
          alertEl.textContent = err.message || "Could not send password reset email.";
        }
      }
    },
    async logoutPlayer() {
      await Store.logoutPlayerAccount();
      wasWaitingForEmailVerify = false;
      activeAuthTab = "login";
      renderAccountAndPurchasesPage();
      renderPublishedGames();
      showToast("Signed out of your Drevalith Account.");
    }
  };

  window.addEventListener("DOMContentLoaded", () => {
    injectStoreStyles();
    ensurePlayerAccountPageAndNav();
    ensureModals();
    renderAccountAndPurchasesPage();

    const hash = window.location.hash.replace("#", "").toLowerCase();
    if (hash === "account" || hash === "purchases" || hash === "login" || hash === "signup") {
      if (hash === "signup") activeAuthTab = "signup";
      window.switchPage("account", false);
    }

    Store.subscribePlayerAuth((nextAuth) => {
      const justVerified = Boolean(
        (wasWaitingForEmailVerify || activeAuthTab === "verify") && nextAuth && nextAuth.user
      );
      playerAuthState = nextAuth;
      if (justVerified) {
        wasWaitingForEmailVerify = false;
        activeAuthTab = "login";
        const welcomeName =
          (nextAuth.dbProfile && nextAuth.dbProfile.name) || nextAuth.user.displayName || nextAuth.user.email;
        showToast(`✅ Email verified! Welcome to Drevalith Games™, ${welcomeName}!`);
        handlePostLoginContinuation();
        return;
      }
      renderPublishedGames();
      renderAccountAndPurchasesPage();
    });

    Store.subscribePublicStore((nextState) => {
      currentStoreState = nextState;
      renderPublishedGames();
      renderAccountAndPurchasesPage();
      checkUrlRedeemParams();
    });
  });
})();
