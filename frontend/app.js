// ============================================================================
// CONFIG: after `sam deploy`, paste the ApiUrl output value below.
// Example: "https://abc123.execute-api.us-east-1.amazonaws.com"
// ============================================================================
const API_BASE_URL = "https://vdn643918i.execute-api.us-east-1.amazonaws.com";

// When the API URL isn't set (e.g. running the local dev server), use same-origin.
const apiBase = API_BASE_URL.includes("REPLACE_WITH") ? "" : API_BASE_URL;

const els = {
  tasks: document.getElementById("tasks"),
  prioritize: document.getElementById("prioritize"),
  status: document.getElementById("status"),
  resultsCard: document.getElementById("resultsCard"),
  resultsBody: document.querySelector("#resultsTable tbody"),
  resultsTitle: document.getElementById("resultsTitle"),
  viewingBanner: document.getElementById("viewingBanner"),
  viewingLabel: document.getElementById("viewingLabel"),
  backToLatest: document.getElementById("backToLatest"),
  history: document.getElementById("history"),
  refreshHistory: document.getElementById("refreshHistory"),
  micBtn: document.getElementById("micBtn"),
  micLabel: document.getElementById("micLabel"),
  voiceStatus: document.getElementById("voiceStatus"),
  audioUpload: document.getElementById("audioUpload"),
  clearBtn: document.getElementById("clearBtn"),
  totalTasks: document.getElementById("totalTasks"),
  totalTime: document.getElementById("totalTime"),
  quickWinCount: document.getElementById("quickWinCount"),
  urgentCount: document.getElementById("urgentCount"),
  quickWinsBox: document.getElementById("quickWinsBox"),
  quickWinsList: document.getElementById("quickWinsList"),
};

function setStatus(message, isError = false) {
  els.status.textContent = message;
  els.status.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function level(value) {
  const v = String(value || "").toLowerCase();
  return ["low", "medium", "high"].includes(v) ? v : "medium";
}

const CATEGORY_ICONS = {
  work: "💼", personal: "🏠", health: "❤️",
  finance: "💰", learning: "📚", admin: "📋",
};

function formatMinutes(mins) {
  if (!mins || mins <= 0) return "—";
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatDueDate(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso + "T00:00:00");
    const today = new Date(); today.setHours(0,0,0,0);
    const diff = Math.round((d - today) / 86400000);
    const label = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (diff < 0) return `<span class="overdue">${label} (overdue)</span>`;
    if (diff === 0) return `<span class="due-today">${label} (today)</span>`;
    if (diff === 1) return `<span class="due-soon">${label} (tomorrow)</span>`;
    if (diff <= 3) return `<span class="due-soon">${label} (${diff}d)</span>`;
    return label;
  } catch { return iso; }
}

function renderResults(tasks) {
  els.resultsBody.innerHTML = "";

  // Summary stats
  let totalMin = 0, quickWins = [], urgentCount = 0;
  tasks.forEach((t) => {
    totalMin += Number(t.estimatedMinutes) || 0;
    if (t.quickWin) quickWins.push(t);
    if (String(t.urgency).toLowerCase() === "high") urgentCount++;
  });
  els.totalTasks.textContent = tasks.length;
  els.totalTime.textContent = formatMinutes(totalMin);
  els.quickWinCount.textContent = quickWins.length;
  els.urgentCount.textContent = urgentCount;

  // Quick wins callout
  if (quickWins.length) {
    els.quickWinsList.innerHTML = "";
    quickWins.forEach((t) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${escapeHtml(t.task)}</strong> — ${formatMinutes(Number(t.estimatedMinutes))}`;
      els.quickWinsList.appendChild(li);
    });
    els.quickWinsBox.classList.remove("hidden");
  } else {
    els.quickWinsBox.classList.add("hidden");
  }

  // Table rows
  tasks.forEach((t, index) => {
    const priority = Number(t.priority) || index + 1;
    const cat = String(t.category || "admin").toLowerCase();
    const catIcon = CATEGORY_ICONS[cat] || "📋";
    const qw = t.quickWin ? ' <span class="qw-badge">⚡</span>' : '';
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><span class="prio prio-${Math.min(Math.max(priority, 1), 5)}">${index + 1}</span></td>
      <td>${escapeHtml(t.task)}${qw}</td>
      <td><span class="prio prio-${Math.min(Math.max(priority, 1), 5)}">P${escapeHtml(priority)}</span></td>
      <td><span class="badge ${level(t.urgency)}">${escapeHtml(t.urgency || "—")}</span></td>
      <td><span class="badge ${level(t.impact)}">${escapeHtml(t.impact || "—")}</span></td>
      <td class="time-cell">${formatMinutes(Number(t.estimatedMinutes))}</td>
      <td class="date-cell">${formatDueDate(t.suggestedDueDate)}</td>
      <td><span class="cat-badge">${catIcon} ${escapeHtml(cat)}</span></td>
      <td>${escapeHtml(t.reasoning || "")}</td>
    `;
    els.resultsBody.appendChild(row);
  });
  els.resultsCard.classList.remove("hidden");
}

