const PLATFORM_LABELS = {
  twitter: 'Twitter/X Thread',
  linkedin: 'LinkedIn Post',
  instagram: 'Instagram Caption',
  youtube: 'YouTube Description',
  newsletter: 'Newsletter Blurb',
};

function getAnonId() {
  let id = localStorage.getItem('repurpose_anon_id');
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem('repurpose_anon_id', id);
  }
  return id;
}

const anonId = getAnonId();
const usageBadge = document.getElementById('usageBadge');
const generateBtn = document.getElementById('generateBtn');
const contentInput = document.getElementById('contentInput');
const errorMsg = document.getElementById('errorMsg');
const resultsEl = document.getElementById('results');
const upgradeModal = document.getElementById('upgradeModal');

async function refreshStatus() {
  try {
    const res = await fetch(`/api/status?anonId=${anonId}`);
    const data = await res.json();
    if (data.isPaid) {
      usageBadge.textContent = 'Pro — unlimited';
    } else {
      usageBadge.textContent = `${data.remaining} free generation${data.remaining === 1 ? '' : 's'} left`;
    }
  } catch {
    usageBadge.textContent = '';
  }
}

function selectedPlatforms() {
  return Array.from(document.querySelectorAll('.platforms input:checked')).map((el) => el.value);
}

function renderResults(results) {
  resultsEl.innerHTML = '';
  Object.entries(results).forEach(([key, text]) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    const label = PLATFORM_LABELS[key] || key;
    card.innerHTML = `
      <h3>${label}</h3>
      <pre>${(text || '').toString().replace(/</g, '&lt;')}</pre>
      <button class="copy-btn">Copy</button>
    `;
    card.querySelector('.copy-btn').addEventListener('click', () => {
      navigator.clipboard.writeText(text);
      card.querySelector('.copy-btn').textContent = 'Copied!';
      setTimeout(() => (card.querySelector('.copy-btn').textContent = 'Copy'), 1500);
    });
    resultsEl.appendChild(card);
  });
}

generateBtn.addEventListener('click', async () => {
  errorMsg.textContent = '';
  const content = contentInput.value.trim();
  const platforms = selectedPlatforms();

  if (content.length < 30) {
    errorMsg.textContent = 'Please paste at least a few sentences of content.';
    return;
  }
  if (platforms.length === 0) {
    errorMsg.textContent = 'Select at least one platform.';
    return;
  }

  generateBtn.disabled = true;
  generateBtn.textContent = 'Generating…';

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content, platforms, anonId }),
    });
    const data = await res.json();

    if (res.status === 402) {
      upgradeModal.classList.remove('hidden');
      return;
    }
    if (!res.ok) {
      errorMsg.textContent = data.error || 'Something went wrong.';
      return;
    }
    renderResults(data.results);
    refreshStatus();
  } catch {
    errorMsg.textContent = 'Network error. Please try again.';
  } finally {
    generateBtn.disabled = false;
    generateBtn.textContent = 'Generate';
  }
});

document.getElementById('closeModal').addEventListener('click', () => {
  upgradeModal.classList.add('hidden');
});

document.getElementById('upgradeBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/create-checkout-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anonId }),
    });
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    } else {
      alert(data.error || 'Stripe is not configured yet.');
    }
  } catch {
    alert('Could not start checkout.');
  }
});

refreshStatus();
