/*
  Premium Pomodoro / Focus Timer
  File: script.js
  Role: State management, timer logic, persistence, interactions
  Constraints:
  - Accurate timing using timestamps (tab-inactive safe)
  - Defensive localStorage usage
  - No external dependencies
*/

(function () {
  "use strict";

  /* ======================================================
     CONSTANTS & CONFIG
     ====================================================== */

  const STORAGE_KEY = "focus_timer_v1";

  const SESSION_TYPES = {
    FOCUS: "focus",
    SHORT_BREAK: "short-break",
    LONG_BREAK: "long-break",
  };

  const PRESETS = {
    classic: { focus: 25, short: 5 },
    deep: { focus: 50, short: 10 },
    light: { focus: 15, short: 3 },
  };

  const MAX_MINUTES = 420;
  const MIN_MINUTES = 1;

  const PROGRESS_CIRCUMFERENCE = 2 * Math.PI * 120; // must match CSS r=120

  /* ======================================================
     STATE
     ====================================================== */

  let state = {
    sessionType: SESSION_TYPES.FOCUS,
    isRunning: false,
    startTimestamp: null,
    durationMs: 25 * 60 * 1000,
    remainingMs: 25 * 60 * 1000,

    focusCount: 0,

    preferences: {
      autoStartNext: false,
      autoStartBreaks: false,
      skipLongBreak: false,
      sessionsBeforeLongBreak: 4,
      accentColor: "blue",
      focusMode: "soft",
      displayStyle: "hybrid",
      enableShortcuts: true,
      focusLock: false,
      focusSound: "none",
      soundVolume: 0.5,
      muteAlerts: false,
    },

    stats: {
      date: getTodayKey(),
      focusedMsToday: 0,
      completedSessions: 0,
      streak: 0,
      lastActiveDate: null,
    },
  };

  let rafId = null;

  /* ======================================================
     DOM REFERENCES (DEFENSIVE)
     ====================================================== */

  const $ = (id) => document.getElementById(id);

  const els = {
    timerTime: $("timerTime"),
    startPauseBtn: $("startPauseBtn"),
    resetBtn: $("resetBtn"),
    durationSlider: $("durationSlider"),
    durationValue: $("durationValue"),

    sessionButtons: document.querySelectorAll(".session-btn"),

    progressCircle: document.querySelector(".progress-ring-progress"),

    todayFocusTime: $("todayFocusTime"),
    completedSessions: $("completedSessions"),
    streakCount: $("streakCount"),

    autoStartNext: $("autoStartNext"),
    autoStartBreaks: $("autoStartBreaks"),
    skipLongBreak: $("skipLongBreak"),
    sessionsBeforeLongBreak: $("sessionsBeforeLongBreak"),

    focusSoundSelect: $("focusSoundSelect"),
    soundVolume: $("soundVolume"),
    muteAlerts: $("muteAlerts"),

    accentColor: $("accentColor"),
    focusMode: $("focusMode"),
    displayStyle: $("displayStyle"),

    enableShortcuts: $("enableShortcuts"),
    focusLock: $("focusLock"),
  };

  /* ======================================================
     INITIALIZATION
     ====================================================== */

  loadState();
  normalizeDailyStats();
  applyPreferencesToUI();
  updateTimerUI();
  updateStatsUI();
  updateProgress(1);

  bindEvents();

  /* ======================================================
     EVENT BINDING
     ====================================================== */

  function bindEvents() {
    if (els.startPauseBtn)
      els.startPauseBtn.addEventListener("click", toggleTimer);

    if (els.resetBtn)
      els.resetBtn.addEventListener("click", resetTimer);

    if (els.durationSlider)
      els.durationSlider.addEventListener("input", onDurationChange);

    els.sessionButtons.forEach((btn) =>
      btn.addEventListener("click", () =>
        switchSession(btn.dataset.session)
      )
    );

    document.querySelectorAll(".preset-btn").forEach((btn) =>
      btn.addEventListener("click", () => applyPreset(btn.dataset.preset))
    );

    // Preferences
    bindCheckbox(els.autoStartNext, "autoStartNext");
    bindCheckbox(els.autoStartBreaks, "autoStartBreaks");
    bindCheckbox(els.skipLongBreak, "skipLongBreak");
    bindCheckbox(els.muteAlerts, "muteAlerts");
    bindCheckbox(els.enableShortcuts, "enableShortcuts");
    bindCheckbox(els.focusLock, "focusLock");

    if (els.sessionsBeforeLongBreak)
      els.sessionsBeforeLongBreak.addEventListener("change", (e) => {
        state.preferences.sessionsBeforeLongBreak = parseInt(e.target.value, 10);
        persist();
      });

    if (els.focusSoundSelect)
      els.focusSoundSelect.addEventListener("change", (e) => {
        state.preferences.focusSound = e.target.value;
        persist();
      });

    if (els.soundVolume)
      els.soundVolume.addEventListener("input", (e) => {
        state.preferences.soundVolume = clamp(e.target.value / 100, 0, 1);
        persist();
      });

    if (els.accentColor)
      els.accentColor.addEventListener("change", (e) => {
        state.preferences.accentColor = e.target.value;
        applyAccentColor();
        persist();
      });

    if (els.focusMode)
      els.focusMode.addEventListener("change", (e) => {
        state.preferences.focusMode = e.target.value;
        applyFocusMode();
        persist();
      });

    if (els.displayStyle)
      els.displayStyle.addEventListener("change", (e) => {
        state.preferences.displayStyle = e.target.value;
        persist();
      });

    document.addEventListener("keydown", handleKeyboard);
  }

  function bindCheckbox(el, key) {
    if (!el) return;
    el.addEventListener("change", () => {
      state.preferences[key] = el.checked;
      persist();
    });
  }

  /* ======================================================
     TIMER LOGIC
     ====================================================== */

  function toggleTimer() {
    if (state.isRunning) {
      pauseTimer();
    } else {
      startTimer();
    }
  }

  function startTimer() {
    if (state.isRunning) return;

    state.isRunning = true;
    state.startTimestamp = Date.now();
    scheduleTick();

    els.startPauseBtn.textContent = "Pause";
    persist();
  }

  function pauseTimer() {
    if (!state.isRunning) return;

    updateRemainingFromTimestamp();
    state.isRunning = false;
    state.startTimestamp = null;

    cancelAnimationFrame(rafId);
    rafId = null;

    els.startPauseBtn.textContent = "Start";
    persist();
  }

  function resetTimer() {
    if (
      state.sessionType === SESSION_TYPES.FOCUS &&
      state.isRunning &&
      state.preferences.focusLock
    ) {
      return;
    }

    state.isRunning = false;
    state.startTimestamp = null;
    state.remainingMs = state.durationMs;

    cancelAnimationFrame(rafId);
    rafId = null;

    els.startPauseBtn.textContent = "Start";
    updateTimerUI();
    updateProgress(1);

    persist();
  }

  function scheduleTick() {
    rafId = requestAnimationFrame(tick);
  }

  function tick() {
    if (!state.isRunning) return;

    updateRemainingFromTimestamp();

    if (state.remainingMs <= 0) {
      completeSession();
      return;
    }

    updateTimerUI();
    updateProgress(state.remainingMs / state.durationMs);
    scheduleTick();
  }

  function updateRemainingFromTimestamp() {
    if (!state.startTimestamp) return;
    const elapsed = Date.now() - state.startTimestamp;
    state.remainingMs = Math.max(state.durationMs - elapsed, 0);
  }

  /* ======================================================
     SESSION FLOW
     ====================================================== */

  function completeSession() {
    state.isRunning = false;
    state.startTimestamp = null;
    state.remainingMs = 0;

    cancelAnimationFrame(rafId);
    rafId = null;

    handleStatsOnCompletion();
    switchToNextSession();

    els.startPauseBtn.textContent = "Start";
    persist();
  }

  function switchToNextSession() {
    if (state.sessionType === SESSION_TYPES.FOCUS) {
      state.focusCount += 1;

      const shouldLongBreak =
        !state.preferences.skipLongBreak &&
        state.focusCount % state.preferences.sessionsBeforeLongBreak === 0;

      switchSession(
        shouldLongBreak
          ? SESSION_TYPES.LONG_BREAK
          : SESSION_TYPES.SHORT_BREAK
      );

      if (state.preferences.autoStartBreaks) startTimer();
    } else {
      switchSession(SESSION_TYPES.FOCUS);
      if (state.preferences.autoStartNext) startTimer();
    }
  }

  function switchSession(type) {
    state.sessionType = type;

    document.body.classList.remove(
      "focus-soft",
      "focus-deep",
      "focus-zen"
    );

    if (type === SESSION_TYPES.FOCUS) {
      applyFocusMode();
    }

    setSessionButtonState(type);

    const minutes =
      type === SESSION_TYPES.FOCUS
        ? els.durationSlider.value
        : type === SESSION_TYPES.SHORT_BREAK
        ? getShortBreakMinutes()
        : getLongBreakMinutes();

    state.durationMs = minutes * 60 * 1000;
    state.remainingMs = state.durationMs;

    resetTimer();
  }

  /* ======================================================
     UI UPDATES
     ====================================================== */

  function updateTimerUI() {
    if (!els.timerTime) return;
    els.timerTime.textContent = formatTime(state.remainingMs);
  }

  function updateProgress(ratio) {
    if (!els.progressCircle) return;
    const offset = PROGRESS_CIRCUMFERENCE * (1 - clamp(ratio, 0, 1));
    els.progressCircle.style.strokeDasharray = PROGRESS_CIRCUMFERENCE;
    els.progressCircle.style.strokeDashoffset = offset;
  }

  function updateStatsUI() {
    if (els.todayFocusTime)
      els.todayFocusTime.textContent = formatMinutes(
        state.stats.focusedMsToday
      );
    if (els.completedSessions)
      els.completedSessions.textContent = state.stats.completedSessions;
    if (els.streakCount)
      els.streakCount.textContent = state.stats.streak;
  }

  function setSessionButtonState(type) {
    els.sessionButtons.forEach((btn) => {
      const active = btn.dataset.session === type;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  /* ======================================================
     DURATION / PRESETS
     ====================================================== */

  function onDurationChange(e) {
    const minutes = clamp(
      parseInt(e.target.value, 10),
      MIN_MINUTES,
      MAX_MINUTES
    );
    els.durationValue.textContent = minutes;

    if (state.sessionType === SESSION_TYPES.FOCUS && !state.isRunning) {
      state.durationMs = minutes * 60 * 1000;
      state.remainingMs = state.durationMs;
      updateTimerUI();
      updateProgress(1);
    }

    persist();
  }

  function applyPreset(key) {
    const preset = PRESETS[key];
    if (!preset) return;

    els.durationSlider.value = preset.focus;
    els.durationValue.textContent = preset.focus;

    state.durationMs = preset.focus * 60 * 1000;
    state.remainingMs = state.durationMs;

    persist();
    updateTimerUI();
    updateProgress(1);
  }

  /* ======================================================
     STATS & STREAKS
     ====================================================== */

  function handleStatsOnCompletion() {
    if (state.sessionType !== SESSION_TYPES.FOCUS) return;

    const focused = state.durationMs;
    state.stats.focusedMsToday += focused;
    state.stats.completedSessions += 1;
    updateStatsUI();
  }

  function normalizeDailyStats() {
    const today = getTodayKey();
    if (state.stats.date !== today) {
      if (state.stats.focusedMsToday > 0) {
        incrementStreak();
      }
      state.stats.date = today;
      state.stats.focusedMsToday = 0;
      state.stats.completedSessions = 0;
    }
  }

  function incrementStreak() {
    const yesterday = getTodayKey(-1);
    if (state.stats.lastActiveDate === yesterday) {
      state.stats.streak += 1;
    } else {
      state.stats.streak = 1;
    }
    state.stats.lastActiveDate = getTodayKey();
  }

  /* ======================================================
     KEYBOARD CONTROLS
     ====================================================== */

  function handleKeyboard(e) {
    if (!state.preferences.enableShortcuts) return;

    switch (e.key.toLowerCase()) {
      case " ":
        e.preventDefault();
        toggleTimer();
        break;
      case "r":
        resetTimer();
        break;
      case "1":
        switchSession(SESSION_TYPES.FOCUS);
        break;
      case "2":
        switchSession(SESSION_TYPES.SHORT_BREAK);
        break;
      case "3":
        switchSession(SESSION_TYPES.LONG_BREAK);
        break;
    }
  }

  /* ======================================================
     THEMING
     ====================================================== */

  function applyAccentColor() {
    const root = document.documentElement;
    root.style.setProperty(
      "--accent-color",
      `var(--accent-${state.preferences.accentColor})`
    );
  }

  function applyFocusMode() {
    document.body.classList.add(`focus-${state.preferences.focusMode}`);
  }

  /* ======================================================
     PERSISTENCE (DEFENSIVE)
     ====================================================== */

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        state = deepMerge(state, parsed);
      }
    } catch (_) {}
  }

  /* ======================================================
     HELPERS
     ====================================================== */

  function formatTime(ms) {
    const totalSeconds = Math.ceil(ms / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function formatMinutes(ms) {
    return `${Math.floor(ms / 60000)}m`;
  }

  function clamp(n, min, max) {
    return Math.min(Math.max(n, min), max);
  }

  function getTodayKey(offsetDays = 0) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  function getShortBreakMinutes() {
    return PRESETS.classic.short;
  }

  function getLongBreakMinutes() {
    return PRESETS.classic.short * 3;
  }

  function deepMerge(target, source) {
    const out = Array.isArray(target) ? [...target] : { ...target };
    for (const key in source) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        out[key] = deepMerge(out[key] || {}, source[key]);
      } else {
        out[key] = source[key];
      }
    }
    return out;
  }

  // Apply initial theme
  applyAccentColor();
  applyFocusMode();
})();
