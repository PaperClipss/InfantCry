/* =====================================================================
   InfantCry — script.js  (matched to the FastAPI backend in app.py)

   Endpoints used
     POST /api/auth/signup      { Mail, Password }
     POST /api/auth/login       { Mail, Password }  ->  { token, email, level }
     GET  /api/auth/me                                ->  { email, level }
     POST /api/auth/logout
     POST /api/analysis         raw WAV bytes + X-Filename header
     GET  /api/analysis/history
     POST /api/feedback         { analysis_id, helpful, comment }
     GET  /api/admin/dashboard | /entries | /model-config | /feedback
   ===================================================================== */
(() => {
    "use strict";

    /* -----------------------------------------------------------------
       0. CONFIG
       ----------------------------------------------------------------- */
    const CONFIG = {
        // Same origin if the page is served by uvicorn on :8000,
        // otherwise call the API host on :8000 (adjust if you host elsewhere).
        API_BASE: https://kartheeks-macbook-air.tail573f01.ts.net/,

        MIN_PASSWORD_LENGTH: 6,             // must match MIN_PASSWORD_LENGTH in app.py
        MAX_UPLOAD_BYTES: 10 * 1024 * 1024, // must match MAX_UPLOAD_SIZE in app.py
        MAX_RECORD_SECONDS: 60,
        MIN_RECORD_SECONDS: 1,
        HISTORY_LIMIT: 20,
        ADMIN_ENTRIES_LIMIT: 25
    };

    const STORE = {
        theme: "infantcry-theme",
        token: "infantcry-token",
        user: "infantcry-user",
        history: "infantcry-history"
    };

    /* -----------------------------------------------------------------
       1. HELPERS
       ----------------------------------------------------------------- */
    const $ = (id) => document.getElementById(id);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    const store = {
        get(s, k) { try { return s.getItem(k); } catch { return null; } },
        set(s, k, v) { try { s.setItem(k, v); } catch { /* ignore */ } },
        remove(s, k) { try { s.removeItem(k); } catch { /* ignore */ } }
    };

    function el(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v === undefined || v === null) continue;
            if (k === "class") node.className = v;
            else if (k === "text") node.textContent = v;
            else node.setAttribute(k, v);
        }
        children.forEach((c) => node.append(c));
        return node;
    }

    const show = (n) => n && n.classList.remove("hidden");
    const hide = (n) => n && n.classList.add("hidden");

    function prettyLabel(label) {
        const text = String(label ?? "").replace(/[_-]+/g, " ").trim();
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Unknown";
    }

    function formatConfidence(v) {
        const n = Number(v);
        if (!Number.isFinite(n)) return "—";
        const pct = n <= 1 ? n * 100 : n;
        return `${pct.toFixed(1)}%`;
    }

    function formatDate(iso) {
        const d = new Date(iso);
        return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
    }

    function formatBytes(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

    function setBusy(button, busy, busyHtml) {
        if (!button) return;
        if (busy) {
            if (button.dataset.idleHtml === undefined) button.dataset.idleHtml = button.innerHTML;
            button.innerHTML = busyHtml;
            button.disabled = true;
        } else {
            if (button.dataset.idleHtml !== undefined) {
                button.innerHTML = button.dataset.idleHtml;
                delete button.dataset.idleHtml;
            }
            button.disabled = false;
        }
    }

    /* -----------------------------------------------------------------
       2. DOM
       ----------------------------------------------------------------- */
    const els = {
        loginPage: $("loginPage"),
        analysisPage: $("analysisPage"),
        adminPage: $("adminPage"),

        landingBrandLink: $("landingBrandLink"),
        loginForm: $("loginForm"),
        username: $("username"),
        password: $("password"),
        togglePassword: $("togglePassword"),
        loginError: $("loginError"),

        profileTrigger: $("logoutButton"),
        profileTriggerAvatar: $("profileTriggerAvatar"),
        profileTriggerName: $("profileTriggerName"),
        profileMenuUsername: $("profileMenuUsername"),
        profileMenuProfile: $("profileMenuProfile"),
        profileMenuPassword: $("profileMenuPassword"),
        profileMenuLogout: $("profileMenuLogout"),
        passwordDialog: $("passwordChangeDialog"),
        passwordDialogClose: $("passwordDialogClose"),
        loggedInUser: $("loggedInUser"),

        jumpToAudio: $("jumpToAudio"),
        recordButton: $("recordButton"),
        recordTime: $("recordTime"),
        audioFile: $("audioFile"),
        selectedFile: $("selectedFile"),
        audioSection: $("audioSection"),
        audioName: $("audioName"),
        audioPlayer: $("audioPlayer"),
        removeAudio: $("removeAudio"),
        analyzeButton: $("analyzeButton"),
        analyzeMessage: $("analyzeMessage"),
        loadingBox: $("loadingBox"),
        resultBox: $("resultBox"),
        predictionText: $("predictionText"),

        feedbackYes: $("feedbackYes"),
        feedbackNo: $("feedbackNo"),
        feedbackYesForm: $("feedbackYesForm"),
        feedbackNoForm: $("feedbackNoForm"),
        feedbackYesText: $("feedbackYesText"),
        feedbackNoText: $("feedbackNoText"),
        submitYesFeedback: $("submitYesFeedback"),
        submitNoFeedback: $("submitNoFeedback"),
        feedbackSuccess: $("feedbackSuccess"),

        sessionHistory: $("sessionHistory"),
        profileAvatar: $("profileAvatar"),
        profileName: $("profileName"),
        profileUsername: $("profileUsername"),

        refreshEntriesButton: $("refreshEntriesButton")
    };

    const DEFAULT_ANALYZE_MESSAGE = els.analyzeMessage ? els.analyzeMessage.textContent.trim() : "";
    const EMPTY_HISTORY_HTML = els.sessionHistory ? els.sessionHistory.innerHTML : "";

    /* -----------------------------------------------------------------
       3. STATE
       ----------------------------------------------------------------- */
    const state = {
        token: store.get(localStorage, STORE.token),
        user: null,           // { email, display, level }
        theme: "dark",
        view: "home",
        audio: null,          // { blob, name }
        analyzing: false,
        lastAnalysisId: null,
        feedbackDone: false,
        history: [],
        admin: { yes: 0, no: 0, distribution: {}, classes: [] }
    };

    /* -----------------------------------------------------------------
       4. INJECTED STYLES (toast + signup bits)
       ----------------------------------------------------------------- */
    function injectStyles() {
        if ($("infantcry-injected-styles")) return;
        const css = `
        .ic-toast {
            position: fixed; left: 50%; bottom: 28px; z-index: 1000; max-width: min(92vw, 460px);
            padding: 12px 18px; border: 1px solid var(--ic-line2, rgba(145,180,204,.27)); border-radius: 12px;
            background: var(--ic-surface2, #152d41); color: var(--ic-text, #f1f6fb);
            font: 600 13px "DM Sans", sans-serif;
            box-shadow: 0 14px 36px rgba(0, 0, 0, .35);
            opacity: 0; transform: translate(-50%, 16px); pointer-events: none;
            transition: opacity .22s ease, transform .22s ease;
        }
        .ic-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
        .ic-toast.is-error { border-color: #ff7a93; }
        #loginPage .login-signup-prompt span[role="button"] { cursor: pointer; }
        #loginPage .login-signup-prompt span[role="button"]:hover { text-decoration: underline; }
        #loginPage .login-signup-prompt span[role="button"]:focus-visible { outline: 2px solid #8fc6fa; outline-offset: 3px; border-radius: 4px; }
        .admin-feedback-item .admin-feedback-meta { font-size: 11px; opacity: .85; }
        `;
        document.head.appendChild(el("style", { id: "infantcry-injected-styles", text: css }));
    }

    /* -----------------------------------------------------------------
       5. TOAST
       ----------------------------------------------------------------- */
    let toastNode = null, toastTimer = null;
    function showToast(message, type = "info") {
        if (!toastNode) {
            toastNode = el("div", { class: "ic-toast", role: "status", "aria-live": "polite" });
            document.body.appendChild(toastNode);
        }
        toastNode.textContent = message;
        toastNode.classList.toggle("is-error", type === "error");
        void toastNode.offsetWidth;
        toastNode.classList.add("is-visible");
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastNode.classList.remove("is-visible"), 3800);
    }

    /* -----------------------------------------------------------------
       6. API LAYER
       ----------------------------------------------------------------- */
    class ApiError extends Error {
        constructor(message, status = 0, data = null) { super(message); this.status = status; this.data = data; }
    }

    function extractDetail(data) {
        if (!data) return "";
        if (typeof data === "string") return data;
        const detail = data.detail;
        if (typeof detail === "string") return detail;
        if (Array.isArray(detail)) return detail.map((d) => d.msg || "").filter(Boolean).join(". ");
        return "";
    }

    /**
     * @param {string} path
     * @param {{method?:string, json?:any, body?:BodyInit, headers?:Object, auth?:boolean, signal?:AbortSignal}} options
     *        auth:false => 401 does not trigger "session expired"
     */
    async function api(path, { method = "GET", json, body, headers = {}, auth = true, signal } = {}) {
        const init = { method, credentials: "include", headers: { ...headers }, signal };
        if (state.token) init.headers.Authorization = `Bearer ${state.token}`;
        if (json !== undefined) {
            init.headers["Content-Type"] = "application/json";
            init.body = JSON.stringify(json);
        } else if (body !== undefined) {
            init.body = body;
        }

        let response;
        try {
            response = await fetch(CONFIG.API_BASE + path, init);
        } catch {
            throw new ApiError("Can't reach the server. Please check that the backend is running on port 8000.", 0);
        }

        let data = null;
        const text = await response.text();
        if (text) {
            try { data = JSON.parse(text); } catch { data = text; }
        }

        if (!response.ok) {
            if (response.status === 401 && auth) handleSessionExpired();
            throw new ApiError(extractDetail(data) || `Request failed (${response.status}).`, response.status, data);
        }
        return data;
    }

    /* -----------------------------------------------------------------
       7. PROFILE DROPDOWNS (user + admin)
       ----------------------------------------------------------------- */
    const menus = [];
    const adminMenuNodes = { names: [], initials: [] };

    const isMenuOpen = (m) => !m.dropdown.classList.contains("hidden");

    function setMenuOpen(m, open, { returnFocus = false } = {}) {
        m.dropdown.classList.toggle("hidden", !open);
        m.trigger.setAttribute("aria-expanded", String(open));
        if (open) {
            const first = m.dropdown.querySelector(".profile-menu-item");
            if (first) first.focus({ preventScroll: true });
        } else if (returnFocus) m.trigger.focus();
    }

    function closeAllMenus(returnFocus = false) {
        menus.forEach((m) => { if (isMenuOpen(m)) setMenuOpen(m, false, { returnFocus }); });
    }

    function openPasswordDialog() {
        const d = els.passwordDialog;
        if (!d) return;
        if (typeof d.showModal === "function") { if (!d.open) d.showModal(); }
        else showToast("Changing your password isn't available yet.");
    }

    function runMenuAction(action) {
        closeAllMenus();
        if (action === "profile") showView("profile");
        else if (action === "password") openPasswordDialog();
        else if (action === "logout") logout();
    }

    function registerMenu(wrap) {
        if (!wrap) return;
        const trigger = wrap.querySelector(".reference-profile");
        const dropdown = wrap.querySelector(".profile-dropdown");
        if (!trigger || !dropdown) return;
        const menu = { wrap, trigger, dropdown };
        menus.push(menu);

        trigger.addEventListener("click", (event) => {
            event.stopPropagation();
            const willOpen = !isMenuOpen(menu);
            closeAllMenus();
            if (willOpen) setMenuOpen(menu, true);
        });

        dropdown.addEventListener("click", (event) => {
            const item = event.target.closest("[data-menu-action]");
            if (item) runMenuAction(item.dataset.menuAction);
        });

        dropdown.addEventListener("keydown", (event) => {
            const items = $$(".profile-menu-item", dropdown);
            const index = items.indexOf(document.activeElement);
            if (event.key === "ArrowDown") { event.preventDefault(); items[(index + 1) % items.length].focus(); }
            if (event.key === "ArrowUp")   { event.preventDefault(); items[(index - 1 + items.length) % items.length].focus(); }
        });
    }

    function buildAdminMenu() {
        if (!els.adminPage) return;
        const area = els.adminPage.querySelector(".user-area");
        if (!area) return;
        ["loggedInAdmin", "adminLogoutButton"].forEach((id) => {
            const node = $(id);
            if (node && area.contains(node)) node.remove();
        });

        const wrap = el("div", { class: "profile-menu-wrap" });
        wrap.innerHTML =
            '<button type="button" class="reference-profile" aria-haspopup="true" aria-expanded="false" aria-label="Account menu">' +
                '<span class="reference-avatar" data-admin-initial>A</span>' +
                '<span data-admin-name>Admin</span>' +
                '<span class="theme-chevron" aria-hidden="true">⌄</span>' +
            '</button>' +
            '<div class="profile-dropdown hidden" role="menu">' +
                '<div class="profile-dropdown-heading"><strong data-admin-name>Admin</strong><small>InfantCry administrator</small></div>' +
                '<button type="button" class="profile-menu-item" role="menuitem" data-menu-action="password"><span aria-hidden="true">♧</span> Change password</button>' +
                '<div class="profile-menu-divider"></div>' +
                '<button type="button" class="profile-menu-item profile-menu-logout" role="menuitem" data-menu-action="logout"><span aria-hidden="true">↪</span> Log out</button>' +
            '</div>';
        area.appendChild(wrap);
        adminMenuNodes.names = $$("[data-admin-name]", wrap);
        adminMenuNodes.initials = $$("[data-admin-initial]", wrap);
        registerMenu(wrap);
    }

    function wireProfileMenus() {
        const actionById = { profileMenuProfile: "profile", profileMenuPassword: "password", profileMenuLogout: "logout" };
        Object.entries(actionById).forEach(([id, action]) => {
            const node = $(id);
            if (node) node.dataset.menuAction = action;
        });
        if (els.profileTrigger) registerMenu(els.profileTrigger.closest(".profile-menu-wrap"));
        buildAdminMenu();

        document.addEventListener("click", (e) => { if (!e.target.closest(".profile-menu-wrap")) closeAllMenus(); });
        document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAllMenus(true); });

        if (els.passwordDialogClose) els.passwordDialogClose.addEventListener("click", () => els.passwordDialog.close());
        if (els.passwordDialog) els.passwordDialog.addEventListener("click", (e) => {
            if (e.target === els.passwordDialog) els.passwordDialog.close();
        });
    }

    function updateUserDisplays() {
        const display = state.user ? state.user.display : "User";
        const initial = display.trim().charAt(0).toUpperCase() || "U";
        const set = (n, v) => { if (n) n.textContent = v; };

        set(els.profileTriggerName, display);
        set(els.profileTriggerAvatar, initial);
        set(els.profileMenuUsername, display);
        set(els.loggedInUser, display);
        adminMenuNodes.names.forEach((n) => set(n, display));
        adminMenuNodes.initials.forEach((n) => set(n, initial));
        set(els.profileAvatar, initial);
        set(els.profileName, display);
        set(els.profileUsername, display);
    }

    /* -----------------------------------------------------------------
       8. THEME
       ----------------------------------------------------------------- */
    function ensureLightThemeStylesheet() {
        const present = $$('link[rel="stylesheet"]').some((l) => /light-theme\.css/.test(l.getAttribute("href") || ""));
        if (!present) document.head.appendChild(el("link", { rel: "stylesheet", href: "./light-theme.css" }));
    }

    function makeThemeToggle(extra = "") {
        const b = el("button", { type: "button", class: `ic-theme-toggle ${extra}`.trim(), "data-theme-toggle": "" });
        b.innerHTML = '<span class="theme-icon" aria-hidden="true">☾</span><span class="theme-label">Dark mode</span>';
        return b;
    }

    function injectThemeToggles() {
        els.loginPage.appendChild(makeThemeToggle("ic-theme-toggle--floating"));
        [els.analysisPage, els.adminPage].forEach((page) => {
            if (!page) return;
            const area = page.querySelector(".user-area");
            if (!area) return;
            const menuWrap = area.querySelector(".profile-menu-wrap");
            const toggle = makeThemeToggle();
            if (menuWrap) area.insertBefore(toggle, menuWrap);
            else area.prepend(toggle);
        });
    }

    function applyTheme(theme, { persist = true } = {}) {
        state.theme = theme === "light" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", state.theme);
        if (persist) store.set(localStorage, STORE.theme, state.theme);

        const toDark = state.theme === "light";
        $$("[data-theme-toggle]").forEach((b) => {
            const icon = b.querySelector(".theme-icon");
            const label = b.querySelector(".theme-label");
            if (icon) icon.textContent = toDark ? "☾" : "☀";
            if (label) label.textContent = toDark ? "Dark mode" : "Light mode";
            b.setAttribute("aria-label", toDark ? "Switch to dark mode" : "Switch to light mode");
        });

        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute("content", state.theme === "dark" ? "#081725" : "#eef3f8");

        if (state.user && state.user.level === "admin") renderCharts();
    }

    function initTheme() {
        ensureLightThemeStylesheet();
        injectThemeToggles();
        const saved = store.get(localStorage, STORE.theme);
        applyTheme(saved === "light" ? "light" : "dark", { persist: false });
        document.addEventListener("click", (e) => {
            if (e.target.closest("[data-theme-toggle]")) applyTheme(state.theme === "dark" ? "light" : "dark");
        });
    }

    /* -----------------------------------------------------------------
       9. NAVIGATION
       ----------------------------------------------------------------- */
    function showView(name) {
        state.view = name;
        $$("[data-page-section]").forEach((s) => s.classList.toggle("hidden", s.dataset.pageSection !== name));
        $$(".sidebar-link[data-view-link]").forEach((b) => b.classList.toggle("is-active", b.dataset.viewLink === name));
        updateUserDisplays();
        window.scrollTo({ top: 0 });
    }

    /* -----------------------------------------------------------------
       10. AUTH (login + signup in one card)
       ----------------------------------------------------------------- */
    const authUi = { mode: "login", confirmGroup: null, confirmInput: null, prompt: null, utilityRow: null };

    function setLoginError(msg) { if (els.loginError) els.loginError.textContent = msg || ""; }

    function buildAuthUi() {
        const card = els.loginPage.querySelector(".reference-login-card") || els.loginPage;
        const passwordGroup = els.password.closest(".form-group");

        const group = el("div", { class: "form-group hidden" });
        group.innerHTML =
            '<label for="confirmPassword">Confirm password</label>' +
            '<div class="reference-input"><span aria-hidden="true" class="input-icon">♙</span>' +
            '<input type="password" id="confirmPassword" placeholder="Re-enter your password" autocomplete="new-password"></div>';
        passwordGroup.after(group);
        authUi.confirmGroup = group;
        authUi.confirmInput = group.querySelector("input");

        authUi.utilityRow = card.querySelector(".login-utility-row");
        authUi.prompt = card.querySelector(".login-signup-prompt");
        if (authUi.prompt) {
            authUi.prompt.addEventListener("click", (e) => { if (e.target.closest("[data-auth-switch]")) toggleAuthMode(); });
            authUi.prompt.addEventListener("keydown", (e) => {
                if ((e.key === "Enter" || e.key === " ") && e.target.closest("[data-auth-switch]")) {
                    e.preventDefault();
                    toggleAuthMode();
                }
            });
        }
    }

    function toggleAuthMode() { setAuthMode(authUi.mode === "login" ? "signup" : "login"); els.username.focus(); }

    function setAuthMode(mode) {
        const isSignup = mode === "signup";
        authUi.mode = isSignup ? "signup" : "login";

        const card = els.loginPage.querySelector(".reference-login-card") || els.loginPage;
        const heading = card.querySelector(".brand h1");
        const sub = card.querySelector(".brand p");
        if (heading) heading.textContent = isSignup ? "Create your account" : "Welcome back";
        if (sub) sub.textContent = isSignup ? "Sign up to start using InfantCry." : "Sign in to continue to InfantCry.";

        const submit = els.loginForm.querySelector('button[type="submit"]');
        if (submit) submit.innerHTML = (isSignup ? "Create account" : "Sign in") + ' <span aria-hidden="true">→</span>';

        authUi.confirmGroup.classList.toggle("hidden", !isSignup);
        authUi.confirmInput.value = "";
        if (authUi.utilityRow) authUi.utilityRow.classList.toggle("hidden", isSignup);
        els.password.setAttribute("autocomplete", isSignup ? "new-password" : "current-password");

        if (authUi.prompt) {
            authUi.prompt.innerHTML = isSignup
                ? 'Already have an account? <span role="button" tabindex="0" data-auth-switch>Sign in</span>'
                : 'Don\'t have an account? <span role="button" tabindex="0" data-auth-switch>Sign up</span>';
        }
        setLoginError("");
    }

    function displayFromEmail(email) {
        return String(email || "").split("@")[0] || "User";
    }

    function friendlyLoginError(error) {
        if (error.status === 401) return "Invalid email or password.";
        if (error.status === 422) return "Please enter a valid email address.";
        return error.message || "Something went wrong. Please try again.";
    }

    function friendlySignupError(error) {
        if (error.status === 409) return "An account already exists for this email. Please sign in instead.";
        if (error.status === 422) return "Please enter a valid email address.";
        if (error.status === 400) return error.message || "Please check your details and try again.";
        return error.message || "We couldn't create your account. Please try again.";
    }

    async function handleAuthSubmit(event) {
        event.preventDefault();
        setLoginError("");

        const isSignup = authUi.mode === "signup";
        const email = els.username.value.trim();
        const password = els.password.value;

        if (!email || !password) { setLoginError("Please enter your email and password."); return; }
        if (isSignup) {
            if (password.length < CONFIG.MIN_PASSWORD_LENGTH) {
                setLoginError(`Please choose a password with at least ${CONFIG.MIN_PASSWORD_LENGTH} characters.`);
                return;
            }
            if (password !== authUi.confirmInput.value) {
                setLoginError("The two passwords don't match.");
                return;
            }
        }

        const submit = els.loginForm.querySelector('button[type="submit"]');
        setBusy(submit, true, isSignup ? "Creating account…" : "Signing in…");
        try {
            if (isSignup) {
                try {
                    await api("/api/auth/signup", { method: "POST", json: { Mail: email, Password: password }, auth: false });
                } catch (error) {
                    if (error.status === 409) setAuthMode("login");
                    setLoginError(friendlySignupError(error));
                    return;
                }
                showToast("Account created. Signing you in…");
            }

            const data = await api("/api/auth/login", { method: "POST", json: { Mail: email, Password: password }, auth: false });
            if (!data || !data.token) throw new ApiError("The server didn't return a session token.", 0);
            if (!["admin", "normal"].includes(data.level)) throw new ApiError("The server returned an unexpected account level.", 0);

            state.token = data.token;
            store.set(localStorage, STORE.token, data.token);
            els.loginForm.reset();
            enterApp({ email: data.email, level: data.level });
        } catch (error) {
            setLoginError(isSignup ? friendlySignupError(error) : friendlyLoginError(error));
        } finally {
            setBusy(submit, false);
        }
    }

    /* -----------------------------------------------------------------
       11. ENTER / LEAVE
       ----------------------------------------------------------------- */
    async function enterApp({ email, level }) {
        state.user = { email, level, display: displayFromEmail(email) };
        store.set(localStorage, STORE.user, JSON.stringify({ email, level }));

        setAuthMode("login");
        hide(els.loginPage);
        const isAdmin = level === "admin";
        els.analysisPage.classList.toggle("hidden", isAdmin);
        els.adminPage.classList.toggle("hidden", !isAdmin);

        updateUserDisplays();
        if (isAdmin) {
            await loadAdminData();
        } else {
            await loadServerHistory();
            clearAudio();
            showView("home");
        }
        window.scrollTo({ top: 0 });
    }

    function resetToLogin() {
        state.token = null;
        state.user = null;
        state.lastAnalysisId = null;
        state.history = [];
        store.remove(localStorage, STORE.token);
        store.remove(localStorage, STORE.user);
        store.remove(sessionStorage, STORE.history);

        clearAudio();
        renderHistory();
        destroyCharts();
        closeAllMenus();
        if (els.passwordDialog && els.passwordDialog.open) els.passwordDialog.close();

        hide(els.analysisPage);
        hide(els.adminPage);
        show(els.loginPage);
        setAuthMode("login");
        window.scrollTo({ top: 0 });
    }

    let sessionExpiredHandled = false;
    function handleSessionExpired() {
        if (!state.user || sessionExpiredHandled) return;
        sessionExpiredHandled = true;
        resetToLogin();
        showToast("Your session has ended. Please sign in again.", "error");
        setTimeout(() => { sessionExpiredHandled = false; }, 500);
    }

    async function logout() {
        try { await api("/api/auth/logout", { method: "POST", auth: false }); }
        catch (error) { if (error.status === 0) showToast(error.message, "error"); }
        resetToLogin();
    }

    async function restoreSession() {
        if (!state.token) return false;
        try {
            const me = await api("/api/auth/me", { auth: false });
            if (!me || !me.level) return false;
            state.user = { email: me.email, level: me.level, display: displayFromEmail(me.email) };
            const isAdmin = me.level === "admin";
            hide(els.loginPage);
            els.analysisPage.classList.toggle("hidden", isAdmin);
            els.adminPage.classList.toggle("hidden", !isAdmin);
            updateUserDisplays();
            if (isAdmin) await loadAdminData();
            else { await loadServerHistory(); clearAudio(); showView("home"); }
            return true;
        } catch (error) {
            if (error.status === 401) {
                state.token = null;
                store.remove(localStorage, STORE.token);
                store.remove(localStorage, STORE.user);
            }
            return false;
        }
    }

    /* -----------------------------------------------------------------
       12. AUDIO: record → WAV, upload, preview
       ----------------------------------------------------------------- */
    function setAnalyzeMessage(text) { if (els.analyzeMessage) els.analyzeMessage.textContent = text; }

    function setAudio(blob, name) {
        state.audio = { blob, name };
        if (els.audioPlayer) els.audioPlayer.src = URL.createObjectURL(blob);
        if (els.audioName) els.audioName.textContent = name;
        if (els.selectedFile) els.selectedFile.textContent = `${name} · ${formatBytes(blob.size)}`;
        show(els.audioSection);
        if (els.analyzeButton) els.analyzeButton.disabled = false;
        setAnalyzeMessage("Ready to analyze.");
        hide(els.resultBox);
        hide(els.loadingBox);
        resetFeedbackUi();
    }

    function clearAudio() {
        if (state.audio && els.audioPlayer && els.audioPlayer.src) URL.revokeObjectURL(els.audioPlayer.src);
        state.audio = null;
        if (els.audioPlayer) { els.audioPlayer.pause(); els.audioPlayer.removeAttribute("src"); els.audioPlayer.load(); }
        if (els.audioFile) els.audioFile.value = "";
        if (els.selectedFile) els.selectedFile.textContent = "No file selected";
        if (els.recordTime && !recorder.active) els.recordTime.textContent = "00:00";
        hide(els.audioSection);
        hide(els.resultBox);
        hide(els.loadingBox);
        if (els.analyzeButton) els.analyzeButton.disabled = true;
        setAnalyzeMessage(DEFAULT_ANALYZE_MESSAGE);
        resetFeedbackUi();
    }

    function encodeWav(audioBuffer) {
        const length = audioBuffer.length;
        const channels = audioBuffer.numberOfChannels;
        const sampleRate = audioBuffer.sampleRate;
        const mono = new Float32Array(length);
        for (let c = 0; c < channels; c++) {
            const data = audioBuffer.getChannelData(c);
            for (let i = 0; i < length; i++) mono[i] += data[i] / channels;
        }
        const view = new DataView(new ArrayBuffer(44 + length * 2));
        const w = (off, txt) => { for (let i = 0; i < txt.length; i++) view.setUint8(off + i, txt.charCodeAt(i)); };
        w(0, "RIFF"); view.setUint32(4, 36 + length * 2, true); w(8, "WAVE"); w(12, "fmt ");
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
        view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        w(36, "data"); view.setUint32(40, length * 2, true);
        for (let i = 0; i < length; i++) {
            const s = Math.max(-1, Math.min(1, mono[i]));
            view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        }
        return new Blob([view], { type: "audio/wav" });
    }

    async function blobToWav(blob) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        const ctx = new AudioCtx();
        try {
            const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
            return encodeWav(decoded);
        } finally { if (ctx.close) ctx.close(); }
    }

    const recorder = { active: false, mediaRecorder: null, stream: null, chunks: [], startedAt: 0, timer: null };
    const pad = (n) => String(n).padStart(2, "0");
    function renderRecordTime(seconds) {
        const s = Math.floor(seconds);
        if (els.recordTime) els.recordTime.textContent = `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
    }

    async function startRecording() {
        if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
            setAnalyzeMessage("Recording isn't supported in this browser. Please upload a WAV file instead.");
            return;
        }
        let stream;
        try {
            stream = await navigator.mediaDevices.getUserMedia({
                audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
            });
        } catch (error) {
            setAnalyzeMessage(error && error.name === "NotAllowedError"
                ? "Microphone access was blocked. Allow it in your browser settings or upload a WAV file."
                : "No microphone could be started. Please upload a WAV file instead.");
            return;
        }

        recorder.stream = stream;
        recorder.chunks = [];
        recorder.mediaRecorder = new MediaRecorder(stream);
        recorder.mediaRecorder.ondataavailable = (e) => { if (e.data && e.data.size) recorder.chunks.push(e.data); };
        recorder.mediaRecorder.onstop = finishRecording;
        recorder.mediaRecorder.start();

        recorder.active = true;
        recorder.startedAt = performance.now();
        renderRecordTime(0);
        if (els.recordButton) { els.recordButton.textContent = "Stop Recording"; els.recordButton.classList.add("recording"); }
        if (els.analyzeButton) els.analyzeButton.disabled = true;
        setAnalyzeMessage("Recording… press Stop when you're done.");

        recorder.timer = setInterval(() => {
            const elapsed = (performance.now() - recorder.startedAt) / 1000;
            renderRecordTime(elapsed);
            if (elapsed >= CONFIG.MAX_RECORD_SECONDS) stopRecording();
        }, 250);
    }

    function stopRecording() {
        if (recorder.mediaRecorder && recorder.mediaRecorder.state === "recording") recorder.mediaRecorder.stop();
    }

    async function finishRecording() {
        clearInterval(recorder.timer);
        if (recorder.stream) recorder.stream.getTracks().forEach((t) => t.stop());

        const elapsed = (performance.now() - recorder.startedAt) / 1000;
        recorder.active = false;
        if (els.recordButton) { els.recordButton.classList.remove("recording"); els.recordButton.textContent = "Processing…"; els.recordButton.disabled = true; }

        try {
            if (elapsed < CONFIG.MIN_RECORD_SECONDS) {
                setAnalyzeMessage("That recording was too short. Please record at least a second or two.");
                if (els.analyzeButton) els.analyzeButton.disabled = !state.audio;
                return;
            }
            const raw = new Blob(recorder.chunks, { type: recorder.mediaRecorder.mimeType || "audio/webm" });
            const wav = await blobToWav(raw);
            if (wav.size > CONFIG.MAX_UPLOAD_BYTES) throw new Error("too large");
            const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
            setAudio(wav, `recording-${stamp}.wav`);
        } catch {
            setAnalyzeMessage("We couldn't process that recording. Please try again or upload a WAV file.");
            if (els.analyzeButton) els.analyzeButton.disabled = !state.audio;
        } finally {
            if (els.recordButton) { els.recordButton.disabled = false; els.recordButton.textContent = "Start Recording"; }
            recorder.chunks = [];
        }
    }

    async function isRealWav(file) {
        try {
            const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
            const t = (a, b) => String.fromCharCode(...head.slice(a, b));
            return t(0, 4) === "RIFF" && t(8, 12) === "WAVE";
        } catch { return false; }
    }

    async function handleFileChosen() {
        const file = els.audioFile.files && els.audioFile.files[0];
        if (!file) return;
        const looksWav = /\.wav$/i.test(file.name) || /wav/i.test(file.type);
        let problem = "";
        if (!looksWav) problem = "Please choose a WAV file (.wav).";
        else if (file.size === 0) problem = "That file is empty.";
        else if (file.size > CONFIG.MAX_UPLOAD_BYTES) problem = `That file is too large (limit ${formatBytes(CONFIG.MAX_UPLOAD_BYTES)}).`;
        else if (!(await isRealWav(file))) problem = "That doesn't look like a valid WAV file.";
        els.audioFile.value = "";
        if (problem) { els.selectedFile.textContent = problem; setAnalyzeMessage(problem); return; }
        setAudio(file, file.name);
    }

    /* -----------------------------------------------------------------
       13. ANALYSIS
       ----------------------------------------------------------------- */
    async function analyze() {
        if (!state.audio || state.analyzing) return;
        state.analyzing = true;

        hide(els.resultBox); show(els.loadingBox);
        if (els.analyzeButton) els.analyzeButton.disabled = true;
        if (els.recordButton) els.recordButton.disabled = true;
        setAnalyzeMessage("Analyzing…");

        try {
            const data = await api("/api/analysis", {
                method: "POST",
                body: state.audio.blob,                                  // raw bytes
                headers: {
                    "Content-Type": "audio/wav",
                    "X-Filename": encodeURIComponent(state.audio.name)    // app.py reads this header
                }
            });

            const label = data?.prediction?.label;
            if (label === undefined || label === null) throw new ApiError("The server returned an unexpected response.");
            const confidence = data?.prediction?.confidence;

            state.lastAnalysisId = data.analysis_id || null;
            showResult(label);

            await loadServerHistory();    // server is the source of truth
            setAnalyzeMessage("Analysis complete. You can analyze again anytime.");
            // Keep confidence on the object for the admin table's benefit (not displayed to user).
            els.resultBox.dataset.confidence = formatConfidence(confidence);
        } catch (error) {
            setAnalyzeMessage(error.message || "Analysis failed. Please try again.");
        } finally {
            hide(els.loadingBox);
            state.analyzing = false;
            if (els.analyzeButton) els.analyzeButton.disabled = !state.audio;
            if (els.recordButton) els.recordButton.disabled = false;
        }
    }

    function showResult(label) {
        if (els.predictionText) els.predictionText.textContent = prettyLabel(label);
        resetFeedbackUi();
        show(els.resultBox);
        els.resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    /* -----------------------------------------------------------------
       14. FEEDBACK
       ----------------------------------------------------------------- */
    function resetFeedbackUi() {
        state.feedbackDone = false;
        [els.feedbackYes, els.feedbackNo].forEach((b) => {
            if (!b) return;
            b.disabled = false;
            b.classList.remove("selected", "selected-yes", "selected-no");
        });
        hide(els.feedbackYesForm); hide(els.feedbackNoForm); hide(els.feedbackSuccess);
        if (els.feedbackYesText) els.feedbackYesText.value = "";
        if (els.feedbackNoText) els.feedbackNoText.value = "";
    }

    function chooseFeedback(isYes) {
        if (state.feedbackDone) return;
        els.feedbackYes.classList.toggle("selected", isYes);
        els.feedbackYes.classList.toggle("selected-yes", isYes);
        els.feedbackNo.classList.toggle("selected", !isYes);
        els.feedbackNo.classList.toggle("selected-no", !isYes);
        els.feedbackYesForm.classList.toggle("hidden", !isYes);
        els.feedbackNoForm.classList.toggle("hidden", isYes);
        (isYes ? els.feedbackYesText : els.feedbackNoText).focus();
    }

    async function submitFeedback(helpful) {
        if (state.feedbackDone) return;
        if (!state.lastAnalysisId) {
            showToast("Please run an analysis first so the feedback can be attached to it.", "error");
            return;
        }
        const button = helpful ? els.submitYesFeedback : els.submitNoFeedback;
        const textarea = helpful ? els.feedbackYesText : els.feedbackNoText;
        const comment = textarea.value.trim();

        setBusy(button, true, "Sending…");
        try {
            await api("/api/feedback", {
                method: "POST",
                json: { analysis_id: state.lastAnalysisId, helpful, comment: comment || null }
            });
            state.feedbackDone = true;
            hide(els.feedbackYesForm); hide(els.feedbackNoForm);
            els.feedbackYes.disabled = true;
            els.feedbackNo.disabled = true;
            show(els.feedbackSuccess);
        } catch (error) {
            showToast(error.message || "We couldn't send your feedback. Please try again.", "error");
        } finally {
            setBusy(button, false);
        }
    }

    /* -----------------------------------------------------------------
       15. HISTORY (server-backed)
       ----------------------------------------------------------------- */
    async function loadServerHistory() {
        try {
            const data = await api(`/api/analysis/history?limit=${CONFIG.HISTORY_LIMIT}`);
            state.history = Array.isArray(data?.entries) ? data.entries : [];
            store.set(sessionStorage, STORE.history, JSON.stringify(state.history));
        } catch {
            try {
                const cached = JSON.parse(store.get(sessionStorage, STORE.history) || "[]");
                state.history = Array.isArray(cached) ? cached : [];
            } catch { state.history = []; }
        }
        renderHistory();
    }

    function renderHistory() {
        if (!els.sessionHistory) return;
        if (!state.history.length) { els.sessionHistory.innerHTML = EMPTY_HISTORY_HTML; return; }

        const items = state.history.map((item) => el("article", { class: "history-item" },
            el("span", { class: "history-item-icon", "aria-hidden": "true", text: "◉" }),
            el("div", {},
                el("h3", { text: prettyLabel(item.prediction) }),
                el("p", { text: `${item.filename || "audio.wav"} · ${formatDate(item.timestamp)}` })
            )
        ));
        els.sessionHistory.replaceChildren(...items);
    }

    /* -----------------------------------------------------------------
       16. ADMIN DASHBOARD
       ----------------------------------------------------------------- */
    const charts = { feedback: null, prediction: null };
    const CHART_COLORS = ["#477cff", "#34d3a0", "#ff9bb2", "#ffb86b", "#b79cff", "#5fd0ff", "#f3d36b"];
    const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

    function destroyCharts() {
        Object.keys(charts).forEach((k) => { if (charts[k]) { charts[k].destroy(); charts[k] = null; } });
    }

    function renderCharts() {
        destroyCharts();
        const feedbackNotice = $("feedbackChartNotice");
        const predictionNotice = $("predictionChartNotice");

        if (typeof Chart === "undefined") {
            if (feedbackNotice) feedbackNotice.textContent = "The chart library couldn't be loaded.";
            if (predictionNotice) predictionNotice.textContent = "The chart library couldn't be loaded.";
            return;
        }

        const muted = cssVar("--ic-muted") || "#a9bdce";
        const line = cssVar("--ic-line") || "rgba(145,180,204,.16)";
        const surface = cssVar("--ic-surface") || "#112538";
        Chart.defaults.font.family = "'DM Sans', sans-serif";

        const { yes, no } = state.admin;
        if (yes + no === 0) {
            if (feedbackNotice) feedbackNotice.textContent = "No feedback has been submitted yet.";
        } else {
            charts.feedback = new Chart($("feedbackChart"), {
                type: "pie",
                data: { labels: ["Yes", "No"], datasets: [{ data: [yes, no], backgroundColor: ["#34d3a0", "#ff7a93"], borderColor: surface, borderWidth: 2 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: muted, padding: 16 } } } }
            });
            const pct = Math.round((yes / (yes + no)) * 100);
            if (feedbackNotice) feedbackNotice.textContent = `${yes} yes · ${no} no — ${pct}% found the prediction helpful.`;
        }

        const distribution = state.admin.distribution || {};
        const keys = Array.from(new Set([...(state.admin.classes || []), ...Object.keys(distribution)]));
        const total = keys.reduce((s, k) => s + (distribution[k] || 0), 0);

        charts.prediction = new Chart($("predictionClassChart"), {
            type: "bar",
            data: {
                labels: keys.map(prettyLabel),
                datasets: [{
                    label: "Analyses",
                    data: keys.map((k) => distribution[k] || 0),
                    backgroundColor: keys.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
                    borderRadius: 8, maxBarThickness: 64
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: muted }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { color: muted, precision: 0 }, grid: { color: line } }
                }
            }
        });
        if (predictionNotice) predictionNotice.textContent = total
            ? `${total} analyses across ${keys.length} classes.`
            : "No analyses have been recorded yet.";
    }

    function setStat(valueId, value, note) {
        const v = $(valueId);
        if (!v) return;
        v.textContent = value;
        const noteNode = v.nextElementSibling;
        if (noteNode && note !== undefined) noteNode.textContent = note;
    }

    function renderEntries(entries, total) {
        const body = $("recentEntriesBody");
        const notice = $("entriesDataNotice");
        const sorted = [...entries].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
        const recent = sorted.filter((e) => new Date(e.timestamp).getTime() >= dayAgo).length;
        setStat("recentEntryCount", String(recent), "Entries in the last 24 hours");

        if (!sorted.length) {
            body.replaceChildren(el("tr", {}, el("td", { colspan: "4", text: "No analyses recorded yet." })));
            notice.textContent = "Connected — no entries yet.";
            return;
        }
        const rows = sorted.slice(0, CONFIG.ADMIN_ENTRIES_LIMIT).map((entry) =>
            el("tr", {},
                el("td", { title: entry.analysis_id, text: String(entry.analysis_id || "").slice(0, 8) }),
                el("td", { text: entry.email || "—" }),
                el("td", { text: formatDate(entry.timestamp) }),
                el("td", { text: `${prettyLabel(entry.prediction)} · ${formatConfidence(entry.confidence)}` })
            )
        );
        body.replaceChildren(...rows);
        notice.textContent = `Showing the latest ${rows.length} of ${total} entries.`;
    }

    function renderFeedbackList(items, predictionById) {
        const list = $("adminFeedbackList");
        const notice = $("feedbackDataNotice");
        const sorted = [...items].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        if (!sorted.length) {
            list.textContent = "No feedback has been submitted yet.";
            notice.textContent = "Connected — no feedback yet.";
            return;
        }
        const cards = sorted.map((item) => {
            const predicted = predictionById[item.analysis_id];
            return el("article", { class: "admin-feedback-item" },
                el("h4", { text: item.helpful ? "✓ Helpful" : "✕ Not helpful" }),
                el("p", { text: item.comment ? item.comment : "No comment provided." }),
                el("p", {
                    class: "admin-feedback-meta",
                    text: [predicted ? `Predicted: ${prettyLabel(predicted)}` : null, item.email, formatDate(item.timestamp)]
                        .filter(Boolean).join(" · ")
                })
            );
        });
        list.replaceChildren(...cards);
        notice.textContent = `${sorted.length} feedback ${sorted.length === 1 ? "response" : "responses"}.`;
    }

    async function loadAdminData() {
        const message = $("adminApiMessage");
        const refresh = els.refreshEntriesButton;
        if (message) message.textContent = "Loading data from the API…";
        if (refresh) refresh.disabled = true;

        const [dashboard, entries, config, feedback] = await Promise.allSettled([
            api("/api/admin/dashboard"),
            api("/api/admin/entries"),
            api("/api/admin/model-config"),
            api("/api/admin/feedback")
        ]);
        if (!state.user) return;

        const ok = (r) => r.status === "fulfilled";
        const failures = [];

        if (ok(dashboard)) {
            const d = dashboard.value;
            setStat("totalEntries", String(d.total_analyses ?? "—"), "Analyses recorded");
            state.admin.yes = d.helpful_feedback || 0;
            state.admin.no   = d.not_helpful_feedback || 0;
            state.admin.distribution = d.class_distribution || {};
        } else {
            failures.push("dashboard");
            setStat("totalEntries", "—", "Unavailable");
        }

        if (ok(config)) {
            const c = config.value;
            const classes = Array.isArray(c.classes) ? c.classes : [];
            state.admin.classes = classes;
            setStat("modelStatus", prettyLabel(c.model_status || "loaded"), `${c.model_name || "Model"} · ${classes.length} classes`);
            $("modelName").textContent = c.model_name || "Not configured";
            $("modelVersion").textContent = c.checkpoint || "—";
            $("modelApiStatus").textContent = "Connected";
        } else {
            failures.push("model configuration");
            setStat("modelStatus", "Not connected", "Unavailable");
            $("modelName").textContent = "Not configured";
            $("modelVersion").textContent = "—";
            $("modelApiStatus").textContent = "Not connected";
        }

        const entryList = ok(entries) ? (entries.value.entries || []) : [];
        if (ok(entries)) renderEntries(entryList, entries.value.total ?? entryList.length);
        else {
            failures.push("entries");
            $("recentEntriesBody").replaceChildren(el("tr", {}, el("td", { colspan: "4", text: "Couldn't load entries." })));
            $("entriesDataNotice").textContent = "Couldn't load entries from the backend.";
            setStat("recentEntryCount", "—", "Unavailable");
        }

        if (ok(feedback)) {
            const lookup = {};
            entryList.forEach((e) => { lookup[e.analysis_id] = e.prediction; });
            renderFeedbackList(feedback.value.feedback || [], lookup);
        } else {
            failures.push("feedback");
            $("adminFeedbackList").textContent = "Couldn't load feedback.";
            $("feedbackDataNotice").textContent = "Couldn't load feedback from the backend.";
        }

        renderCharts();

        if (message) {
            if (!failures.length) {
                message.textContent = `Live data loaded from the API at ${new Date().toLocaleTimeString()}.`;
            } else {
                message.textContent = `Some data couldn't be loaded (${failures.join(", ")}). Check the backend and press Refresh.`;
            }
        }
        if (refresh) refresh.disabled = false;
    }

    /* -----------------------------------------------------------------
       17. EVENT WIRING
       ----------------------------------------------------------------- */
    function wireEvents() {
        if (els.landingBrandLink) els.landingBrandLink.addEventListener("click", (e) => e.preventDefault());
        if (els.loginForm) els.loginForm.addEventListener("submit", handleAuthSubmit);
        if (els.togglePassword && els.password) {
            els.togglePassword.addEventListener("click", () => {
                const reveal = els.password.type === "password";
                els.password.type = reveal ? "text" : "password";
                els.togglePassword.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
                els.togglePassword.setAttribute("aria-pressed", String(reveal));
            });
        }

        document.addEventListener("click", (e) => {
            const link = e.target.closest("[data-view-link]");
            if (link) { e.preventDefault(); showView(link.dataset.viewLink); }
        });
        if (els.jumpToAudio) els.jumpToAudio.addEventListener("click", () => showView("analyze"));

        wireProfileMenus();

        if (els.recordButton) els.recordButton.addEventListener("click", () => (recorder.active ? stopRecording() : startRecording()));
        if (els.audioFile) els.audioFile.addEventListener("change", handleFileChosen);
        if (els.removeAudio) els.removeAudio.addEventListener("click", clearAudio);
        if (els.analyzeButton) els.analyzeButton.addEventListener("click", analyze);

        if (els.feedbackYes) els.feedbackYes.addEventListener("click", () => chooseFeedback(true));
        if (els.feedbackNo) els.feedbackNo.addEventListener("click", () => chooseFeedback(false));
        if (els.submitYesFeedback) els.submitYesFeedback.addEventListener("click", () => submitFeedback(true));
        if (els.submitNoFeedback) els.submitNoFeedback.addEventListener("click", () => submitFeedback(false));

        if (els.refreshEntriesButton) els.refreshEntriesButton.addEventListener("click", loadAdminData);
    }

    /* -----------------------------------------------------------------
       18. INIT
       ----------------------------------------------------------------- */
    async function init() {
        injectStyles();
        buildAuthUi();
        setAuthMode("login");
        wireEvents();
        initTheme();
        updateUserDisplays();

        // If a token is already in localStorage, try to resume the session.
        const resumed = await restoreSession();
        if (resumed) return;

        // No stored token: try the cookie fallback once.
        try {
            const me = await api("/api/auth/me", { auth: false });
            if (me && me.level) {
                state.user = { email: me.email, level: me.level, display: displayFromEmail(me.email) };
                enterApp(state.user);
            }
        } catch { /* not logged in — stay on the login page */ }
    }

    init();
})();
