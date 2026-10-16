// PrepMate interview evaluator.
//
// Two layers:
//  1. Rule-based NLP (always on, no keys needed). Scores clarity, STAR structure,
//     relevance to the question, measurable impact, and ownership ("I" vs "we"),
//     and detects filler words. Deterministic and explainable.
//  2. Optional Claude review (when ANTHROPIC_API_KEY is set on Vercel). Asks the
//     model for JSON scores and coaching notes. If the call fails or times out,
//     the rule-based result is returned instead, with source: "rules".
//
// Request:  POST { question, answer, role? }
// Response: { score, role, feedback, wordCount, source, dimensions, strength,
//             improvement, tips, fillerWords, questionType, starCoverage }

const MAX_ANSWER_CHARS = 6000;

const FILLERS = ['um', 'uh', 'er', 'basically', 'literally', 'you know', 'kind of', 'sort of', 'actually', 'honestly'];

const STOPWORDS = new Set([
  'the','and','for','are','but','not','you','all','any','can','had','her','was','one','our','out','day','get','has','him','his',
  'how','its','may','new','now','old','see','two','who','did','let','put','say','she','too','use','what','when','where','which',
  'with','this','that','from','they','have','will','your','about','would','there','their','been','than','them','these','into',
  'just','like','more','some','such','only','over','also','other','because','being','does','make','most','very','much','tell',
  'me','is','it','of','to','in','on','at','as','be','an','or','by','if','so','do','we','my','i','a','role','time',
]);

const ROLE_KEYWORDS = {
  'software engineer': ['code', 'system', 'API', 'debug', 'test', 'deploy', 'feature', 'performance', 'scale', 'architecture', 'algorithm'],
  'ml engineer': ['model', 'data', 'training', 'accuracy', 'pipeline', 'evaluation', 'dataset', 'inference', 'experiment'],
  'data analyst': ['data', 'dashboard', 'insight', 'metric', 'query', 'report', 'analysis', 'trend', 'SQL', 'visualization'],
  'product engineer': ['user', 'product', 'customer', 'feedback', 'experiment', 'launch', 'prototype', 'iteration', 'outcome'],
};

