// PrepMate resume analyzer.
// POST { text } -> { skills, skillGroups, sections, completeness, roles, suggestions, wordCount }
//
// Deterministic extraction against a skill taxonomy with aliases, plus section
// detection and role matching. No external calls, so it works without keys.

const MAX_TEXT_CHARS = 30000;

// Canonical skill -> aliases that should count as a match (matched on word boundaries).
const SKILLS = {
  Languages: {
    'Java': ['java'],
    'Python': ['python'],
    'JavaScript': ['javascript'],
    'TypeScript': ['typescript'],
    'C++': ['c++', 'cpp'],
    'SQL': ['sql', 'mysql', 'postgresql', 'postgres', 'sqlite'],
  },
  Web: {
    'React': ['react', 'reactjs', 'react.js'],
    'Node.js': ['node', 'node.js', 'nodejs'],
    'Express': ['express', 'expressjs'],
    'Next.js': ['next.js', 'nextjs'],
    'HTML/CSS': ['html', 'css'],
    'Tailwind CSS': ['tailwind', 'tailwindcss'],
    'REST APIs': ['rest api', 'rest apis', 'restful'],
    'MongoDB': ['mongodb', 'mongo'],
    'Supabase': ['supabase'],
    'Firebase': ['firebase'],
  },
  'Data & ML': {
    'Machine Learning': ['machine learning'],
    'Deep Learning': ['deep learning'],
    'NLP': ['nlp', 'natural language processing'],
    'Computer Vision': ['computer vision', 'opencv'],
    'TensorFlow': ['tensorflow'],
    'PyTorch': ['pytorch'],
    'scikit-learn': ['scikit-learn', 'sklearn'],
    'Pandas': ['pandas'],
    'NumPy': ['numpy'],
    'Power BI': ['power bi', 'powerbi'],
    'Excel': ['excel'],
  },
  'Engineering & Tools': {
    'Data Structures & Algorithms': ['dsa', 'data structures', 'algorithms'],
    'System Design': ['system design'],
    'Git': ['git', 'github'],
    'Docker': ['docker'],
    'Kubernetes': ['kubernetes', 'k8s'],
    'AWS': ['aws', 'amazon web services'],
    'Linux': ['linux', 'ubuntu'],
    'Figma': ['figma'],
    'Agile/Scrum': ['agile', 'scrum'],
  },
};

const SECTION_PATTERNS = {
  education: /\b(education|academic|b\.?tech|b\.?e\.?|bachelor|university|college|cgpa|gpa)\b/i,
  projects: /\b(projects?|hackathon|built|developed)\b/i,
  experience: /\b(experience|internship|intern|work history|employment)\b/i,
  skills: /\b(skills?|technologies|tech stack|tools)\b/i,
  certifications: /\b(certifications?|certified|certificate|courses?)\b/i,
  contact: /(@|\+?\d[\d\s-]{7,}|linkedin|github\.com)/i,
};

// Role suggestions from skill clusters.
const ROLE_PROFILES = [
  { role: 'Software Engineer', needs: ['Java', 'Python', 'JavaScript', 'Data Structures & Algorithms', 'Git', 'SQL'] },
  { role: 'ML Engineer', needs: ['Python', 'Machine Learning', 'TensorFlow', 'PyTorch', 'scikit-learn', 'Pandas', 'NumPy', 'Deep Learning'] },
  { role: 'Data Analyst', needs: ['SQL', 'Python', 'Excel', 'Power BI', 'Pandas'] },
  { role: 'Product Engineer', needs: ['React', 'Node.js', 'TypeScript', 'REST APIs', 'Next.js', 'Figma'] },
];

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasTerm(text, term) {
  // Boundaries that also work for terms ending in symbols such as "c++" or "next.js".
  const re = new RegExp('(^|[^a-z0-9+#])' + escapeRegex(term) + '($|[^a-z0-9+#])', 'i');
  return re.test(text);
}

function extractSkills(text) {
  const lower = text.toLowerCase();
  const groups = {};
  const found = new Set();
  for (const [group, skills] of Object.entries(SKILLS)) {
    for (const [canonical, aliases] of Object.entries(skills)) {
      const terms = [canonical.toLowerCase(), ...aliases];
      if (terms.some(t => hasTerm(lower, t))) {
        found.add(canonical);
        (groups[group] ||= []).push(canonical);
      }
    }
  }
  return { skills: [...found], skillGroups: groups };
}

function detectSections(text) {
  const result = {};
  for (const [name, re] of Object.entries(SECTION_PATTERNS)) {
    result[name] = re.test(text);
  }
  return result;
}

function completenessScore(sections, skillCount, wordCount) {
  let points = 0;
  const weights = { education: 15, projects: 20, experience: 20, skills: 10, certifications: 10, contact: 10 };
  for (const [k, w] of Object.entries(weights)) if (sections[k]) points += w;
  points += Math.min(skillCount, 8) * 1.25; // up to 10 points
  if (wordCount >= 150 && wordCount <= 900) points += 5;
  return Math.min(100, Math.round(points));
}

function suggestRoles(skills) {
  const set = new Set(skills);
  return ROLE_PROFILES.map(p => {
    const matched = p.needs.filter(n => set.has(n));
    return { role: p.role, match: Math.round((matched.length / p.needs.length) * 100), matchedSkills: matched };
  }).sort((a, b) => b.match - a.match);
}

function suggestions(sections, skills, wordCount, hasNumbers) {
  const tips = [];
  if (!sections.contact) tips.push('Add an email, phone number, and a GitHub or LinkedIn link at the top.');
  if (!sections.projects) tips.push('Add 2 to 3 projects with one line each on what you built and the result.');
  if (!sections.experience) tips.push('Add internships, hackathons, or volunteer work, even if they were short.');
  if (!sections.certifications) tips.push('List recent certifications with the year, such as cloud or AI credentials.');
  if (skills.length < 5) tips.push('List at least five concrete technologies so recruiters can scan your stack quickly.');
  if (wordCount < 150) tips.push('The resume reads very short. Add concrete outcomes to your projects.');
  if (wordCount > 900) tips.push('The resume is long. Keep to one page for internship and early-career roles.');
  if (!hasNumbers) tips.push('Add numbers where you can, such as users, speed-ups, or percentages.');
  return tips.slice(0, 5);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const { text } = req.body || {};
    if (!text || typeof text !== 'string' || !text.trim()) {
      return res.status(400).json({ error: 'text is required' });
    }
    if (text.length > MAX_TEXT_CHARS) {
      return res.status(400).json({ error: `text must be under ${MAX_TEXT_CHARS} characters` });
    }

    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const { skills, skillGroups } = extractSkills(text);
    const sections = detectSections(text);
    const hasNumbers = /\d/.test(text);
    const completeness = completenessScore(sections, skills.length, wordCount);
    const roles = suggestRoles(skills);
    const tips = suggestions(sections, skills, wordCount, hasNumbers);

    res.status(200).json({
      skills,
      skillGroups,
      sections,
      completeness,
      roles,
      suggestions: tips,
      wordCount,
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
}
