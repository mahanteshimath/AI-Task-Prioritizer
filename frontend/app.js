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
  clearAllHistory: document.getElementById("clearAllHistory"),
  micBtn: document.getElementById("micBtn"),
  micLabel: document.getElementById("micLabel"),
  voiceStatus: document.getElementById("voiceStatus"),
  audioUpload: document.getElementById("audioUpload"),
  clearBtn: document.getElementById("clearBtn"),
  reviewCard: document.getElementById("reviewCard"),
  reviewList: document.getElementById("reviewList"),
  addTaskBtn: document.getElementById("addTaskBtn"),
  confirmReviewBtn: document.getElementById("confirmReviewBtn"),
  cancelReviewBtn: document.getElementById("cancelReviewBtn"),
  reviewStatus: document.getElementById("reviewStatus"),
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
          <div class="tile-head-right">
            <span class="tile-view">View →</span>
            <button type="button" class="tile-delete" title="Delete this run" aria-label="Delete this run">🗑</button>
          </div>
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
      const delBtn = li.querySelector(".tile-delete");
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteRun(run, li);
      });
      delBtn.addEventListener("keydown", (e) => e.stopPropagation());
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

// Delete a single past run.
async function deleteRun(run, tileEl) {
  if (!apiBase && location.protocol === "file:") return;
  if (!confirm("Delete this run? This can't be undone.")) return;
  try {
    tileEl.classList.add("deleting");
    const res = await fetch(`${apiBase}/history?createdAt=${encodeURIComponent(run.createdAt)}`, {
      method: "DELETE",
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Delete failed");
    // If we were viewing this run, close the results panel.
    if (tileEl.classList.contains("active")) {
      els.resultsCard.classList.add("hidden");
      els.viewingBanner.classList.add("hidden");
    }
    loadHistory();
  } catch (err) {
    tileEl.classList.remove("deleting");
    alert("Could not delete run: " + err.message);
  }
}

// Delete all past runs.
async function clearAllRuns() {
  if (!apiBase && location.protocol === "file:") return;
  if (!confirm("Delete ALL past runs? This can't be undone.")) return;
  try {
    const res = await fetch(`${apiBase}/history?all=true`, { method: "DELETE" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Clear failed");
    els.resultsCard.classList.add("hidden");
    els.viewingBanner.classList.add("hidden");
    loadHistory();
  } catch (err) {
    alert("Could not clear history: " + err.message);
  }
}

els.prioritize.addEventListener("click", prioritize);

// ============================================================================
// REVIEW STEP — confirm & edit voice/recorded tasks before prioritizing
// ============================================================================

function setReviewStatus(msg, isError = false) {
  els.reviewStatus.textContent = msg;
  els.reviewStatus.classList.toggle("error", isError);
}

// Turn raw text (typed or transcribed) into clean, de-duplicated task lines.
function parseTasksFromText(text) {
  const parts = String(text || "")
    .split(/[\n.;]+|,\s+(?:and|then)\s+/i)
    .map((s) => s.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const p of parts) {
    const key = p.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(p);
    }
  }
  return unique;
}

// A line is "unclear" if it's very short or a single filler word.
function isUnclear(text) {
  const t = text.trim().toLowerCase();
  if (t.length < 3) return true;
  const fillers = new Set(["um", "uh", "the", "and", "then", "a", "an", "to", "i", "it"]);
  const words = t.split(/\s+/);
  return words.length === 1 && fillers.has(words[0]);
}

function makeReviewRow(value) {
  const li = document.createElement("li");
  li.className = "review-row";
  const unclear = isUnclear(value);
  li.innerHTML = `
    <span class="review-drag">⋮⋮</span>
    <input type="text" class="review-input${unclear ? " unclear" : ""}"
           value="${escapeHtml(value)}"
           placeholder="${unclear ? "Unclear — please clarify this task" : "Task description"}"
           aria-label="Task" />
    <button type="button" class="review-remove" title="Remove this task" aria-label="Remove">✕</button>
  `;
  li.querySelector(".review-remove").addEventListener("click", () => {
    li.remove();
    updateReviewState();
  });
  const input = li.querySelector(".review-input");
  input.addEventListener("input", () => {
    input.classList.toggle("unclear", isUnclear(input.value));
    updateReviewState();
  });
  return li;
}

function collectReviewTasks() {
  return [...els.reviewList.querySelectorAll(".review-input")]
    .map((i) => i.value.trim())
    .filter(Boolean);
}

function updateReviewState() {
  const tasks = collectReviewTasks();
  const unclearCount = [...els.reviewList.querySelectorAll(".review-input")]
    .filter((i) => i.value.trim() && isUnclear(i.value)).length;
  els.confirmReviewBtn.disabled = tasks.length === 0;
  if (!tasks.length) {
    setReviewStatus("Add at least one task to continue.", true);
  } else if (unclearCount) {
    setReviewStatus(`${unclearCount} task${unclearCount === 1 ? "" : "s"} may be unclear — please review the highlighted rows.`, true);
  } else {
    setReviewStatus(`${tasks.length} task${tasks.length === 1 ? "" : "s"} ready.`);
  }
}

// Show the review panel for a set of tasks (from voice/upload).
function showReviewStep(tasks, sourceLabel) {
  els.reviewList.innerHTML = "";
  const cleaned = tasks.length ? tasks : [""];
  cleaned.forEach((t) => els.reviewList.appendChild(makeReviewRow(t)));
  els.reviewCard.classList.remove("hidden");
  updateReviewState();
  els.reviewCard.scrollIntoView({ behavior: "smooth", block: "start" });
  const first = els.reviewList.querySelector(".review-input");
  if (first) first.focus();
  if (sourceLabel) setReviewStatus(`${cleaned.length} task${cleaned.length === 1 ? "" : "s"} detected from ${sourceLabel}. Review below.`);
}

function hideReviewStep() {
  els.reviewCard.classList.add("hidden");
  els.reviewList.innerHTML = "";
}

els.addTaskBtn.addEventListener("click", () => {
  els.reviewList.appendChild(makeReviewRow(""));
  updateReviewState();
  const inputs = els.reviewList.querySelectorAll(".review-input");
  inputs[inputs.length - 1]?.focus();
});

els.cancelReviewBtn.addEventListener("click", () => {
  // Keep whatever was captured in the textarea so the user can edit manually.
  const tasks = collectReviewTasks();
  els.tasks.value = tasks.join("\n");
  hideReviewStep();
  setVoiceStatus("Tasks moved to the editor — edit and press Prioritize when ready.");
  els.tasks.focus();
});

els.confirmReviewBtn.addEventListener("click", () => {
  const tasks = collectReviewTasks();
  if (!tasks.length) {
    updateReviewState();
    return;
  }
  els.tasks.value = tasks.join("\n");
  hideReviewStep();
  prioritize();
});


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
  const captured = els.tasks.value.trim();
  const tasks = parseTasksFromText(captured);
  if (tasks.length) {
    setVoiceStatus(`Captured ${tasks.length} task${tasks.length === 1 ? "" : "s"} — review before prioritizing.`);
    showReviewStep(tasks, "your recording");
  } else {
    setVoiceStatus("");
  }
}

els.micBtn.addEventListener("click", () => {
  if (isListening) stopListening();
  else startListening();
});

// --- Voice note file upload (Amazon Transcribe) ---
// Uploaded audio can't be transcribed by the browser's Web Speech API (that only
// listens to the live mic). Instead we send the file to the backend, which stores
// it in S3 and runs an Amazon Transcribe job, then we poll for the result.

const AUDIO_EXT_MAP = {
  "audio/webm": "webm", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/mp3": "mp3",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/flac": "flac",
  "audio/x-flac": "flac", "audio/mp4": "mp4", "audio/x-m4a": "m4a", "audio/m4a": "m4a",
  "audio/amr": "amr", "audio/aac": "mp4",
};
const ALLOWED_AUDIO_EXT = ["mp3", "mp4", "m4a", "wav", "flac", "ogg", "amr", "webm"];

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",", 2)[1]);
    reader.onerror = () => reject(new Error("Could not read the file."));
    reader.readAsDataURL(file);
  });
}

