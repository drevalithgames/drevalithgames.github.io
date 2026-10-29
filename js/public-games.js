/**
 * ============================================================================
 * DREVALITH GAMES™ — PUBLIC STUDIO SHOWCASE & DIRECT ITCH.IO CATALOG UI (v19)
 * ============================================================================
 * - Cleanly renders published games & game updates from the Studio Owner Console
 *   on the public Games page (#live-published-games).
 * - Strict Buy Button Enable / Disable / Hide + Automatic Future Release Date
 *   & "Coming Soon" Guard: NEVER shows an active Buy button before release day
 *   or when disabled by the Studio Owner.
 * - Zero payment popups, zero player login/signup forms, zero clutter.
 * ============================================================================
 */
(function () {
  "use strict";

  const Store = window.DrevalithStore;
  if (!Store) return;

  let currentCatalogGames = [];
  let catalogLoaded = false;

  function esc(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatParagraphs(text) {
    const clean = String(text || "").trim();
    if (!clean) return "<p>Official release by Drevalith Games™.</p>";
    return clean
      .split(/\n{2,}/)
      .map((para) => `<p>${esc(para.trim()).replace(/\n/g, "<br/>")}</p>`)
      .join("");
  }

  function injectShowcaseStyles() {
    if (document.getElementById("drevalith-showcase-styles-v18")) return;
    const style = document.createElement("style");
    style.id = "drevalith-showcase-styles-v18";
    style.textContent = `
      #live-published-games {
        display: flex;
        flex-direction: column;
        gap: 2.2rem;
        width: 100%;
      }
      .drev-game-showcase {
        position: relative;
        overflow: hidden;
        background: linear-gradient(145deg, rgba(16, 20, 31, 0.94) 0%, rgba(10, 13, 21, 0.97) 100%);
        border: 1px solid rgba(255, 255, 255, 0.09);
        border-radius: 16px;
        padding: 2.15rem 2.25rem;
        display: grid;
        grid-template-columns: 1.25fr 0.95fr;
        gap: 2.25rem;
        align-items: stretch;
        box-shadow: 0 22px 52px rgba(0, 0, 0, 0.6);
        transition: border-color 0.28s ease, box-shadow 0.28s ease, transform 0.25s ease;
      }
      .drev-game-showcase::before {
        content: "";
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        height: 3px;
        background: linear-gradient(90deg, var(--accent, #f23519), rgba(255, 122, 99, 0.65), transparent);
        pointer-events: none;
      }
      .drev-game-showcase:hover {
        border-color: rgba(242, 53, 25, 0.45);
        box-shadow: 0 28px 64px rgba(0, 0, 0, 0.72), 0 0 34px rgba(242, 53, 25, 0.12);
      }
      .drev-game-left {
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        min-width: 0;
      }
      .drev-version-pill {
        display: inline-flex;
        align-items: center;
        gap: 0.35rem;
        padding: 0.32rem 0.85rem;
        border-radius: 999px;
        font-size: 0.74rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #dbe4f3;
      }
      .drev-update-callout {
        margin: 0.85rem 0 0.35rem 0;
        padding: 0.72rem 0.95rem;
        border-radius: 10px;
        background: rgba(242, 53, 25, 0.09);
        border-left: 3px solid var(--accent, #f23519);
        font-size: 0.84rem;
        color: #e2e8f0;
        line-height: 1.5;
      }
      .drev-update-callout strong {
        color: #ff8a75;
        font-size: 0.74rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        display: block;
        margin-bottom: 0.18rem;
      }
      .drev-game-actions {
        display: flex;
        flex-wrap: wrap;
        gap: 0.85rem;
        align-items: center;
        margin-top: 1.55rem;
        padding-top: 1.2rem;
        border-top: 1px solid rgba(255, 255, 255, 0.07);
      }
      .drev-cover-frame {
        position: relative;
        width: 100%;
        aspect-ratio: 16 / 9;
        border-radius: 12px;
        overflow: hidden;
        background: radial-gradient(circle at center, rgba(242, 53, 25, 0.14), rgba(7, 9, 14, 0.95));
        border: 1px solid rgba(255, 255, 255, 0.1);
        margin-bottom: 1.1rem;
        box-shadow: 0 14px 32px rgba(0, 0, 0, 0.55);
      }
      .drev-cover-frame img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        transition: transform 0.45s cubic-bezier(0.16, 1, 0.3, 1);
      }
      .drev-game-showcase:hover .drev-cover-frame img {
        transform: scale(1.035);
      }
      .drev-empty-catalog {
        text-align: center;
        padding: 3.2rem 1.8rem;
        border-radius: 16px;
        background: rgba(16, 20, 31, 0.72);
        border: 1px dashed rgba(255, 255, 255, 0.14);
        color: var(--text-muted, #949eb2);
      }
      @media (max-width: 900px) {
        .drev-game-showcase {
          grid-template-columns: 1fr;
          padding: 1.5rem;
          gap: 1.5rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function attachTiltToDynamicCards(container) {
    container.querySelectorAll(".tilt-card").forEach((card) => {
      if (card.dataset.tiltBound) return;
      card.dataset.tiltBound = "1";
      card.addEventListener("mousemove", (e) => {
        const rect = card.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width - 0.5;
        const y = (e.clientY - rect.top) / rect.height - 0.5;
        card.style.transform = `perspective(900px) rotateY(${x * 4}deg) rotateX(${-y * 4}deg) translateY(-3px)`;
      });
      card.addEventListener("mouseleave", () => {
        card.style.transform = "perspective(900px) rotateY(0deg) rotateX(0deg) translateY(0px)";
      });
    });
  }

  function switchDynamicTab(btn, gameId, tabKey) {
    const game = currentCatalogGames.find((g) => g.id === gameId);
    if (!game) return;
    const card = btn.closest(".drev-game-showcase");
    if (card) {
      card.querySelectorAll(".subtab-btn").forEach((b) => b.classList.remove("active"));
    }
    btn.classList.add("active");

    const contentEl = document.getElementById(`dyn-tab-box-${gameId}`);
    if (!contentEl) return;

    contentEl.style.animation = "none";
    void contentEl.offsetWidth;
    contentEl.style.animation = "fadeIn 0.28s ease";

    if (tabKey === "gameplay" && game.gameplayText) {
      contentEl.innerHTML = formatParagraphs(game.gameplayText);
    } else if (tabKey === "features" && Array.isArray(game.featuresList) && game.featuresList.length) {
      contentEl.innerHTML = `<ul class="feature-list">${game.featuresList
        .map((item) => `<li>${esc(item)}</li>`)
        .join("")}</ul>`;
    } else if (tabKey === "updates" && game.updateNotes) {
      contentEl.innerHTML = formatParagraphs(game.updateNotes);
    } else {
      contentEl.innerHTML = formatParagraphs(game.description);
    }
  }

  function renderPublishedGames(loaded) {
    const mount = document.getElementById("live-published-games");
    if (!mount) return;

    const defaultBanner = document.getElementById("default-upcoming-banner");
    if (defaultBanner) defaultBanner.remove();

    if (!currentCatalogGames.length) {
      if (!loaded) return;
      mount.innerHTML = `
        <div class="drev-empty-catalog">
          <div class="badge" style="margin-bottom:0.75rem;">
            <span class="badge-dot"></span>
            <span>Drevalith Games™</span>
          </div>
          <h3 style="color:#fff;font-size:1.35rem;margin-bottom:0.4rem;">New Releases &amp; Updates Coming Soon</h3>
          <p style="max-width:460px;margin:0 auto 1.25rem auto;font-size:0.94rem;">
            Official studio builds and announcements will appear here as soon as they are published.
          </p>
          <a href="${esc((window.DREVALITH_CONFIG && window.DREVALITH_CONFIG.DEFAULT_ITCH_URL) || "https://drevalithgames.itch.io")}" target="_blank" rel="noopener noreferrer" class="btn-secondary">
            Visit Official itch.io Page ↗
          </a>
        </div>
      `;
      return;
    }

    mount.innerHTML = currentCatalogGames
      .map((game) => {
        const hasGameplayTab = Boolean(game.gameplayText && game.gameplayText.trim());
        const hasFeaturesTab = Array.isArray(game.featuresList) && game.featuresList.length > 0;
        const hasUpdatesTab = Boolean(game.updateNotes && game.updateNotes.trim());
        const showSubtabs = hasGameplayTab || hasFeaturesTab || hasUpdatesTab;

        const btnState = Store.evaluateBuyButtonState(game);
        const isDefaultReleaseBadge =
          !game.badgeText ||
          /^official studio release/i.test(game.badgeText.trim());
        const badgeLabel =
          !btnState.isActive && btnState.schedule.isUnreleased && isDefaultReleaseBadge
            ? "Upcoming Release • Windows PC"
            : game.badgeText || "Official Studio Release • Windows PC";

        const subtitleLine =
          game.subtitle || game.modes || game.platform || "Windows PC (64-bit)";

        let actionButtonsHtml = "";
        if (btnState.isActive) {
          actionButtonsHtml = `
            <a href="${esc(btnState.itchHref)}" target="_blank" rel="noopener noreferrer" class="btn-primary">
              ${esc(btnState.buyLabel)}
            </a>
            <button type="button" class="btn-secondary" onclick="window.switchPage('studio')">
              Studio Info →
            </button>
          `;
        } else if (btnState.renderMode === "hidden") {
          actionButtonsHtml = `
            <button type="button" class="btn-secondary" onclick="window.switchPage('studio')">
              Studio Info →
            </button>
          `;
        } else {
          actionButtonsHtml = `
            <button type="button" class="btn-disabled" disabled aria-disabled="true" title="Game not available for purchase yet">
              <span>🔒</span>
              <span>${esc(btnState.disabledLabel)}</span>
            </button>
            <button type="button" class="btn-secondary" onclick="window.switchPage('studio')">
              Studio Info →
            </button>
          `;
        }

        const latestUpdatePreview =
          hasUpdatesTab
            ? `
              <div class="drev-update-callout">
                <strong>Latest Game Update ${game.version ? `• ${esc(game.version)}` : ""}</strong>
                <span>${esc(
                  game.updateNotes.length > 180
                    ? game.updateNotes.slice(0, 180).trim() + "..."
                    : game.updateNotes
                )}</span>
              </div>
            `
            : "";

        const displayReleaseLabel =
          game.releaseDate ||
          (btnState.schedule && btnState.schedule.formattedDate) ||
          (btnState.isActive ? "Available Now" : "Coming Soon");

        return `
          <div class="release-banner tilt-card drev-game-showcase" data-game-id="${esc(game.id)}">
            <div class="drev-game-left">
              <div>
                <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.65rem;margin-bottom:0.6rem;">
                  <div class="badge" style="margin-bottom:0;">
                    <span class="badge-dot"></span>
                    <span>${esc(badgeLabel)}</span>
                  </div>
                  ${
                    game.version
                      ? `<span class="drev-version-pill">${esc(game.version)}</span>`
                      : ""
                  }
                </div>

                <h3 class="game-title">${esc(game.title)}</h3>
                <div class="game-subtitle">${esc(subtitleLine)}</div>

                ${
                  showSubtabs
                    ? `
                  <div class="game-subtabs">
                    <button class="subtab-btn active" type="button" onclick="window.DrevalithPublicUI.tab(this, '${esc(game.id)}', 'overview')">Overview</button>
                    ${
                      hasGameplayTab
                        ? `<button class="subtab-btn" type="button" onclick="window.DrevalithPublicUI.tab(this, '${esc(game.id)}', 'gameplay')">Gameplay</button>`
                        : ""
                    }
                    ${
                      hasFeaturesTab
                        ? `<button class="subtab-btn" type="button" onclick="window.DrevalithPublicUI.tab(this, '${esc(game.id)}', 'features')">Key Features</button>`
                        : ""
                    }
                    ${
                      hasUpdatesTab
                        ? `<button class="subtab-btn" type="button" onclick="window.DrevalithPublicUI.tab(this, '${esc(game.id)}', 'updates')">Updates</button>`
                        : ""
                    }
                  </div>
                `
                    : ""
                }

                <div id="dyn-tab-box-${esc(game.id)}" class="subtab-content" style="min-height:105px;">
                  ${formatParagraphs(game.description)}
                </div>

                ${latestUpdatePreview}
              </div>

              <div class="drev-game-actions">
                ${actionButtonsHtml}
              </div>
            </div>

            <div class="release-preview">
              <div>
                ${
                  game.coverImageUrl
                    ? `<div class="drev-cover-frame">
                         <img src="${esc(game.coverImageUrl)}" alt="${esc(game.title)}" loading="lazy" />
                       </div>`
                    : `<div class="drev-cover-frame" style="display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-weight:800;letter-spacing:0.12em;">
                         DREVALITH GAMES™
                       </div>`
                }
              </div>

              <div class="specs-box">
                <div class="spec-row">
                  <span class="spec-label">Platform</span>
                  <span class="spec-val">${esc(game.platform || "Windows PC (64-bit)")}</span>
                </div>
                ${
                  game.modes || game.subtitle
                    ? `<div class="spec-row">
                         <span class="spec-label">Modes</span>
                         <span class="spec-val">${esc(game.modes || game.subtitle)}</span>
                       </div>`
                    : ""
                }
                ${
                  game.version
                    ? `<div class="spec-row">
                         <span class="spec-label">Version</span>
                         <span class="spec-val">${esc(game.version)}</span>
                       </div>`
                    : ""
                }
                <div class="spec-row">
                  <span class="spec-label">Release</span>
                  <span class="spec-val">${esc(displayReleaseLabel)}</span>
                </div>
                <div class="spec-row">
                  <span class="spec-label">Official Store</span>
                  <span class="spec-val accent">${btnState.isActive ? "Available on itch.io" : "Coming Soon"}</span>
                </div>
              </div>
            </div>
          </div>
        `;
      })
      .join("");

    attachTiltToDynamicCards(mount);
  }

  window.DrevalithPublicUI = {
    tab: switchDynamicTab
  };

  function bootCatalogUI() {
    injectShowcaseStyles();
    Store.subscribePublicStore((state) => {
      currentCatalogGames = (state && state.games) || [];
      catalogLoaded = Boolean(state && state.loaded);
      renderPublishedGames(catalogLoaded);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootCatalogUI);
  } else {
    bootCatalogUI();
  }
})();
