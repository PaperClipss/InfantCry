(function (global) {
  "use strict";

  const config = global.INFANTCRY_CONFIG || {};
  let accessToken = null;

  function joinUrl(base, path) {
    return `${String(base).replace(/\/+$/, "")}/${String(path).replace(/^\/+/, "")}`;
  }

  async function readError(response) {
    let detail = "";
    try {
      const body = await response.json();
      detail = body.detail || body.message || body.error || "";
    } catch (_) { /* Some APIs return plain text or an empty body. */ }
    return detail || `Request failed (${response.status}).`;
  }

  async function login(username, password) {
    if (config.previewMode) {
      // UI preview only. This is not authentication and must not be used in production.
      return { previewMode: true, accessToken: null, username, role: "user" };
    }
    if (!config.apiBaseUrl || !config.endpoints?.login) {
      throw new Error("Login API is not configured. Restore preview mode for UI testing or set the confirmed API route.");
    }

    const response = await fetch(joinUrl(config.apiBaseUrl, config.endpoints.login), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });
    if (!response.ok) throw new Error(await readError(response));
    const data = await response.json();
    if (!data.access_token) throw new Error("Login response did not contain access_token.");
    if (!["user", "admin"].includes(data.role)) throw new Error("Login response did not contain a supported role.");
    accessToken = data.access_token;
    return { previewMode: false, accessToken, username: data.username || username, role: data.role };
  }

  async function predictAudio(blob, filename) {
    // The prediction route and response schema are deliberately unset until provided by the API teammate.
    if (config.previewMode) return { connected: false, prediction: null, confidence: null };
    if (!config.apiBaseUrl || !config.endpoints?.prediction) {
      throw new Error("Prediction API is not configured. The API route must be confirmed before inference can be connected.");
    }
    if (!(blob instanceof Blob)) throw new Error("No audio file is available to submit.");
    const formData = new FormData();
    formData.append(config.audioFieldName || "file", blob, filename || "infant_cry_16k.wav");
    const headers = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
    const response = await fetch(joinUrl(config.apiBaseUrl, config.endpoints.prediction), {
      method: "POST", headers, body: formData
    });
    if (!response.ok) throw new Error(await readError(response));
    // Response fields require a mapping agreed with the API teammate; don't guess them here.
    return { connected: true, rawResponse: await response.json() };
  }

  async function submitFeedback(helpful, comment, entryId) {
    if (config.previewMode) return { submitted: false, previewMode: true };
    if (!config.apiBaseUrl || !config.endpoints?.feedback) {
      throw new Error("Feedback API is not configured. No feedback was sent.");
    }
    const headers = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const response = await fetch(joinUrl(config.apiBaseUrl, config.endpoints.feedback), {
      method: "POST", headers,
      body: JSON.stringify({ helpful, comment, ...(entryId ? { entry_id: entryId } : {}) })
    });
    if (!response.ok) throw new Error(await readError(response));
    return { submitted: true };
  }

  function logout() { accessToken = null; }
  function isPreviewMode() { return Boolean(config.previewMode || !config.apiBaseUrl); }

  global.InfantCryApi = { login, predictAudio, submitFeedback, logout, isPreviewMode };
})(window);
