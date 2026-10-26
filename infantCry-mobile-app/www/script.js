(function () {
  "use strict";

  const TARGET_RATE = 16000;
  const $ = (id) => document.getElementById(id);
  const state = {
    user: null,
    audio: null,
    objectUrl: null,
    recording: false,
    startingRecording: false,
    recordRequestId: 0,
    stream: null,
    audioContext: null,
    sourceNode: null,
    processor: null,
    muteNode: null,
    chunks: [],
    recordingStart: 0,
    timer: null,
    feedbackHelpful: null,
    lastPredictionResponse: null
  };

  const el = {
    loginPage: $("loginPage"), analysisPage: $("analysisPage"), loginForm: $("loginForm"),
    username: $("username"), password: $("password"), togglePassword: $("togglePassword"),
    loginError: $("loginError"), loginButton: $("loginButton"), logoutButton: $("logoutButton"),
    recordButton: $("recordButton"), recordTime: $("recordTime"), recordState: $("recordState"),
    audioFile: $("audioFile"), selectedFile: $("selectedFile"), audioSection: $("audioSection"),
    audioName: $("audioName"), audioPlayer: $("audioPlayer"), audioMetadata: $("audioMetadata"),
    removeAudio: $("removeAudio"), analyzeButton: $("analyzeButton"), analyzeMessage: $("analyzeMessage"),
    loadingBox: $("loadingBox"), resultBox: $("resultBox"), predictionText: $("predictionText"),
    predictionDescription: $("predictionDescription"), confidenceText: $("confidenceText"),
    demoResultNotice: $("demoResultNotice"), feedbackYes: $("feedbackYes"), feedbackNo: $("feedbackNo"),
    feedbackForm: $("feedbackForm"), feedbackText: $("feedbackText"), submitFeedback: $("submitFeedback"),
    feedbackSuccess: $("feedbackSuccess"), analyzeAnother: $("analyzeAnother")
  };

  el.loginForm.addEventListener("submit", onLogin);
  el.togglePassword.addEventListener("click", () => {
    const show = el.password.type === "password";
    el.password.type = show ? "text" : "password";
    el.togglePassword.textContent = show ? "Hide" : "Show";
    el.togglePassword.setAttribute("aria-label", show ? "Hide password" : "Show password");
  });
  el.logoutButton.addEventListener("click", logout);
  el.recordButton.addEventListener("click", () => state.recording ? stopRecording() : startRecording());
  el.audioFile.addEventListener("change", onFileChosen);
  el.removeAudio.addEventListener("click", clearAudio);
  el.analyzeButton.addEventListener("click", analyzeAudio);
  el.feedbackYes.addEventListener("click", () => chooseFeedback(true));
  el.feedbackNo.addEventListener("click", () => chooseFeedback(false));
  el.submitFeedback.addEventListener("click", sendFeedback);
  el.analyzeAnother.addEventListener("click", resetForAnotherAnalysis);

  async function onLogin(event) {
    event.preventDefault();
    const username = el.username.value.trim();
    const password = el.password.value;
    if (!username || !password.trim()) {
      el.loginError.textContent = "Please enter both your username and password.";
      return;
    }
    el.loginButton.disabled = true;
    el.loginButton.textContent = "Please wait…";
    el.loginError.textContent = "";
    try {
      const result = await window.InfantCryApi.login(username, password);
      if (result.role === "admin") {
        el.loginError.textContent = "The admin dashboard remains on the web app in this mobile version.";
        return;
      }
      state.user = result.username;
      el.loginPage.classList.add("hidden");
      el.analysisPage.classList.remove("hidden");
      el.password.value = "";
      document.body.classList.add("signed-in");
      if (result.previewMode) setStatus("Preview mode: this is not real authentication.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      el.loginError.textContent = error.message || "Unable to sign in.";
    } finally {
      el.loginButton.disabled = false;
      el.loginButton.textContent = "Continue";
    }
  }

  function setStatus(message, isError = false) {
    el.analyzeMessage.textContent = message;
    el.analyzeMessage.classList.toggle("error-text", isError);
  }

  async function startRecording() {
    if (state.audio) {
      setStatus("Remove the selected audio before recording a new one.");
      return;
    }
    if (state.startingRecording) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("Microphone recording is unavailable. Try selecting a WAV file instead.", true);
      return;
    }
    state.startingRecording = true;
    const requestId = ++state.recordRequestId;
    el.recordButton.disabled = true;
    el.recordState.textContent = "Requesting microphone permission…";
    try {
      const requestedStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      });
      if (requestId !== state.recordRequestId) {
        requestedStream.getTracks().forEach(track => track.stop());
        return;
      }
      state.stream = requestedStream;
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) throw new Error("This device does not support audio recording.");
      state.audioContext = new AudioContextClass();
      await state.audioContext.resume();
      state.sourceNode = state.audioContext.createMediaStreamSource(state.stream);
      state.processor = state.audioContext.createScriptProcessor(4096, 1, 1);
      state.muteNode = state.audioContext.createGain();
      state.muteNode.gain.value = 0;
      state.chunks = [];
      state.processor.onaudioprocess = (event) => {
        if (!state.recording) return;
        state.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));
      };
      state.sourceNode.connect(state.processor);
      state.processor.connect(state.muteNode);
      state.muteNode.connect(state.audioContext.destination);
      state.recording = true;
      state.recordingStart = Date.now();
      el.recordButton.textContent = "Stop Recording";
      el.recordButton.classList.add("recording");
      el.recordState.textContent = "Recording… tap to stop";
      el.recordTime.textContent = "00:00";
      state.timer = window.setInterval(updateTimer, 250);
      setStatus("Recording in progress…", false);
    } catch (error) {
      cleanupRecorder();
      el.recordState.textContent = "Ready to record";
      setStatus(error.name === "NotAllowedError" ? "Microphone permission was denied. Allow microphone access in device settings or upload a WAV file." : (error.message || "Could not start recording."), true);
    } finally {
      state.startingRecording = false;
      el.recordButton.disabled = false;
    }
  }

  async function stopRecording() {
    if (!state.recording) return;
    state.recording = false;
    const inputRate = state.audioContext?.sampleRate || 48000;
    stopTimer();
    const chunks = state.chunks;
    state.chunks = [];
    cleanupRecorder();
    el.recordButton.textContent = "Start Recording";
    el.recordButton.classList.remove("recording");
    el.recordTime.textContent = "00:00";
    el.recordState.textContent = "Preparing 16 kHz WAV…";
    try {
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      if (totalLength === 0) throw new Error("No audio was captured. Please try again.");
      const samples = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
      const resampled = window.InfantCryAudioUtils.resampleMono(samples, inputRate, TARGET_RATE);
      const blob = window.InfantCryAudioUtils.encodePcm16Wav(resampled, TARGET_RATE);
      await acceptNormalizedAudio(blob, "recorded_infant_cry_16k.wav", resampled.length / TARGET_RATE);
      el.recordState.textContent = "Recording ready";
      setStatus("Recording converted to mono 16 kHz PCM WAV and is ready to preview.");
    } catch (error) {
      el.recordState.textContent = "Ready to record";
      setStatus(error.message || "Could not prepare this recording.", true);
    }
  }

  function updateTimer() {
    const elapsed = Math.max(0, Math.floor((Date.now() - state.recordingStart) / 1000));
    el.recordTime.textContent = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
  }

  function stopTimer() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }

  function cleanupRecorder() {
    stopTimer();
    try { if (state.processor) { state.processor.disconnect(); state.processor.onaudioprocess = null; } } catch (_) { /* Already disconnected */ }
    try { state.sourceNode?.disconnect(); } catch (_) { /* Already disconnected */ }
    try { state.muteNode?.disconnect(); } catch (_) { /* Already disconnected */ }
    if (state.stream) state.stream.getTracks().forEach(track => track.stop());
    const context = state.audioContext;
    state.stream = null;
    state.sourceNode = null;
    state.processor = null;
    state.muteNode = null;
    state.audioContext = null;
    if (context && context.state !== "closed") context.close().catch(() => {});
  }

  async function onFileChosen() {
    const file = el.audioFile.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".wav")) {
      setStatus("Please choose a WAV file only.", true);
      el.audioFile.value = "";
      return;
    }
    if (state.recording || state.startingRecording) {
      el.audioFile.value = "";
      setStatus("Stop the recording before choosing a file.", true);
      return;
    }
    el.analyzeButton.disabled = true;
    el.recordButton.disabled = true;
    setStatus("Checking and converting WAV to 16 kHz mono PCM…");
    el.selectedFile.textContent = `Preparing ${file.name}…`;
    try {
      const normalized = await window.InfantCryAudioUtils.decodeAndNormalizeWav(file);
      const safeBaseName = file.name.replace(/\.wav$/i, "").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "recording";
      await acceptNormalizedAudio(normalized.blob, `${safeBaseName}_16k.wav`, normalized.duration);
      setStatus("WAV verified and converted to mono 16 kHz PCM WAV.");
      el.recordState.textContent = "Ready to record";
    } catch (error) {
      clearAudio();
      setStatus(error.message || "Unable to read this WAV file.", true);
    } finally {
      el.analyzeButton.disabled = !state.audio;
      el.recordButton.disabled = false;
      el.audioFile.value = "";
    }
  }

  async function acceptNormalizedAudio(blob, fileName, duration) {
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    const metadata = await window.InfantCryAudioUtils.readWavMetadata(blob);
    if (metadata.sampleRate !== TARGET_RATE || metadata.channels !== 1 || metadata.bitDepth !== 16 || metadata.formatCode !== 1) {
      throw new Error("Audio validation failed: expected mono 16 kHz PCM 16-bit WAV.");
    }
    state.audio = { blob, fileName, duration, metadata };
    state.objectUrl = URL.createObjectURL(blob);
    el.audioName.textContent = fileName;
    el.selectedFile.textContent = fileName;
    el.audioPlayer.src = state.objectUrl;
    el.audioPlayer.load();
    el.audioMetadata.textContent = `WAV · mono · ${metadata.sampleRate.toLocaleString()} Hz · PCM ${metadata.bitDepth}-bit · ${formatDuration(duration)}`;
    el.audioSection.classList.remove("hidden");
    el.analyzeButton.disabled = false;
    el.loadingBox.classList.add("hidden");
    el.resultBox.classList.add("hidden");
    resetFeedback();
    el.audioSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function discardInProgressRecording() {
    // Invalidate any pending getUserMedia permission request so it cannot start after logout.
    state.recordRequestId++;
    state.recording = false;
    state.startingRecording = false;
    state.chunks = [];
    cleanupRecorder();
    el.recordButton.textContent = "Start Recording";
    el.recordButton.classList.remove("recording");
    el.recordButton.disabled = false;
    el.recordTime.textContent = "00:00";
    el.recordState.textContent = "Ready to record";
  }

  function clearAudio() {
    if (state.recording || state.startingRecording) discardInProgressRecording();
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
    state.objectUrl = null;
    state.audio = null;
    el.audioPlayer.pause();
    el.audioPlayer.removeAttribute("src");
    el.audioPlayer.load();
    el.audioName.textContent = "";
    el.selectedFile.textContent = "No file selected";
    el.audioMetadata.textContent = "WAV · mono · 16,000 Hz · PCM 16-bit";
    el.audioSection.classList.add("hidden");
    el.loadingBox.classList.add("hidden");
    el.resultBox.classList.add("hidden");
    el.analyzeButton.disabled = true;
    el.audioFile.value = "";
    resetFeedback();
    setStatus("Record or upload a WAV file to continue.");
  }

  async function analyzeAudio() {
    if (!state.audio || el.analyzeButton.disabled) return;
    el.analyzeButton.disabled = true;
    el.recordButton.disabled = true;
    el.loadingBox.classList.remove("hidden");
    el.resultBox.classList.add("hidden");
    setStatus("Preparing audio…");
    try {
      // This call returns a clear disconnected state until the API endpoint is configured.
      const response = await window.InfantCryApi.predictAudio(state.audio.blob, state.audio.fileName);
      if (!response.connected) {
        await delay(700); // Brief preview delay so the loading state can be reviewed.
        showPlaceholderResult();
      } else {
        // Deliberately stop here: the actual response schema is not yet supplied by the API teammate.
        state.lastPredictionResponse = response.rawResponse;
        showUnmappedResponse(response.rawResponse);
      }
    } catch (error) {
      el.loadingBox.classList.add("hidden");
      setStatus(error.message || "Analysis failed. Please try again.", true);
    } finally {
      el.analyzeButton.disabled = !state.audio;
      el.recordButton.disabled = false;
    }
  }

  function showPlaceholderResult() {
    el.loadingBox.classList.add("hidden");
    el.predictionText.textContent = "Model not connected";
    el.predictionDescription.textContent = "The actual cry category will appear after the team's inference API is connected.";
    el.confidenceText.textContent = "—";
    el.demoResultNotice.textContent = "Placeholder state only — no model prediction has been generated.";
    el.demoResultNotice.classList.remove("hidden");
    el.resultBox.classList.remove("hidden");
    setStatus("Audio is ready. Inference integration is a later project stage.");
    resetFeedback();
    el.resultBox.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function showUnmappedResponse(response) {
    el.loadingBox.classList.add("hidden");
    el.predictionText.textContent = "API connected — mapping pending";
    el.predictionDescription.textContent = "A response was received, but the API response fields must be mapped with your teammate before displaying a prediction.";
    el.confidenceText.textContent = "—";
    el.demoResultNotice.textContent = "Raw response was received; no category is inferred from an unknown schema.";
    el.demoResultNotice.classList.remove("hidden");
    el.resultBox.classList.remove("hidden");
    setStatus("API response received; response mapping is not configured.");
    // Do not log response payloads by default; future API responses may include identifying data.
  }

  function chooseFeedback(helpful) {
    state.feedbackHelpful = helpful;
    el.feedbackYes.classList.toggle("selected", helpful);
    el.feedbackNo.classList.toggle("selected", !helpful);
    el.feedbackForm.classList.remove("hidden");
    el.feedbackSuccess.classList.add("hidden");
  }

  async function sendFeedback() {
    if (state.feedbackHelpful === null) {
      el.feedbackSuccess.textContent = "Choose Yes or No first.";
      el.feedbackSuccess.classList.remove("hidden");
      return;
    }
    try {
      const result = await window.InfantCryApi.submitFeedback(state.feedbackHelpful, el.feedbackText.value.trim());
      el.feedbackSuccess.textContent = result.submitted
        ? "Thank you. Your feedback was submitted."
        : "Feedback preview only — it has not been sent or saved.";
      el.feedbackSuccess.classList.remove("hidden");
    } catch (error) {
      el.feedbackSuccess.textContent = error.message || "Feedback could not be submitted.";
      el.feedbackSuccess.classList.remove("hidden");
    }
  }

  function resetFeedback() {
    state.feedbackHelpful = null;
    el.feedbackYes.classList.remove("selected");
    el.feedbackNo.classList.remove("selected");
    el.feedbackForm.classList.add("hidden");
    el.feedbackText.value = "";
    el.feedbackSuccess.classList.add("hidden");
    el.feedbackSuccess.textContent = "";
  }

  function resetForAnotherAnalysis() {
    clearAudio();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function logout() {
    if (state.recording || state.startingRecording) discardInProgressRecording();
    clearAudio();
    window.InfantCryApi.logout();
    state.user = null;
    document.body.classList.remove("signed-in");
    el.analysisPage.classList.add("hidden");
    el.loginPage.classList.remove("hidden");
    el.username.value = "";
    el.password.value = "";
    el.loginError.textContent = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function formatDuration(seconds) {
    const whole = Math.max(0, Math.floor(seconds || 0));
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  }

  function delay(ms) { return new Promise(resolve => window.setTimeout(resolve, ms)); }

  window.addEventListener("beforeunload", () => {
    stopTimer();
    discardInProgressRecording();
    if (state.objectUrl) URL.revokeObjectURL(state.objectUrl);
  });
})();
