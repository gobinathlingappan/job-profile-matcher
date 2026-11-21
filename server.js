const express = require('express');
const { Pool } = require('pg');

const app = express();
app.use(express.json({ limit: '100kb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const MAX_WORDS = 3000;

function countWords(str) {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

function extractKeywords(text) {
  const stopWords = new Set([
    'and', 'the', 'for', 'with', 'that', 'this', 'from', 'have', 'are', 'was',
    'were', 'will', 'your', 'our', 'work', 'experience', 'years', 'skills',
    'team', 'using', 'including', 'responsible', 'duties', 'role', 'roles'
  ]);
  const words = text.toLowerCase().match(/\b[a-z][a-z0-9+#.-]{2,}\b/g) || [];
  const freq = {};
  for (const w of words) {
    if (!stopWords.has(w)) freq[w] = (freq[w] || 0) + 1;
  }
  return Object.entries(freq)
    .sort((a, b) => b - a)
    .slice(0, 50)
    .map(([word]) => word);
}

function calculateMatch(profileKeywords, jobText) {
  if (!profileKeywords.length) return { score: 0, matched: [] };
  const lowerJob = jobText.toLowerCase();
  const matched = profileKeywords.filter(kw => lowerJob.includes(kw));
  const score = Math.min(100, Math.round((matched.length / Math.min(profileKeywords.length, 15)) * 100));
  return { score, matched: matched.slice(0, 10) };
}

app.get('/', (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Job & Profile Matcher</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 850px; margin: 1.5rem auto; padding: 0 1rem; color: #1e293b; background: #f8fafc; }
    .card { background: white; border: 1px solid #cbd5e1; border-radius: 10px; padding: 1.25rem; margin-bottom: 1rem; box-shadow: 0 1px 2px rgba(0,0,0,0.04); }
    .form-grid { display: grid; gap: 1rem; grid-template-columns: 1fr 1fr; }
    @media (max-width: 600px) { .form-grid { grid-template-columns: 1fr; } }
    label { font-weight: 600; display: block; margin-bottom: 0.35rem; font-size: 0.95rem; }
    input, textarea, button { width: 100%; padding: 0.65rem; border-radius: 6px; border: 1px solid #94a3b8; box-sizing: border-box; font-family: inherit; font-size: 0.95rem; }
    textarea { resize: vertical; min-height: 160px; line-height: 1.45; }
    .counter { text-align: right; font-size: 0.8rem; color: #64748b; margin-top: 0.25rem; }
    .counter.over { color: #dc2626; font-weight: 600; }
    button { background: #2563eb; color: white; font-weight: 600; border: none; cursor: pointer; margin-top: 1rem; padding: 0.8rem; }
    button:disabled { background: #94a3b8; cursor: not-allowed; }
    .badge { display: inline-block; padding: 0.25rem 0.65rem; border-radius: 999px; font-size: 0.85rem; font-weight: 700; white-space: nowrap; }
    .high { background: #dcfce7; color: #166534; }
    .mid { background: #fef9c3; color: #854d0e; }
    .low { background: #f1f5f9; color: #475569; }
    .kw { display: inline-block; background: #e2e8f0; padding: 2px 7px; border-radius: 4px; font-size: 0.8rem; margin: 2px 4px 2px 0; }
  </style>
</head>
<body>
  <h1 style="font-size:1.5rem;">Job Search & Profile Matcher</h1>
  <form id="searchForm" class="card">
    <div class="form-grid">
      <div>
        <label for="title">Target Job Title / Keywords</label>
        <input type="text" id="title" placeholder="e.g. QA Engineer, PropTech Analyst" required />
      </div>
      <div>
        <label for="location">Location</label>
        <input type="text" id="location" placeholder="e.g. Dallas, TX" required />
      </div>
    </div>

    <div style="margin-top: 1rem;">
      <label for="profile">Roles, Responsibilities & Key Skills (Max 3,000 words)</label>
      <textarea id="profile" placeholder="Paste your summary, key responsibilities, tools, certifications, and domain experience here..." required></textarea>
      <div id="wordCounter" class="counter">0 / 3,000 words</div>
    </div>

    <button type="submit" id="submitBtn">Search & Match Jobs</button>
  </form>

  <div id="status" style="margin-bottom: 1rem; font-weight: 500; color: #0f172a;"></div>
  <div id="results"></div>

  <script>
    const profileInput = document.getElementById('profile');
    const counterEl = document.getElementById('wordCounter');
    const submitBtn = document.getElementById('submitBtn');
    const MAX_WORDS = 3000;

    profileInput.addEventListener('input', () => {
      const words = profileInput.value.trim().split(/\\s+/).filter(Boolean);
      const count = words.length;
      counterEl.textContent = \`\${count.toLocaleString()} / 3,000 words\`;
      if (count > MAX_WORDS) {
        counterEl.classList.add('over');
        submitBtn.disabled = true;
      } else {
        counterEl.classList.remove('over');
        submitBtn.disabled = false;
      }
    });

    document.getElementById('searchForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const status = document.getElementById('status');
      const resultsDiv = document.getElementById('results');

      submitBtn.disabled = true;
      status.textContent = 'Searching Adzuna and scoring matches...';
      resultsDiv.innerHTML = '';

      try {
        const res = await fetch('/api/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: document.getElementById('title').value.trim(),
            location: document.getElementById('location').value.trim(),
            profile: profileInput.value.trim()
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Search failed');

        status.textContent = \`Found \${data.jobs.length} jobs ranked by profile match:\`;
        resultsDiv.innerHTML = data.jobs.map(job => {
          const badgeClass = job.score >= 60 ? 'high' : job.score >= 30 ? 'mid' : 'low';
          return \`
            <div class="card">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:0.5rem;">
                <h3 style="margin:0; font-size:1.1rem;"><a href="\${job.redirect_url}" target="_blank" rel="noopener">\${job.title}</a></h3>
                <span class="badge \${badgeClass}">\${job.score}% Match</span>
              </div>
              <p style="margin:0.4rem 0; color:#475569; font-size:0.9rem;">\${job.company} • \${job.location}</p>
              <p style="font-size:0.9rem; line-height:1.45;">\${job.description.slice(0, 260)}...</p>
              <div><strong style="font-size:0.85rem;">Matched Keywords:</strong> \${job.matched.map(k => \`<span class="kw">\${k}</span>\`).join('') || '<span style="font-size:0.85rem;color:#64748b;">None</span>'}</div>
            </div>
          \`;
        }).join('');
      } catch (err) {
        status.textContent = 'Error: ' + err.message;
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`);
});

app.post('/api/match', async (req, res) => {
  try {
    const appId = (process.env.ADZUNA_APP_ID || '').trim();
    const appKey = (process.env.ADZUNA_APP_KEY || '').trim();

    if (!appId || !appKey) {
      return res.status(500).json({ error: 'Missing ADZUNA_APP_ID or ADZUNA_APP_KEY in Render Environment Variables.' });
    }

    const { title, location, profile } = req.body;
    if (!title || !location || !profile) {
      return res.status(400).json({ error: 'Title, location, and profile text are required.' });
    }
    if (countWords(profile) > MAX_WORDS) {
      return res.status(400).json({ error: `Profile exceeds ${MAX_WORDS} words.` });
    }

    const profileKeywords = extractKeywords(profile);

    const params = new URLSearchParams({
      app_id: appId,
      app_key: appKey,
      results_per_page: '25',
      what: title,
      where: location,
      sort_by: 'date'
    });

    const url = `https://api.adzuna.com/v1/api/jobs/us/search/1?${params.toString()}`;

    let apiRes;
    try {
      apiRes = await fetch(url, {
        headers: { 'Accept': 'application/json', 'User-Agent': 'JobMatcherApp/1.0' },
        signal: AbortSignal.timeout(15000)
      });
    } catch (fetchErr) {
      const detail = fetchErr.cause?.code || fetchErr.cause?.message || fetchErr.message;
      console.error('Adzuna fetch error:', fetchErr);
      return res.status(502).json({ error: `Could not reach Adzuna (${detail}). Check Render Logs.` });
    }

    if (!apiRes.ok) {
      const errText = await apiRes.text();
      return res.status(502).json({ error: `Adzuna API error (${apiRes.status}): ${errText}` });
    }

    const data = await apiRes.json();
    if (!Array.isArray(data.results)) {
      return res.status(502).json({ error: 'Unexpected Adzuna API response format.' });
    }

    const scoredJobs = [];
    for (const job of data.results) {
      const company = job.company?.display_name || 'Unknown';
      const loc = job.location?.display_name || location;
      const desc = job.description || '';

      await pool.query(
        `INSERT INTO saved_jobs (adzuna_id, title, company, location, description, salary_min, salary_max, redirect_url, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (adzuna_id) DO NOTHING`,
        [String(job.id), job.title, company, loc, desc, job.salary_min || null, job.salary_max || null, job.redirect_url, job.created]
      );

      const { score, matched } = calculateMatch(profileKeywords, `${job.title} ${desc}`);
      scoredJobs.push({
        title: job.title,
        company,
        location: loc,
        description: desc,
        redirect_url: job.redirect_url,
        score,
        matched
      });
    }

    scoredJobs.sort((a, b) => b.score - a.score);
    res.json({ jobs: scoredJobs });
  } catch (err) {
    console.error('Server error:', err);
        res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));