function words(text) {
  return text.toLowerCase().match(/[a-z0-9][a-z0-9'+#%-]*/g) || [];
}

function contentWords(text) {
  return words(text).filter(w => w.length > 3 && !STOPWORDS.has(w));
}

function clamp(n, lo = 0, hi = 100) {
  const v = Number.isFinite(n) ? n : lo;
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function sentences(text) {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

function questionType(question) {
  const q = question.toLowerCase();
  if (/tell me about yourself/.test(q)) return 'introduction';
  if (/\b(a time|faced|difficult|challenge|conflict|failed|mistake|disagree)\b/.test(q)) return 'behavioral';
  if (/\bwhy\b/.test(q)) return 'motivation';
  if (/\bproject\b/.test(q)) return 'project';
  if (/\b(explain|concept|how does|design|algorithm|what is)\b/.test(q)) return 'technical';
  return 'general';
}

function countMatches(text, regex) {
  const m = text.match(regex);
  return m ? m.length : 0;
}

function detectFillers(text) {
  const lower = text.toLowerCase();
  const found = [];
  for (const f of FILLERS) {
    const re = new RegExp('\\b' + f.replace(/ /g, '\\s+') + '\\b', 'g');
    const n = countMatches(lower, re);
    if (n) found.push({ word: f, count: n });
  }
  return found;
}

function starCoverage(answer) {
  return {
    situation: /\b(when|while|during|at my|in my|as part of|our team|the project|internship|hackathon|college|company|class|previous)\b/i.test(answer),
    task: /\b(goal|needed to|had to|task|responsible for|challenge|problem|requirement|objective|expected to)\b/i.test(answer),
    action: countMatches(answer, /\bI\s+(?:also\s+|then\s+|first\s+|personally\s+)?(?:[a-z]+ed|built|wrote|ran|made|led|set|took|chose|found|did|cut|rewrote|split|grew|kept|sent|went|ran|got|gave)\b/gi) > 0,
    result: /\b(result|resulted|outcome|improved|reduced|increased|saved|achieved|delivered|eventually|finally|led to|because of this)\b/i.test(answer),
  };
}

function evaluateRules({ question, answer, role }) {
  const text = answer.trim();
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  const sents = sentences(text);
  const avgSentence = sents.length ? wordCount / sents.length : 0;
  const qType = questionType(question);
  const fillers = detectFillers(text);
  const fillerTotal = fillers.reduce((a, f) => a + f.count, 0);

  // Clarity: length band, sentence length, filler penalty.
  let lengthScore;
  if (wordCount < 25) lengthScore = 25;
  else if (wordCount < 70) lengthScore = 55 + ((wordCount - 25) / 45) * 30;
  else if (wordCount <= 220) lengthScore = 90;
  else lengthScore = Math.max(55, 90 - (wordCount - 220) * 0.2);
  const sentencePenalty = avgSentence > 28 ? 10 : avgSentence < 5 && wordCount > 30 ? 5 : 0;
  const clarity = clamp(lengthScore - sentencePenalty - Math.min(30, fillerTotal * 6));

  // Structure: STAR for behavioral/project, otherwise sequencing and connectives.
  const star = starCoverage(text);
  const starCount = Object.values(star).filter(Boolean).length;
  let structure;
  if (qType === 'behavioral' || qType === 'project') {
    structure = clamp((starCount / 4) * 100);
  } else {
    const connectives = countMatches(text, /\b(first|second|then|finally|because|so that|as a result|however|for example|for instance|in summary|overall)\b/gi);
    structure = clamp(40 + Math.min(sents.length, 6) * 6 + Math.min(connectives, 3) * 8);
  }

  // Relevance: overlap between content words in the question and the answer.
  const qKeys = [...new Set(contentWords(question))];
  const aStems = new Set(contentWords(text).map(w => w.slice(0, 5)));
  const overlap = qKeys.filter(k => aStems.has(k.slice(0, 5))).length;
  const roleKeys = ROLE_KEYWORDS[(role || '').toLowerCase()] || [];
  const lowerText = text.toLowerCase();
  const roleHits = roleKeys.filter(k => lowerText.includes(k.toLowerCase())).length;
  const qRatio = qKeys.length ? overlap / Math.min(qKeys.length, 6) : 0.5;
  let relevance = 30 + qRatio * 50 + Math.min(roleHits, 3) * 5;
  // A well-formed behavioral or project answer is on-topic even when it does not repeat the question's words.
  if ((qType === 'behavioral' || qType === 'project') && star.task && star.action) relevance = Math.max(relevance, 62);
  relevance = clamp(relevance);

  // Impact: numbers, measurable outcomes, and result language.
  const metrics = countMatches(text, /(\d+(\.\d+)?\s?(%|x|ms|sec|seconds|minutes|mins|hours|hrs|days|weeks|users|students|people|lines|tests|k\b|lakh|crore))|(₹\s?\d[\d,]*)|(\$\s?\d[\d,]*)|(\b\d{2,}\b)/gi);
  const impact = clamp((metrics >= 2 ? 75 : metrics === 1 ? 55 : 25) + (star.result ? 20 : 0));

  // Ownership: first-person singular should dominate over "we".
  const iCount = countMatches(text, /\bI\b/g);
  const weCount = countMatches(text, /\b(we|our|us)\b/gi);
  const ownership = clamp(35 + Math.min(iCount, 5) * 12 - Math.max(0, weCount - iCount) * 8);

  const dimensions = { clarity, structure, relevance, impact, ownership };
  const score = clamp(0.25 * clarity + 0.25 * structure + 0.2 * relevance + 0.2 * impact + 0.1 * ownership, 0, 95);

  const labels = {
    clarity: 'Clear, well-paced delivery',
    structure: 'Good answer structure',
    relevance: 'Stayed on the question',
    impact: 'Showed measurable impact',
    ownership: 'Owned your contribution',
  };
  const sorted = Object.entries(dimensions).sort((a, b) => b[1] - a[1]);
  const topKey = sorted[0][0];
  const lowKey = sorted[sorted.length - 1][0];

  const improvementText = {
    clarity: fillerTotal
      ? `Cut filler words (${fillers.map(f => f.word).slice(0, 3).join(', ')}) and shorten your longest sentences.`
      : wordCount < 70
        ? 'Expand with one concrete example. Aim for roughly 90 to 150 words.'
        : 'Break your longest sentences into two shorter ones for easier listening.',
    structure: qType === 'behavioral' || qType === 'project'
      ? `Use STAR: ${[!star.situation && 'set the situation', !star.task && 'state the goal', !star.action && 'describe what you personally did', !star.result && 'end with the result'].filter(Boolean).join(', ') || 'keep this flow'}.`
      : 'Organize your answer into a clear beginning, middle, and end, with a signpost like "first" or "as a result."',
    relevance: qKeys.length
      ? `Connect the answer back to the question's focus: ${qKeys.slice(0, 3).join(', ')}.`
      : 'Answer the question directly in your first sentence.',
    impact: 'Add one measurable outcome: a number, percentage, time saved, or users affected.',
    ownership: iCount < 2
      ? 'Describe what you did yourself using "I," then briefly note what the team contributed.'
      : `You used "we" or "our" ${weCount} time${weCount === 1 ? '' : 's'}. Make clear which decisions and actions were yours.`,
  };

  const secondKey = sorted.length > 2 ? sorted[sorted.length - 2][0] : null;
  const tips = [...new Set([improvementText[lowKey], secondKey && improvementText[secondKey]].filter(Boolean))].slice(0, 2);

  return {
    score,
    dimensions,
    strength: { key: topKey, label: labels[topKey] },
    improvement: { key: lowKey, label: improvementText[lowKey] },
    tips,
    fillerWords: fillers,
    questionType: qType,
    starCoverage: qType === 'behavioral' || qType === 'project' ? star : null,
    wordCount,
    source: 'rules',
  };
}

async function evaluateWithClaude({ question, answer, role, rules }) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const model = process.env.ANTHROPIC_MODEL || 'claude-haiku-5-5';

  const system = [
    'You are an experienced technical interview coach for students preparing for campus placements.',
    'Evaluate the candidate answer fairly and specifically. Do not flatter. Do not invent facts about the candidate.',
    'Return ONLY a JSON object, with no preamble and no markdown fences, using exactly this shape:',
    '{"score":0-100,"dimensions":{"clarity":0-100,"structure":0-100,"relevance":0-100,"impact":0-100,"ownership":0-100},"strength":"one short sentence","improvement":"one specific, actionable sentence","tips":["up to two short actionable tips"]}',
  ].join(' ');

  const user = `Role: ${role || 'Software Engineer'}\nQuestion: ${question}\nAnswer: ${answer}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    const parsed = JSON.parse(text.replace(/```json|```/g, '').trim());

    // Use the model's number when it is valid; otherwise keep the rule-based value.
    const pick = (v, fallback) => (Number.isFinite(Number(v)) ? clamp(Number(v), 0, 100) : fallback);
    const dims = parsed.dimensions || {};
    return {
      ...rules,
      score: pick(parsed.score, rules.score),
      dimensions: {
        clarity: pick(dims.clarity, rules.dimensions.clarity),
        structure: pick(dims.structure, rules.dimensions.structure),
        relevance: pick(dims.relevance, rules.dimensions.relevance),
        impact: pick(dims.impact, rules.dimensions.impact),
        ownership: pick(dims.ownership, rules.dimensions.ownership),
      },
      strength: { key: rules.strength.key, label: String(parsed.strength || rules.strength.label).slice(0, 200) },
      improvement: { key: rules.improvement.key, label: String(parsed.improvement || rules.improvement.label).slice(0, 300) },
      tips: Array.isArray(parsed.tips) ? parsed.tips.slice(0, 2).map(t => String(t).slice(0, 200)) : rules.tips,
      source: 'claude',
    };
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { question, answer, role } = req.body || {};
    if (!question || !answer || !String(answer).trim()) return res.status(400).json({ error: 'question and answer are required' });
    if (typeof answer !== 'string' || answer.length > MAX_ANSWER_CHARS) {
      return res.status(400).json({ error: `answer must be text under ${MAX_ANSWER_CHARS} characters` });
    }

    const q = String(question);
    const rules = evaluateRules({ question: q, answer, role });
    const result = (await evaluateWithClaude({ question: q, answer, role, rules })) || rules;

    res.status(200).json({
      ...result,
      role: role || 'Software Engineer',
      feedback: result.improvement.label,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