function guessAudioFormat(file) {
  const byMime = AUDIO_EXT_MAP[(file.type || "").toLowerCase()];
  if (byMime) return byMime;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return ALLOWED_AUDIO_EXT.includes(ext) ? ext : "";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

els.audioUpload.addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  els.audioUpload.value = ""; // reset for re-upload

  if (!apiBase && location.protocol === "file:") {
    setVoiceStatus("Open the app via the server to use voice-note upload.", true);
    return;
  }

  const format = guessAudioFormat(file);
  if (!format) {
    setVoiceStatus("Unsupported audio type. Use mp3, mp4/m4a, wav, flac, ogg, amr, or webm.", true);
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    setVoiceStatus("Audio is too large (max 5 MB). Please upload a shorter clip.", true);
    return;
  }

  try {
    setVoiceStatus(`Uploading "${file.name}"…`);
    const audio = await fileToBase64(file);

    const startRes = await fetch(`${apiBase}/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio, format }),
    });
    const startData = await startRes.json();
    if (!startRes.ok) throw new Error(startData.error || `Upload failed (${startRes.status})`);
    const jobName = startData.jobName;

    setVoiceStatus("🎧 Transcribing your voice note… this can take up to a minute.");

    // Poll for the transcript (up to ~90s)
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      await sleep(3000);
      const statusRes = await fetch(`${apiBase}/transcribe-status?job=${encodeURIComponent(jobName)}`);
      const statusData = await statusRes.json();
      if (!statusRes.ok) throw new Error(statusData.error || "Status check failed.");

      if (statusData.status === "COMPLETED") {
        const text = (statusData.text || "").trim();
        if (!text) {
          setVoiceStatus("No speech detected in the audio.", true);
          return;
        }
        // Merge with anything already in the editor, then open the review step
        // so the user can confirm/edit before prioritizing.
        const existing = els.tasks.value.trim();
        const combined = (existing ? existing + "\n" : "") + text;
        const tasks = parseTasksFromText(combined);
        setVoiceStatus(`Transcribed "${file.name}" — review the tasks before prioritizing.`);
        showReviewStep(tasks, "your voice note");
        return;
      }
      if (statusData.status === "FAILED") {
        throw new Error(statusData.error || "Transcription failed.");
      }
    }
    setVoiceStatus("Transcription is taking longer than expected. Please try a shorter clip.", true);
  } catch (err) {
    setVoiceStatus("Voice note failed: " + err.message, true);
  }
});
els.refreshHistory.addEventListener("click", loadHistory);
els.clearAllHistory.addEventListener("click", clearAllRuns);

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
  hideReviewStep();
  document.querySelectorAll(".history-tile.active").forEach((el) => el.classList.remove("active"));
  setStatus("");
  setVoiceStatus("");
  els.tasks.focus();
});

loadHistory();