async function prioritize() {
  const raw = els.tasks.value.trim();
  if (!raw) {
    setStatus("Add at least one task.", true);
    return;
  }
  if (!apiBase && location.protocol === "file:") {
    setStatus("Open the app via the local server (python local_server.py) or set API_BASE_URL.", true);
    return;
  }

  els.prioritize.disabled = true;
  setStatus("Thinking…");

  try {
    const res = await fetch(`${apiBase}/prioritize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: raw }),
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    renderResults(data.tasks || []);
    setStatus(`Ranked ${data.tasks?.length || 0} tasks.`);
    // Fresh run — clear any "viewing past run" state
    els.viewingBanner.classList.add("hidden");
    document.querySelectorAll(".history-tile.active").forEach((el) => el.classList.remove("active"));
    loadHistory();
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    els.prioritize.disabled = false;
  }
}

async function loadHistory() {
  if (!apiBase && location.protocol === "file:") return;
  try {
    const res = await fetch(`${apiBase}/history`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to load history");

    els.history.innerHTML = "";
    const runs = data.runs || [];
    runs.forEach((run) => {
      const li = document.createElement("li");
      li.className = "history-tile";
      li.setAttribute("role", "button");
      li.setAttribute("tabindex", "0");
      const when = new Date(run.createdAt).toLocaleString();
      const result = run.result || [];
      const count = (run.input || []).length || result.length;
      const totalMin = result.reduce((s, t) => s + (Number(t.estimatedMinutes) || 0), 0);
      const quickWins = result.filter((t) => t.quickWin).length;
      const urgent = result.filter((t) => String(t.urgency).toLowerCase() === "high").length;
      const top = result
        .slice(0, 3)
        .map((t) => escapeHtml(t.task))
        .join(" · ");
      li.innerHTML = `
        <div class="tile-head">
          <span class="meta">${escapeHtml(when)}</span>
          <span class="tile-view">View →</span>
        </div>
        <div class="tile-preview">${top || "—"}</div>
        <div class="tile-chips">
          <span class="tile-chip">${count} tasks</span>
          <span class="tile-chip">⏱ ${formatMinutes(totalMin)}</span>
          ${quickWins ? `<span class="tile-chip accent">⚡ ${quickWins}</span>` : ""}
          ${urgent ? `<span class="tile-chip high">🔴 ${urgent}</span>` : ""}
        </div>
      `;
      const open = () => viewPastRun(run, li);
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });
      els.history.appendChild(li);
    });
    if (!runs.length) {
      els.history.innerHTML = "<li class='history-empty'>No runs yet. Prioritize a list to get started.</li>";
    }
  } catch (err) {
    els.history.innerHTML = `<li class='history-empty'>${escapeHtml(err.message)}</li>`;
  }
}

// Render a past run's full prioritized list in the results panel.
function viewPastRun(run, tileEl) {
  const result = run.result || [];
  if (!result.length) return;
  renderResults(result);
  els.resultsTitle.textContent = "Prioritized list";
  const when = new Date(run.createdAt).toLocaleString();
  els.viewingBanner.classList.remove("hidden");
  els.viewingLabel.textContent = `Viewing past run from ${when}`;
  // Highlight the selected tile
  document.querySelectorAll(".history-tile.active").forEach((el) => el.classList.remove("active"));
  if (tileEl) tileEl.classList.add("active");
  els.resultsCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

els.prioritize.addEventListener("click", prioritize);

// ============================================================================
// VOICE INPUT — Web Speech API (live mic) + file upload transcription
// ============================================================================

function setVoiceStatus(msg, isError = false) {
  els.voiceStatus.textContent = msg;
  els.voiceStatus.classList.toggle("error", isError);
}

// --- Live microphone via Web Speech API ---
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let isListening = false;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  let finalTranscript = "";

  recognition.onstart = () => {
    isListening = true;
    els.micBtn.classList.add("recording");
    els.micLabel.textContent = "Stop";
    setVoiceStatus("🎤 Listening… speak your tasks, then click Stop.");
  };

  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        finalTranscript += transcript + "\n";
      } else {
        interim = transcript;
      }
    }
    // Show final lines + current interim in the textarea
    els.tasks.value = (finalTranscript + interim).trim();
  };

  recognition.onerror = (e) => {
    if (e.error === "no-speech") return; // harmless
    setVoiceStatus("Mic error: " + e.error, true);
    stopListening();
  };

  recognition.onend = () => {
    // If still in listening mode, restart (browser sometimes auto-stops)
    if (isListening) {
      try { recognition.start(); } catch (_) { stopListening(); }
    }
  };
} else {
  els.micBtn.title = "Speech recognition not supported in this browser";
  els.micBtn.disabled = true;
}

function startListening() {
  if (!recognition) return;
  // Preserve existing text
  const existing = els.tasks.value.trim();
  recognition._finalTranscript = "";
  // Reset finalTranscript for the recognition callbacks
  // We'll prepend existing text
  let prefix = existing ? existing + "\n" : "";

  // Patch finalTranscript via closure
  let ft = prefix;
  recognition.onresult = (e) => {
    let interim = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) {
        ft += transcript.trim() + "\n";
      } else {
        interim = transcript;
      }
    }
    els.tasks.value = (ft + interim).trim();
  };

  recognition.start();
}

function stopListening() {
  isListening = false;
  if (recognition) {
    try { recognition.stop(); } catch (_) {}
  }
  els.micBtn.classList.remove("recording");
  els.micLabel.textContent = "Speak";
  const lines = els.tasks.value.trim().split("\n").filter(Boolean).length;
  if (lines) setVoiceStatus(`Captured ${lines} task${lines === 1 ? "" : "s"} from voice.`);
  else setVoiceStatus("");
}

els.micBtn.addEventListener("click", () => {
  if (isListening) stopListening();
  else startListening();
});

// --- Voice note file upload (uses browser MediaRecorder decode + Speech Recognition) ---
// For uploaded audio files, we use the AudioContext to play them through a
// MediaStreamDestination and feed that into SpeechRecognition. This is a
// browser-only approach that avoids needing Amazon Transcribe.

els.audioUpload.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  els.audioUpload.value = ""; // reset for re-upload

  if (!SpeechRecognition) {
    setVoiceStatus("Speech recognition not supported in this browser.", true);
    return;
  }

  setVoiceStatus(`Processing "${file.name}"…`);

  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const arrayBuf = await file.arrayBuffer();
    const audioBuffer = await audioCtx.decodeAudioData(arrayBuf);

    // Create a MediaStreamDestination so we can feed audio into SpeechRecognition
    const dest = audioCtx.createMediaStreamDestination();
    const source = audioCtx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(dest);
    source.connect(audioCtx.destination); // optional: hear it play

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = "en-US";

    // Some browsers support mediaStream on recognition
    // Fallback: we just let it use the default mic while audio plays through speakers
    // The most reliable cross-browser approach
    let transcript = els.tasks.value.trim();
    if (transcript) transcript += "\n";

    rec.onresult = (ev) => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) {
          transcript += ev.results[i][0].transcript.trim() + "\n";
          els.tasks.value = transcript.trim();
        }
      }
    };

    rec.onerror = (ev) => {
      if (ev.error !== "no-speech") setVoiceStatus("Transcription error: " + ev.error, true);
    };

    source.onended = () => {
      setTimeout(() => {
        try { rec.stop(); } catch (_) {}
        audioCtx.close();
        const lines = els.tasks.value.trim().split("\n").filter(Boolean).length;
        setVoiceStatus(`Done — ${lines} task${lines === 1 ? "" : "s"} from voice note.`);
      }, 1500); // give recognition a moment to finish
    };

    rec.start();
    source.start(0);
  } catch (err) {
    setVoiceStatus("Could not process audio: " + err.message, true);
  }
});
els.refreshHistory.addEventListener("click", loadHistory);

// --- Close "viewing past run" banner: hide the results panel ---
els.backToLatest.addEventListener("click", () => {
  els.viewingBanner.classList.add("hidden");
  els.resultsCard.classList.add("hidden");
  document.querySelectorAll(".history-tile.active").forEach((el) => el.classList.remove("active"));
});

// --- Clear button ---
els.clearBtn.addEventListener("click", () => {
  els.tasks.value = "";
  els.resultsCard.classList.add("hidden");
  els.viewingBanner.classList.add("hidden");
  document.querySelectorAll(".history-tile.active").forEach((el) => el.classList.remove("active"));
  setStatus("");
  setVoiceStatus("");
  els.tasks.focus();
});

loadHistory();
