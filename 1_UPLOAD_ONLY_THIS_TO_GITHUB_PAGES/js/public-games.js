/**
 * ============================================================================
 * DREVALITH GAMES™ — PUBLIC REALTIME GAME STORE, RAZORPAY & PRIVATE KEY UI
 * ============================================================================
 * Renders uploaded studio games into #live-published-games using the exact
 * Drevalith Games™ .release-banner template without altering the rest of the site.
 * ============================================================================
 */

(function () {
  const Store = window.DrevalithStore;
  if (!Store) return;

  let currentStoreState = {
    settings: { showDefaultComingSoon: true },
    games: []
  };

  // Escape HTML safely to prevent XSS
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

  // Inject Store-Specific Modal & Unlocked Button Styles (matching Drevalith variables)
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
        padding: 0.94rem 1.9rem;
        border-radius: 8px;
        font-weight: 800;
        font-size: 0.9rem;
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
      .btn-download-unlocked:hover {
        transform: translateY(-3px) scale(1.02);
        box-shadow: 0 12px 34px rgba(22, 163, 74, 0.68);
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
      .link-subtle-btn:hover {
        color: #ffffff;
      }
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
      .drev-field {
        margin-bottom: 1rem;
      }
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

      /* Razorpay Sandbox Simulator Styling */
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
        max-width: 390px;
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

  function ensureModals() {
    if (document.getElementById("drev-key-modal")) return;

    const wrapper = document.createElement("div");
    wrapper.innerHTML = `
      <!-- PRIVATE KEY REDEEM MODAL -->
      <div class="drev-modal-backdrop" id="drev-key-modal">
        <div class="drev-modal-box">
          <button class="drev-modal-close" type="button" onclick="window.DrevalithPublicUI.closeModals()">✕</button>
          <span class="section-tag" style="margin-bottom:0.25rem;">Drevalith Games™ // Owner Key Vault</span>
          <h3 style="font-size:1.35rem;font-weight:900;text-transform:uppercase;margin-bottom:0.35rem;">Redeem Private Key</h3>
          <p id="drev-key-game-label" style="color:var(--text-muted);font-size:0.88rem;margin-bottom:1.15rem;">
            Enter a valid Studio Owner Private Key to unlock the full .ZIP game download for free ($0.00).
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
              <label for="drev-key-email">Your Name or Email (Optional — For Receipt)</label>
              <input
                type="text"
                id="drev-key-email"
                class="drev-input"
                placeholder="player@example.com"
              />
            </div>
            <button type="submit" id="drev-key-submit" class="btn-primary" style="width:100%;justify-content:center;display:flex;border:none;cursor:pointer;">
              🔑 Verify Key &amp; Unlock Free Download
            </button>
          </form>
        </div>
      </div>

      <!-- RESTORE PREVIOUS PURCHASE MODAL -->
      <div class="drev-modal-backdrop" id="drev-restore-modal">
        <div class="drev-modal-box">
          <button class="drev-modal-close" type="button" onclick="window.DrevalithPublicUI.closeModals()">✕</button>
          <span class="section-tag" style="margin-bottom:0.25rem;">Drevalith Games™ // Buyer Recovery</span>
          <h3 style="font-size:1.3rem;font-weight:900;text-transform:uppercase;margin-bottom:0.35rem;">Restore Paid Download</h3>
          <p style="color:var(--text-muted);font-size:0.87rem;margin-bottom:1.1rem;">
            Already purchased this game via Razorpay? Enter your Razorpay Payment ID from your receipt to unlock your .ZIP download again.
          </p>
          <div id="drev-restore-alert" class="drev-alert"></div>
          <form id="drev-restore-form">
            <input type="hidden" id="drev-restore-game-id" />
            <div class="drev-field">
              <label for="drev-restore-pid">Razorpay Payment ID *</label>
              <input type="text" id="drev-restore-pid" class="drev-input" placeholder="pay_XXXXXXXXXXXXXX" required />
            </div>
            <div class="drev-field">
              <label for="drev-restore-email">Buyer Email (Used at Checkout)</label>
              <input type="email" id="drev-restore-email" class="drev-input" placeholder="you@example.com" />
            </div>
            <button type="submit" id="drev-restore-submit" class="btn-primary" style="width:100%;justify-content:center;display:flex;border:none;cursor:pointer;">
              Verify Receipt &amp; Unlock Download
            </button>
          </form>
        </div>
      </div>

      <!-- RAZORPAY SANDBOX PREVIEW CHECKOUT (Used ONLY before live RAZORPAY_KEY_ID is set) -->
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
            <label for="rzp-sim-email">Buyer Email (For Payment Receipt) *</label>
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
              ✕ Cancel / Simulate Unpaid (Keep Locked)
            </button>
          </div>
        </div>
      </div>

      <!-- POST-UNLOCK CELEBRATION / DIRECT DOWNLOAD MODAL -->
      <div class="drev-modal-backdrop" id="drev-unlocked-modal">
        <div class="drev-modal-box" style="border-color:rgba(74,222,128,0.55);">
          <button class="drev-modal-close" type="button" onclick="window.DrevalithPublicUI.closeModals()">✕</button>
          <span class="section-tag" style="color:#4ade80;margin-bottom:0.25rem;">Access Granted // Verified</span>
          <h3 id="drev-unlocked-heading" style="font-size:1.4rem;font-weight:900;text-transform:uppercase;margin-bottom:0.45rem;">
            Game Download Unlocked!
          </h3>
          <p id="drev-unlocked-desc" style="color:var(--text-muted);font-size:0.9rem;margin-bottom:1.25rem;"></p>
          <a id="drev-unlocked-dl-link" href="#" class="btn-download-unlocked" style="width:100%;justify-content:center;margin-bottom:0.75rem;">
            ⬇ Download Game (.ZIP) Now
          </a>
          <p id="drev-unlocked-receipt" style="font-size:0.77rem;color:var(--text-muted);text-align:center;"></p>
        </div>
      </div>

      <div id="drev-toast" class="drev-toast"></div>
    `;
    document.body.appendChild(wrapper);

    // Auto-format Private Key input
    const keyInput = document.getElementById("drev-key-code");
    keyInput.addEventListener("input", () => {
      const pos = keyInput.selectionStart;
      keyInput.value = Store.formatPrivateKeyInput(keyInput.value);
      if (pos !== null) {
        try {
          keyInput.setSelectionRange(keyInput.value.length, keyInput.value.length);
        } catch (_) {}
      }
    });

    // Submit Private Key Form
    document.getElementById("drev-key-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const gameId = document.getElementById("drev-key-game-id").value;
      const code = document.getElementById("drev-key-code").value;
      const email = document.getElementById("drev-key-email").value;
      const btn = document.getElementById("drev-key-submit");
      const alertBox = document.getElementById("drev-key-alert");
      const game = currentStoreState.games.find((g) => g.id === gameId);

      alertBox.className = "drev-alert";
      alertBox.textContent = "";
      btn.disabled = true;
      btn.textContent = "Verifying Private Key...";

      try {
        const receipt = await Store.redeemPrivateKey({
          gameId,
          gameTitle: game ? game.title : "Studio Game",
          privateKey: code,
          redeemerLabel: email
        });
        closeModals();
        renderPublishedGames();
        openUnlockedModal(
          game,
          receipt,
          "Private Key Verified — Free Download!",
          `Your Studio Private Key was verified with $0.00 fees. You can now download ${game ? game.title : "the game"} below.`
        );
      } catch (err) {
        alertBox.className = "drev-alert error";
        alertBox.textContent = err.message || "Invalid Private Key.";
      } finally {
        btn.disabled = false;
        btn.textContent = "🔑 Verify Key & Unlock Free Download";
      }
    });

    // Submit Purchase Restore Form
    document.getElementById("drev-restore-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const gameId = document.getElementById("drev-restore-game-id").value;
      const paymentId = document.getElementById("drev-restore-pid").value;
      const buyerEmail = document.getElementById("drev-restore-email").value;
      const btn = document.getElementById("drev-restore-submit");
      const alertBox = document.getElementById("drev-restore-alert");
      const game = currentStoreState.games.find((g) => g.id === gameId);

      alertBox.className = "drev-alert";
      btn.disabled = true;
      btn.textContent = "Checking Payment Receipt...";

      try {
        const receipt = await Store.restorePurchase({ gameId, paymentId, buyerEmail });
        closeModals();
        renderPublishedGames();
        openUnlockedModal(
          game,
          receipt,
          "Purchase Verified & Restored!",
          `Verified Razorpay Payment (${receipt.paymentId}). Your .ZIP download is ready.`
        );
      } catch (err) {
        alertBox.className = "drev-alert error";
        alertBox.textContent = err.message || "Could not verify Payment ID.";
      } finally {
        btn.disabled = false;
        btn.textContent = "Verify Receipt & Unlock Download";
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
    toastTimer = setTimeout(() => t.classList.remove("show"), 4500);
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
    const alertBox = document.getElementById("drev-key-alert");
    alertBox.className = "drev-alert";
    alertBox.textContent = "";
    if (game) {
      document.getElementById("drev-key-game-label").innerHTML =
        `Enter an Owner-generated Private Key for <strong>${esc(game.title)}</strong> to unlock free download ($0.00 fee).`;
    }
    document.getElementById("drev-key-modal").classList.add("open");
    setTimeout(() => document.getElementById("drev-key-code").focus(), 60);
  }

  function openRestoreModal(gameId) {
    document.getElementById("drev-restore-game-id").value = gameId;
    document.getElementById("drev-restore-pid").value = "";
    const alertBox = document.getElementById("drev-restore-alert");
    alertBox.className = "drev-alert";
    alertBox.textContent = "";
    document.getElementById("drev-restore-modal").classList.add("open");
  }

  function openUnlockedModal(game, receipt, heading, description) {
    document.getElementById("drev-unlocked-heading").textContent = heading;
    document.getElementById("drev-unlocked-desc").textContent = description;
    const dlLink = document.getElementById("drev-unlocked-dl-link");
    dlLink.href = receipt.downloadUrl || "#";
    dlLink.setAttribute("download", (game && game.zipFileName) || "game.zip");
    dlLink.textContent = `⬇ Download ${game ? game.zipFileName : "Game (.ZIP)"} (${
      game ? game.zipSizeFormatted : "ZIP"
    })`;
    document.getElementById("drev-unlocked-receipt").textContent = receipt.paymentId
      ? `Verified Razorpay Payment ID: ${receipt.paymentId} (Save this ID for future re-downloads)`
      : `Unlocked via Verified Studio Owner Private Key • $0.00 Charged`;
    document.getElementById("drev-unlocked-modal").classList.add("open");
  }

  // Handle Dynamic Card Sub-Tabs (Overview / Gameplay / Features)
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

  // Start Razorpay Payment Flow for a Specific Game
  async function startGamePayment(gameId, triggerBtn) {
    const game = currentStoreState.games.find((g) => g.id === gameId);
    if (!game) return;

    const origLabel = triggerBtn ? triggerBtn.innerHTML : "";
    if (triggerBtn) {
      triggerBtn.disabled = true;
      triggerBtn.innerHTML = `<span>⏳ Initializing Razorpay Order...</span>`;
    }

    try {
      const orderData = await Store.createPaymentOrder(game);

      // LIVE / TEST RAZORPAY CHECKOUT.JS FLOW (Both Server Order Mode & GitHub Pages Serverless Mode!)
      if ((orderData.mode === "live_razorpay" || orderData.mode === "live_razorpay_serverless") && orderData.keyId) {
        const Razorpay = await Store.loadRazorpayCheckoutScript();
        const cfg = window.DREVALITH_CONFIG || {};

        const rzpOpts = {
          key: orderData.keyId,
          amount: orderData.amount, // Exact game amount in subunits (cents/paise)
          currency: orderData.currency,
          name: cfg.STUDIO_NAME || "Drevalith Games™",
          description: `${game.title} — Official Full Game (.ZIP)`,
          theme: {
            color: cfg.THEME_COLOR || "#f23519"
          },
          handler: async function (response) {
            try {
              showToast("Verifying payment & unlocking download...");
              const receipt = await Store.verifyRazorpayPayment({
                gameId: game.id,
                gameTitle: game.title,
                amountPaid: game.price,
                currency: orderData.currency,
                razorpay_order_id: response.razorpay_order_id || "",
                razorpay_payment_id: response.razorpay_payment_id,
                razorpay_signature: response.razorpay_signature || ""
              });
              renderPublishedGames();
              openUnlockedModal(
                game,
                receipt,
                "Payment Successful — Download Unlocked!",
                `Thank you for supporting Drevalith Games™! Your payment of ${Store.formatCurrency(
                  game.price,
                  game.currency
                )} is verified.`
              );
            } catch (verifyErr) {
              showToast(`❌ ${verifyErr.message}`);
            }
          },
          modal: {
            ondismiss: function () {
              showToast("Payment cancelled. Download remains locked until payment or key verification.");
            }
          }
        };
        if (orderData.orderId) rzpOpts.order_id = orderData.orderId;

        const rzp = new Razorpay(rzpOpts);

        rzp.on("payment.failed", function (resp) {
          const reason = resp?.error?.description || "Payment was declined.";
          showToast(`❌ Payment failed: ${reason}. Download remains locked.`);
        });

        rzp.open();
        return;
      }

      // SANDBOX PREVIEW CHECKOUT SIMULATOR (Before owner pastes live RAZORPAY_KEY_ID)
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
        openUnlockedModal(
          game,
          receipt,
          "Payment Successful — Download Unlocked!",
          `Verified ${Store.formatCurrency(game.price, game.currency)} payment for ${game.title}. Click below to download your game .ZIP file!`
        );
      } catch (e) {
        showToast(`❌ ${e.message}`);
      } finally {
        payBtn.disabled = false;
      }
    };

    failBtn.onclick = () => {
      closeModals();
      showToast("🔒 Payment not completed — Game .ZIP download remains strictly locked.");
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
    if (!mount) return;

    // Toggle default static "VOLT & VITALS Coming Soon" banner only if Owner explicitly toggled it off
    const defaultBanner = document.getElementById("default-upcoming-banner");
    if (defaultBanner) {
      const showDefault =
        !currentStoreState.settings || currentStoreState.settings.showDefaultComingSoon !== false;
      defaultBanner.style.display = showDefault ? "" : "none";
    }

    const games = currentStoreState.games || [];
    if (!games.length) {
      mount.innerHTML = "";
      return;
    }

    mount.innerHTML = games
      .map((game) => {
        const isFree = Boolean(game.isFree) || Number(game.price || 0) <= 0;
        const unlock = !isFree ? Store.getUnlockForGame(game.id) : null;
        const hasGameplayTab = Boolean(game.gameplayText && game.gameplayText.trim());
        const hasFeaturesTab = Array.isArray(game.featuresList) && game.featuresList.length > 0;
        const showSubtabs = hasGameplayTab || hasFeaturesTab;

        const priceFormatted = isFree
          ? "FREE DOWNLOAD"
          : Store.formatCurrency(game.price, game.currency);

        let actionButtonsHtml = "";
        let statusStripHtml = "";

        if (isFree) {
          const freeUrl = Store.getFreeGameDownloadUrl(game);
          actionButtonsHtml = `
            <a href="${esc(freeUrl)}" download="${esc(game.zipFileName || "game.zip")}" class="btn-download-unlocked">
              <span>⬇</span>
              <span>Free Download .ZIP (${esc(game.zipSizeFormatted || "ZIP")})</span>
            </a>
            <button class="btn-secondary" onclick="switchPage('studio')">Studio Info →</button>
          `;
          statusStripHtml = `
            <div class="unlock-status-strip verified">
              <span>✅ <strong>Official Free Release</strong> — Instant .ZIP download unlocked for all players.</span>
            </div>
          `;
        } else if (unlock && unlock.downloadUrl) {
          // PAID GAME — VERIFIED & UNLOCKED!
          actionButtonsHtml = `
            <a href="${esc(unlock.downloadUrl)}" download="${esc(game.zipFileName || "game.zip")}" class="btn-download-unlocked">
              <span>⬇</span>
              <span>Download ${esc(game.zipFileName || "Game .ZIP")} (${esc(game.zipSizeFormatted || "ZIP")})</span>
            </a>
            <button class="btn-secondary" onclick="switchPage('studio')">Studio Info →</button>
          `;
          const viaLabel =
            unlock.method === "private_key"
              ? "Unlocked via Studio Owner Private Key ($0.00)"
              : `Payment Verified (${esc(unlock.paymentId || "Razorpay")})`;
          statusStripHtml = `
            <div class="unlock-status-strip verified">
              <span>✅ <strong>${viaLabel}</strong> — Full game package ready to download.</span>
              ${
                game.installNotes
                  ? `<span style="font-size:0.78rem;opacity:0.9;">Note: ${esc(game.installNotes)}</span>`
                  : ""
              }
            </div>
          `;
        } else {
          // PAID GAME — LOCKED UNTIL PAYMENT OR VALID PRIVATE KEY!
          actionButtonsHtml = `
            <button type="button" class="btn-primary" style="border:none;cursor:pointer;" onclick="window.DrevalithPublicUI.pay('${esc(game.id)}', this)">
              💳 Buy &amp; Download — ${esc(priceFormatted)}
            </button>
            <button type="button" class="btn-key-trigger" onclick="window.DrevalithPublicUI.openKey('${esc(game.id)}')">
              🔑 Enter Private Key
            </button>
            <button type="button" class="btn-disabled" disabled title="Complete Razorpay payment or enter an Owner Private Key to unlock .ZIP download">
              <span>🔒</span>
              <span>Download .ZIP Locked</span>
            </button>
          `;
          statusStripHtml = `
            <div class="unlock-status-strip">
              <span>🔒 <strong>Protected Build:</strong> Complete payment (${esc(priceFormatted)}) or redeem an Owner Private Key to unlock the <code>.zip</code> file.</span>
              <button type="button" class="link-subtle-btn" onclick="window.DrevalithPublicUI.openRestore('${esc(game.id)}')">
                Already paid? Restore Download
              </button>
            </div>
          `;
        }

        return `
          <div class="release-banner tilt-card" data-game-id="${esc(game.id)}">
            <div>
              <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.6rem;margin-bottom:0.45rem;">
                <div class="badge" style="margin-bottom:0;">
                  <span class="badge-dot"></span>
                  <span>${esc(game.badgeText || "Official Studio Release")}</span>
                </div>
                <span class="price-pill-highlight ${isFree ? "free" : ""}">
                  ${esc(priceFormatted)}
                </span>
              </div>

              <h3 class="game-title">${esc(game.title)}</h3>
              <div class="game-subtitle">
                ${esc(game.subtitle || game.modes || "Windows PC")}
                ${game.version ? `&nbsp;•&nbsp; ${esc(game.version)}` : ""}
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
                <div style="width:100%;border-radius:10px;overflow:hidden;border:1px solid rgba(242,53,25,0.45);box-shadow:0 12px 30px rgba(0,0,0,0.8);margin-bottom:0.75rem;">
                  <img
                    src="${esc(game.coverImageUrl && game.coverImageUrl.startsWith('/') && window.DREVALITH_CONFIG && window.DREVALITH_CONFIG.BACKEND_API_URL ? window.DREVALITH_CONFIG.BACKEND_API_URL.replace(/\/+$/, '') + game.coverImageUrl : game.coverImageUrl)}"
                    alt="${esc(game.title)} Official Cover"
                    style="width:100%;height:auto;max-height:310px;display:block;object-fit:cover;margin:0;border-radius:0;"
                  />
                </div>
                <div style="color:var(--accent);font-size:0.75rem;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;">
                  Official Game Cover • Drevalith Games™
                </div>
              </div>

              <div class="specs-box">
                <div class="spec-row">
                  <span class="spec-label">Status</span>
                  <span class="spec-val accent">Available for Download</span>
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
              </div>
            </div>
          </div>
        `;
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
    if (typeof window.switchPage === "function") {
      window.switchPage("games", false);
    }
    const chosen =
      currentStoreState.games.find((g) => g.id === targetGame) || currentStoreState.games[0];
    if (chosen) {
      openKeyModal(chosen.id, redeemKey);
    }
  }

  window.DrevalithPublicUI = {
    pay: startGamePayment,
    openKey: openKeyModal,
    openRestore: openRestoreModal,
    closeModals,
    tab: switchDynamicTab,
    selectSimMethod(chip) {
      document.querySelectorAll(".rzp-method-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
    }
  };

  window.addEventListener("DOMContentLoaded", () => {
    injectStoreStyles();
    ensureModals();
    Store.subscribePublicStore((nextState) => {
      currentStoreState = nextState;
      renderPublishedGames();
      checkUrlRedeemParams();
    });
  });
})();
