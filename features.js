/* PrepMate feature layer.
 * Loaded after the main script. It replaces stub handlers with working ones and
 * reuses the app's globals (qIndex, timer, seconds, mediaStream, recording,
 * questions, renderQuestion, startTimer, navigate, showToast) without changing
 * the rest of index.html.
 *
 * Everything is stored locally in the browser (localStorage). Only the interview
 * answers and resume text are sent to /api/interview and /api/resume.
 */
(function () {
  'use strict';

  const KEYS = {
    sessions: 'prepmateSessions',
    settings: 'prepmateSettings',
    drafts: 'prepmateDrafts',
    checks: 'prepmateChecks',
    resume: 'prepmateResumeProfile',
    plan: 'prepmatePlan',
    user: 'prepmateUser',
  };

  const DIMS = ['clarity', 'structure', 'relevance', 'impact', 'ownership'];
  const DIM_LABEL = { clarity: 'Clarity', structure: 'Structure', relevance: 'Relevance', impact: 'Impact', ownership: 'Ownership' };
  const CHECKS = ['lighting', 'framing', 'audio', 'background', 'eyeline'];
  const MAX_ADAPTIVE_INSERTS = 2;

  const DEFAULT_SETTINGS = { biometric: true, adaptive: true, speaking: true, cameraPreview: true, dailyPractice: true };

  // Question bank used for adaptive follow-ups, tagged by the dimension each one trains.
  const BANK = [
    { tag: 'behavioral', text: 'Tell me about a time you disagreed with a teammate. How did you resolve it?' },
    { tag: 'behavioral', text: 'Describe a project that missed its goal. What did you change afterwards?' },
    { tag: 'impact', text: 'What is the most measurable result you have delivered, and how did you measure it?' },
    { tag: 'technical', text: 'How would you design a URL shortener that handles millions of requests a day?' },
    { tag: 'clarity', text: 'Explain a technical concept you know well in two minutes, as if to a non-technical manager.' },
    { tag: 'ownership', text: 'Which part of your last project did you personally own, and what decisions did you make?' },
  ];
  const WEAK_TO_TAG = { structure: 'behavioral', relevance: 'technical', impact: 'impact', clarity: 'clarity', ownership: 'ownership' };
  const PLAN_BY_WEAK = {
    structure: 'Practice one STAR answer: situation, goal, your action, then the result.',
    relevance: 'Restate the question in your first sentence, then answer it directly.',
    impact: 'Rewrite one answer so it includes two numbers or measurable outcomes.',
    clarity: 'Answer one question in 90 seconds with no filler words.',
    ownership: 'Replace "we" with "I" wherever it is true, and name the decision you made.',
  };

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const toast = msg => { if (typeof showToast === 'function') showToast(msg); };

  function read(key, fallback) {
    try {
      const v = JSON.parse(localStorage.getItem(key));
      return v === null || v === undefined ? fallback : v;
    } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function wordCount(text) {
    const t = text.trim();
    return t ? t.split(/\s+/).filter(Boolean).length : 0;
  }
  const avg = arr => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  // ---------- settings ----------
  let settings = Object.assign({}, DEFAULT_SETTINGS, read(KEYS.settings, {}));
  function saveSettings() { write(KEYS.settings, settings); }

  // ---------- sessions and progress ----------
  function sessions() { return read(KEYS.sessions, []); }
  function recordSession(s) { const all = sessions(); all.push(s); write(KEYS.sessions, all.slice(-200)); }
  function avgDims(list) {
    const out = {};
    DIMS.forEach(d => {
      const vals = list.map(s => s.dimensions && s.dimensions[d]).filter(Number.isFinite);
      out[d] = vals.length ? Math.round(avg(vals)) : null;
    });
    return out;
  }
  function weakest(list) {
    const a = avgDims(list);
    let w = null;
    DIMS.forEach(d => { if (a[d] !== null && (w === null || a[d] < a[w])) w = d; });
    return w;
  }

  function renderProgress() {
    const view = $('progress');
    if (!view) return;
    let panel = $('progressSummary');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'progressSummary';
      panel.className = 'fx-panel';
      const hero = view.querySelector('.hero');
      hero ? hero.after(panel) : view.prepend(panel);
    }
    const list = sessions();
    if (!list.length) {
      panel.innerHTML =
        '<div class="fx-head"><h3>Your sessions</h3><span class="muted">No sessions yet</span></div>' +
        '<p class="muted">The charts below show sample data. Your real scores appear here after your first mock interview.</p>' +
        '<div class="fx-actions"><button class="btn btn-primary" type="button" data-action="start">Start mock interview →</button></div>';
      return;
    }
    const scores = list.map(s => s.score);
    const latest = scores[scores.length - 1];
    const trend = list.length > 1 ? latest - scores[0] : 0;
    const weak = weakest(list);
    const recent = list.slice(-5).reverse();
    panel.innerHTML =
      '<div class="fx-head"><h3>Your sessions</h3><span class="muted">' + list.length + ' recorded</span></div>' +
      '<div class="fx-stats">' +
        '<div><span>Average</span><strong>' + Math.round(avg(scores)) + '</strong></div>' +
        '<div><span>Best</span><strong>' + Math.max(...scores) + '</strong></div>' +
        '<div><span>Latest</span><strong>' + latest + '</strong></div>' +
        '<div><span>Since first</span><strong>' + (trend >= 0 ? '+' : '') + trend + '</strong></div>' +
      '</div>' +
      (weak ? '<p class="fx-focus"><strong>Focus:</strong> ' + esc(PLAN_BY_WEAK[weak]) + '</p>' : '') +
      '<ul class="fx-list">' + recent.map(s =>
        '<li><span class="muted">' + esc(new Date(s.at).toLocaleDateString()) + '</span> · ' +
        '<strong>' + s.score + '</strong> · ' + esc(s.question.slice(0, 80)) + (s.question.length > 80 ? '…' : '') + '</li>'
      ).join('') + '</ul>';
  }

  // ---------- greeting ----------
  function setGreeting() {
    const app = $('app');
    if (app && app.dataset.role === 'trainer') return;
    const eyebrow = document.querySelector('#dashboard .eyebrow');
    if (!eyebrow) return;
    const h = new Date().getHours();
    const part = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const user = read(KEYS.user, null);
    const first = user && (user.full_name || user.name || '').split(' ')[0];
    eyebrow.textContent = first ? part + ', ' + first : part;
  }

  // ---------- settings toggles ----------
  const TOGGLE_MAP = [['biometric', 'biometric'], ['adaptive', 'adaptive'], ['speaking', 'speaking'], ['camera', 'cameraPreview'], ['daily', 'dailyPractice']];
  function wireToggles() {
    document.querySelectorAll('.toggle[role="switch"]').forEach(old => {
      const label = (old.getAttribute('aria-label') || '').toLowerCase();
      const entry = TOGGLE_MAP.find(([needle]) => label.includes(needle));
      if (!entry) return;
      const key = entry[1];
      // Replace the node to drop the generic listener that only showed a toast.
      const t = old.cloneNode(true);
      old.replaceWith(t);
      t.setAttribute('aria-checked', String(!!settings[key]));
      t.addEventListener('click', () => {
        settings[key] = !settings[key];
        saveSettings();
        t.setAttribute('aria-checked', String(settings[key]));
        const name = t.getAttribute('aria-label').replace(/^Toggle /, '');
        toast(name + (settings[key] ? ' on' : ' off'));
      });
    });
  }

  // ---------- interview ----------
  let BASE = [];
  let reviewing = false;
  let submitting = false;
  let adaptiveInserted = 0;

  function roleValue() {
    const r = $('role');
    return (r && r.value) || 'Software Engineer';
  }

  function drafts() { return read(KEYS.drafts, {}); }
  function saveDraftFor(q, text) {
    const d = drafts();
    if (text.trim()) d[q] = text; else delete d[q];
    write(KEYS.drafts, d);
  }
  function clearDraft(q) { const d = drafts(); delete d[q]; write(KEYS.drafts, d); }

  function renderFeedback(r) {
    $('feedbackScore').textContent = r.score + '/100';
    $('feedbackStrength').textContent = (r.strength && r.strength.label) || '';
    $('feedbackImprovement').textContent = (r.improvement && r.improvement.label) || '';
    let box = $('feedbackDetails');
    if (!box) {
      box = document.createElement('div');
      box.id = 'feedbackDetails';
      box.className = 'feedback-details';
      $('feedbackCard').appendChild(box);
    }
    const rows = DIMS.map(d =>
      '<div class="dim-row"><span>' + DIM_LABEL[d] + '</span>' +
      '<div class="dim-bar" role="img" aria-label="' + DIM_LABEL[d] + ' ' + r.dimensions[d] + ' of 100"><i style="width:' + r.dimensions[d] + '%"></i></div>' +
      '<b>' + r.dimensions[d] + '</b></div>'
    ).join('');
    const tips = (r.tips && r.tips.length)
      ? '<ul class="feedback-tips">' + r.tips.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>'
      : '';
    const fillers = (r.fillerWords && r.fillerWords.length) ? ' · filler words: ' + r.fillerWords.map(f => f.word).join(', ') : '';
    const source = r.source === 'claude' ? 'Claude review' : 'PrepMate rule engine';
    box.innerHTML = rows + tips + '<p class="muted">' + source + ' · ' + r.wordCount + ' words' + fillers + '</p>';
    $('feedbackCard').hidden = false;
  }

  function adaptNext(result) {
    if (adaptiveInserted >= MAX_ADAPTIVE_INSERTS || qIndex >= questions.length - 1) return;
    const weakKey = result.improvement && result.improvement.key;
    const tag = WEAK_TO_TAG[weakKey];
    if (!tag) return;
    const candidate = BANK.find(b => b.tag === tag && !questions.includes(b.text));
    if (!candidate) return;
    questions.splice(qIndex + 1, 0, candidate.text);
    adaptiveInserted++;
  }

  function finishInterview() {
    clearInterval(timer);
    questions.splice(0, questions.length, ...BASE);
    adaptiveInserted = 0;
    qIndex = 0;
    reviewing = false;
    seconds = 120;
    renderQuestion();
    $('timer').textContent = '02:00';
    renderProgress();
    navigate('progress');
    toast('Interview complete · your progress is updated');
  }

  function advance() {
    if (qIndex < questions.length - 1) {
      qIndex++;
      seconds = 120;
      renderQuestion();
    } else {
      finishInterview();
    }
  }

  window.nextQuestion = async function () {
    if (submitting) return;
    const btn = $('nextBtn');
    if (reviewing) { advance(); return; }

    const answer = $('answer').value.trim();
    if (!answer) { toast('Add an answer before continuing'); return; }

    const q = questions[qIndex];
    submitting = true;
    btn.disabled = true;
    btn.textContent = 'Evaluating…';
    let result;
    try {
      const res = await fetch('/api/interview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, answer: answer, role: roleValue() }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      result = await res.json();
      if (!Number.isFinite(result.score)) throw new Error('Unexpected response');
    } catch (err) {
      console.warn('Interview evaluation failed:', err);
      toast('Evaluation is unavailable right now. Your answer is kept, so try again.');
      btn.disabled = false;
      btn.textContent = 'Submit & continue →';
      submitting = false;
      return;
    }
    submitting = false;

    recordSession({
      at: new Date().toISOString(),
      role: roleValue(),
      question: q,
      answer: answer,
      score: result.score,
      dimensions: result.dimensions,
      source: result.source || 'rules',
      wordCount: result.wordCount,
    });
    clearDraft(q);
    renderFeedback(result);
    renderProgress();

    // Show the feedback first. The next question loads when the user continues.
    reviewing = true;
    btn.disabled = false;
    btn.textContent = qIndex === questions.length - 1 ? 'Finish interview ✓' : 'Next question →';
    if (settings.adaptive) adaptNext(result);
    toast('Evaluated · ' + result.score + '/100');
  };

  const origRender = window.renderQuestion;
  window.renderQuestion = function () {
    reviewing = false;
    origRender();
    const a = $('answer');
    const saved = drafts()[questions[qIndex]];
    if (saved) a.value = saved;
    $('wordCount').textContent = wordCount(a.value);
    const btn = $('nextBtn');
    if (btn) { btn.disabled = false; btn.textContent = qIndex === questions.length - 1 ? 'Finish interview ✓' : 'Submit & continue →'; }
  };

  window.resetInterview = function () {
    questions.splice(0, questions.length, ...BASE);
    adaptiveInserted = 0;
    reviewing = false;
    qIndex = 0;
    seconds = 120;
    renderQuestion();
    startTimer();
  };

  window.saveDraft = function () {
    saveDraftFor(questions[qIndex], $('answer').value);
    toast('Draft saved on this device');
  };

  function wireDraftAutosave() {
    const a = $('answer');
    if (!a) return;
    let t = null;
    a.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => saveDraftFor(questions[qIndex], a.value), 300);
    });
  }

  // Keep original mic and camera behavior, but respect the Settings toggles.
  const origToggleMic = window.toggleMic;
  window.toggleMic = function () {
    if (!settings.speaking && !recording) { toast('Speech input is off in Settings'); return; }
    return origToggleMic.apply(this, arguments);
  };
  const origOpenCamera = window.openCamera;
  window.openCamera = function () {
    if (!settings.cameraPreview) { toast('Camera coaching is off in Settings'); return; }
    return origOpenCamera.apply(this, arguments);
  };
  const origFingerprint = window.useFingerprint;
  window.useFingerprint = function () {
    if (!settings.biometric) { toast('Biometric sign-in is off in Settings'); return; }
    return origFingerprint.apply(this, arguments);
  };

  // ---------- grooming: real frame and audio checks ----------
  let checks = Object.assign({ lighting: false, framing: false, audio: false, background: false, eyeline: false }, read(KEYS.checks, {}));

  function paintChecks() {
    const done = CHECKS.filter(k => checks[k]).length;
    const score = $('checkScore');
    if (score) score.textContent = Math.round((done / CHECKS.length) * 100);
    CHECKS.forEach(k => {
      const b = document.querySelector('[data-check="' + k + '"]');
      if (b) {
        b.classList.toggle('check-done', !!checks[k]);
        b.setAttribute('aria-pressed', String(!!checks[k]));
      }
    });
  }

  function isUserImage(img) { return !!img.src && !img.src.startsWith('data:image/svg') && img.naturalWidth > 0; }

  function drawTo(source, w, h) {
    const scale = Math.min(1, 320 / w);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    return c;
  }

  function currentFrame() {
    const video = $('video');
    if (mediaStream && video && video.videoWidth) return drawTo(video, video.videoWidth, video.videoHeight);
    const img = $('photoPreview');
    if (img && isUserImage(img)) return drawTo(img, img.naturalWidth, img.naturalHeight);
    return null;
  }

  function analyzeFrame(canvas) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    let total = 0, centreSum = 0, centreN = 0, edgeSum = 0, edgeN = 0;
    const edge = [];
    const x0 = w * 0.3, x1 = w * 0.7, y0 = h * 0.25, y1 = h * 0.85;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const L = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        total += L;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) { centreSum += L; centreN++; }
        else { edgeSum += L; edgeN++; edge.push(L); }
      }
    }
    const edgeMean = edgeSum / Math.max(1, edgeN);
    const edgeStd = Math.sqrt(edge.reduce((a, v) => a + (v - edgeMean) * (v - edgeMean), 0) / Math.max(1, edge.length));
    return {
      mean: total / (w * h),
      centreMean: centreSum / Math.max(1, centreN),
      edgeMean: edgeMean,
      edgeStd: edgeStd,
    };
  }

  function lightingVerdict(a) {
    if (a.mean < 70) return { ok: false, msg: 'Too dark. Face a window or a lamp so your face is evenly lit.' };
    if (a.mean > 225) return { ok: false, msg: 'Very bright overall. Lower the exposure or move away from direct light.' };
    if (a.edgeMean - a.centreMean > 45) return { ok: false, msg: 'Looks backlit: the background is much brighter than you. Put the light in front of you.' };
    return { ok: true, msg: 'Lighting looks even and face-friendly.' };
  }

  function backgroundVerdict(a) {
    return a.edgeStd > 55
      ? { ok: false, msg: 'Background looks busy. Use a plain wall or blur the background.' }
      : { ok: true, msg: 'Background looks clean and simple.' };
  }

  async function framingVerdict(canvas) {
    if (!('FaceDetector' in window)) {
      return { ok: null, msg: 'Automatic framing needs face detection, which this browser does not support. Check it yourself.' };
    }
    try {
      const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      const faces = await detector.detect(canvas);
      if (!faces.length) return { ok: false, msg: 'No face found. Centre your face in the frame.' };
      const b = faces[0].boundingBox;
      const cx = (b.x + b.width / 2) / canvas.width;
      const ratio = b.height / canvas.height;
      if (Math.abs(cx - 0.5) > 0.15) return { ok: false, msg: 'Your face is off-centre. Move so it sits in the middle.' };
      if (ratio < 0.2) return { ok: false, msg: 'You look small in the frame. Move closer or use head-and-shoulders framing.' };
      if (ratio > 0.7) return { ok: false, msg: 'Too close. Lean back so your shoulders are visible.' };
      return { ok: true, msg: 'Framing looks centred with headroom.' };
    } catch (e) {
      return { ok: null, msg: 'Face detection could not run on this image.' };
    }
  }

  async function audioVerdict() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: null, msg: 'Microphone access is not available here. Check your audio yourself.' };
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      return { ok: false, msg: 'Microphone permission was blocked. Allow it in the browser and try again.' };
    }
    let ctx = null;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);
      let sumSq = 0, samples = 0;
      await new Promise(resolve => {
        const start = Date.now();
        const tick = () => {
          analyser.getFloatTimeDomainData(buf);
          for (let i = 0; i < buf.length; i++) sumSq += buf[i] * buf[i];
          samples += buf.length;
          if (Date.now() - start < 1500) setTimeout(tick, 50); else resolve();
        };
        tick();
      });
      const rms = Math.sqrt(sumSq / Math.max(1, samples));
      if (rms < 0.01) return { ok: false, msg: 'Input is very quiet. Move closer to the microphone.' };
      if (rms > 0.4) return { ok: false, msg: 'Input is clipping. Move slightly back from the microphone.' };
      return { ok: true, msg: 'Clear input level detected.' };
    } finally {
      if (ctx) ctx.close().catch(() => {});
      stream.getTracks().forEach(t => t.stop());
    }
  }

  // Applies a set of checks to a frame, updates state, and returns messages.
  async function evaluateFrame(keys, canvas) {
    const messages = [];
    const frameStats = analyzeFrame(canvas);
    for (const k of keys) {
      let r = null;
      if (k === 'lighting') r = lightingVerdict(frameStats);
      else if (k === 'background') r = backgroundVerdict(frameStats);
      else if (k === 'framing') r = await framingVerdict(canvas);
      if (!r) continue;
      if (r.ok !== null) checks[k] = r.ok;
      messages.push(r.msg);
    }
    write(KEYS.checks, checks);
    paintChecks();
    return messages;
  }

  window.runCheck = async function (key) {
    try {
      if (key === 'lighting' || key === 'framing' || key === 'background') {
        const canvas = currentFrame();
        if (!canvas) { toast('Open the camera or upload a photo first, then run this check.'); return; }
        const msgs = await evaluateFrame([key], canvas);
        toast(msgs.join(' ') || 'Check could not run.');
        return;
      }
      if (key === 'audio') {
        const r = await audioVerdict();
        if (r.ok !== null) checks.audio = r.ok;
        write(KEYS.checks, checks);
        paintChecks();
        toast(r.msg);
        return;
      }
      if (key === 'eyeline') {
        const ok = window.confirm('Is the interview window close to your camera, so your eyes look toward the lens?');
        checks.eyeline = ok;
        write(KEYS.checks, checks);
        paintChecks();
        toast(ok ? 'Eye-line set near the lens.' : 'Move the interview window closer to your camera.');
      }
    } catch (err) {
      console.warn('Check failed:', err);
      toast('That check could not run. Try again.');
    }
  };

  window.markAllReady = function () {
    CHECKS.forEach(k => { checks[k] = true; });
    write(KEYS.checks, checks);
    paintChecks();
    toast('Marked ready by you. Run the live checks to verify each item.');
  };

  // Auto-check each photo the user loads or captures.
  function autoCheckPhoto(img) {
    const canvas = drawTo(img, img.naturalWidth, img.naturalHeight);
    evaluateFrame(['lighting', 'framing', 'background'], canvas).then(msgs => {
      if (msgs.length) toast(msgs.join(' '));
    }).catch(() => {});
  }

  // ---------- resume analysis ----------
  function renderResume(r) {
    const out = $('resumeResults');
    if (!out) return;
    const groups = Object.entries(r.skillGroups || {}).map(([g, list]) =>
      '<div class="fx-group"><span class="muted">' + esc(g) + '</span><div class="fx-chips">' +
      list.map(s => '<span class="chip">' + esc(s) + '</span>').join('') + '</div></div>'
    ).join('') || '<p class="muted">No known skills detected. Add a skills section with concrete technologies.</p>';
    const roles = (r.roles || []).slice(0, 4).map(x =>
      '<div class="dim-row"><span>' + esc(x.role) + '</span><div class="dim-bar"><i style="width:' + x.match + '%"></i></div><b>' + x.match + '%</b></div>'
    ).join('');
    const tips = (r.suggestions || []).length
      ? '<ul class="feedback-tips">' + r.suggestions.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>'
      : '<p class="muted">Looks complete. Keep it updated as you learn.</p>';
    out.innerHTML =
      '<div class="fx-head" style="margin-top:18px"><h3>Profile analysis</h3><span class="muted">' + r.completeness + '% complete</span></div>' +
      groups + '<div class="fx-subhead">Best-fit roles</div><div class="feedback-details">' + roles + '</div>' +
      '<div class="fx-subhead">Suggestions</div>' + tips;
    const pc = $('profileComplete');
    if (pc) pc.textContent = r.completeness + '%';
  }

  async function analyzeResume() {
    const text = $('resumeText').value.trim();
    const btn = $('analyzeResumeBtn');
    if (!text) { toast('Paste your resume text first.'); return; }
    btn.disabled = true;
    btn.textContent = 'Analyzing…';
    try {
      const res = await fetch('/api/resume', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const r = await res.json();
      write(KEYS.resume, Object.assign({ at: new Date().toISOString() }, r));
      renderResume(r);
      toast('Resume analyzed · ' + r.skills.length + ' skills found');
    } catch (err) {
      console.warn('Resume analysis failed:', err);
      toast('Resume analysis is unavailable right now. Try again.');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Analyze resume';
    }
  }

  window.handleResume = function (input) {
    const f = input.files && input.files[0];
    if (!f) return;
    $('resumeStatus').textContent = f.name + ' · uploaded just now';
    if (/\.txt$/i.test(f.name) || f.type === 'text/plain') {
      const reader = new FileReader();
      reader.onload = () => { $('resumeText').value = String(reader.result || ''); analyzeResume(); };
      reader.readAsText(f);
    } else {
      $('resumeText').focus();
      toast('PDF and Word need text extraction. Paste your resume text below, then analyze.');
    }
  };

  function wireResume() {
    const section = $('resume');
    if (!section) return;
    const choose = Array.from(section.querySelectorAll('button')).find(b => b.textContent.trim() === 'Choose file');
    if (choose) choose.addEventListener('click', () => $('resumeFile').click());

    const panel = document.createElement('div');
    panel.id = 'resumeAnalyzer';
    panel.className = 'fx-panel';
    panel.innerHTML =
      '<div class="fx-head"><h3>Analyze your resume</h3><span class="muted">Skills, sections, and best-fit roles</span></div>' +
      '<p class="muted">PDF and Word files need text extraction, so paste the text here or upload a .txt file. Analysis runs on the server and nothing is stored.</p>' +
      '<textarea id="resumeText" class="fx-textarea" aria-label="Resume text" placeholder="Paste your resume text here…"></textarea>' +
      '<div class="fx-actions"><button id="analyzeResumeBtn" class="btn btn-primary" type="button">Analyze resume</button></div>' +
      '<div id="resumeResults"></div>';
    section.appendChild(panel);
    $('analyzeResumeBtn').addEventListener('click', analyzeResume);

    const saved = read(KEYS.resume, null);
    if (saved && saved.skillGroups) renderResume(saved);
  }

  // ---------- dashboard: practice plan ----------
  window.generatePracticePlan = function () {
    const list = sessions();
    const weak = list.length ? weakest(list) : 'structure';
    const items = [
      PLAN_BY_WEAK[weak],
      'Answer one question from the bank out loud before typing it.',
      'Read your last feedback card and rewrite one sentence.',
    ];
    write(KEYS.plan, { date: new Date().toDateString(), items: items });
    showPlan(items);
    toast(list.length ? 'Plan built from your weakest area.' : 'Plan created. Complete a session to personalize it.');
  };

  function showPlan(items) {
    let panel = $('practicePlan');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'practicePlan';
      panel.className = 'fx-panel';
      const hero = $('dashboard').querySelector('.hero');
      hero.after(panel);
    }
    panel.innerHTML =
      '<div class="fx-head"><h3>Today\u2019s practice plan</h3><span class="muted">About 12 minutes</span></div>' +
      '<ol class="fx-list">' + items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ol>' +
      '<div class="fx-actions"><button class="btn btn-primary" type="button" data-action="start">Start practice</button>' +
      '<button class="btn btn-secondary" type="button" data-action="dismiss-plan">Dismiss</button></div>';
  }

  function restorePlan() {
    const plan = read(KEYS.plan, null);
    if (plan && plan.date === new Date().toDateString() && plan.items) showPlan(plan.items);
  }

  // ---------- progress: CSV export ----------
  window.exportCsv = function () {
    const list = sessions();
    if (!list.length) { toast('No sessions yet. Complete a mock interview to export.'); return; }
    const header = ['at', 'role', 'question', 'answer', 'score', 'clarity', 'structure', 'relevance', 'impact', 'ownership', 'source', 'wordCount'];
    const q = v => '"' + String(v === undefined || v === null ? '' : v).replace(/"/g, '""') + '"';
    const rows = list.map(s => [
      s.at, s.role, s.question, s.answer, s.score,
      ...DIMS.map(d => s.dimensions && s.dimensions[d]),
      s.source, s.wordCount,
    ].map(q).join(','));
    const csv = [header.join(','), ...rows].join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prepmate-sessions.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Exported ' + list.length + ' session' + (list.length === 1 ? '' : 's') + ' to CSV.');
  };

  // ---------- notifications ----------
  window.showNotifications = function () {
    const list = sessions();
    const plan = read(KEYS.plan, null);
    const parts = [];
    if (plan && plan.date === new Date().toDateString()) parts.push('Today\u2019s plan is ready');
    if (list.length) parts.push(list.length + ' session' + (list.length === 1 ? '' : 's') + ' recorded');
    toast(parts.length ? parts.join(' · ') : 'No new notifications');
  };

  // ---------- event delegation for buttons created by this module ----------
  document.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'start') window.startInterview && startInterview();
    if (action === 'dismiss-plan') { const p = $('practicePlan'); if (p) p.remove(); }
  });

  // ---------- styles for the features added here ----------
  function injectStyles() {
    const css = `
.fx-panel{margin:0 0 18px;padding:20px;background:var(--surface);border:1px solid var(--line);border-radius:var(--radius,18px);box-shadow:var(--shadow-sm)}
.fx-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px}
.fx-head h3{margin:0;font-size:15px;font-weight:800}
.fx-subhead{margin:16px 0 8px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)}
.fx-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
.fx-list{margin:8px 0 0;padding-left:20px;display:grid;gap:8px;font-size:14px;line-height:1.5}
.fx-focus{margin:10px 0 0;font-size:14px;line-height:1.5}
.fx-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:6px}
.fx-stats>div{padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2,var(--surface))}
.fx-stats span{display:block;font-size:11px;color:var(--muted);font-weight:700}
.fx-stats strong{font-size:22px;letter-spacing:-.02em}
.fx-textarea{width:100%;min-height:150px;padding:12px;border-radius:12px;border:1px solid var(--line);background:var(--surface-2,var(--surface));color:var(--text);font:inherit;resize:vertical}
.fx-textarea:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
.fx-group{margin:10px 0}
.fx-group>span{font-size:12px;font-weight:700}
.fx-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.feedback-details{margin-top:14px;display:grid;gap:9px}
.dim-row{display:grid;grid-template-columns:96px 1fr 34px;gap:10px;align-items:center;font-size:13px}
.dim-row b{text-align:right;font-variant-numeric:tabular-nums}
.dim-bar{height:6px;border-radius:99px;background:var(--line);overflow:hidden}
.dim-bar i{display:block;height:100%;background:var(--primary);border-radius:99px;transition:width .5s cubic-bezier(.22,1,.36,1)}
.feedback-tips{margin:10px 0 0;padding-left:18px;font-size:13px;color:var(--muted);line-height:1.6}
.check-done{box-shadow:0 0 0 2px var(--success) inset}
@media (max-width:700px){.fx-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (prefers-reduced-motion:reduce){.dim-bar i{transition:none}}`;
    const style = document.createElement('style');
    style.id = 'features-css';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Recompute the greeting whenever the account view changes (login, logout, role switch).
  if (typeof window.applyAccountView === 'function') {
    const origApplyAccountView = window.applyAccountView;
    window.applyAccountView = function (user) {
      origApplyAccountView.apply(this, arguments);
      setGreeting();
    };
  }

  // ---------- init ----------
  function init() {
    try {
      BASE = (typeof questions !== 'undefined') ? questions.slice() : [];
      injectStyles();
      setGreeting();
      wireToggles();
      wireDraftAutosave();
      wireResume();
      restorePlan();
      paintChecks();
      renderProgress();
      const img = $('photoPreview');
      if (img) img.addEventListener('load', () => { if (isUserImage(img)) autoCheckPhoto(img); });
    } catch (err) {
      console.error('PrepMate features failed to initialise:', err);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
