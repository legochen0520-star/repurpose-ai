require('dotenv').config();
const express = require('express');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');
const { getOrCreateUser, incrementUsage, setPaid, unsetPaidByCustomerId, getStats } = require('./store');

const FREE_LIMIT = 3;
const app = express();

app.use(express.static(path.join(__dirname, 'public')));

// Stripe webhook needs the raw body, so register it BEFORE express.json()
app.post('/api/stripe-webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(501).send('Stripe not configured');
  }
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const anonId = session.client_reference_id;
    if (anonId) {
      setPaid(anonId, session.customer);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    const sub = event.data.object;
    unsetPaidByCustomerId(sub.customer);
  }

  res.json({ received: true });
});

app.use(express.json({ limit: '1mb' }));

app.get('/api/status', (req, res) => {
  const anonId = req.query.anonId;
  if (!anonId) return res.status(400).json({ error: 'anonId required' });
  const user = getOrCreateUser(anonId);
  res.json({
    isPaid: !!user.isPaid,
    usageCount: user.usageCount,
    freeLimit: FREE_LIMIT,
    remaining: user.isPaid ? null : Math.max(0, FREE_LIMIT - user.usageCount),
  });
});

const PLATFORM_PROMPTS = {
  twitter: 'A Twitter/X thread (5-8 tweets, numbered, punchy, one idea per tweet)',
  linkedin: 'A LinkedIn post (professional tone, 150-250 words, with a hook first line and a question at the end to drive comments)',
  instagram: 'An Instagram caption (engaging, uses line breaks, ends with a call to action and 5 relevant hashtags)',
  youtube: 'A YouTube video description (with a compelling first 2 lines, timestamps placeholder, and a call to subscribe)',
  newsletter: 'A short email newsletter blurb (100-150 words, conversational, with a clear subject line suggestion)',
};

app.post('/api/generate', async (req, res) => {
  try {
    const { content, platforms, anonId } = req.body;
    if (!anonId) return res.status(400).json({ error: 'anonId required' });
    if (!content || content.trim().length < 30) {
      return res.status(400).json({ error: 'Please paste at least a few sentences of content.' });
    }
    const selected = (platforms || []).filter((p) => PLATFORM_PROMPTS[p]);
    if (selected.length === 0) {
      return res.status(400).json({ error: 'Select at least one platform.' });
    }

    const user = getOrCreateUser(anonId);
    if (!user.isPaid && user.usageCount >= FREE_LIMIT) {
      return res.status(402).json({ error: 'Free limit reached. Upgrade to continue.', upgradeRequired: true });
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(501).json({ error: 'Server not configured with ANTHROPIC_API_KEY yet.' });
    }
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const platformList = selected.map((p) => `- ${p}: ${PLATFORM_PROMPTS[p]}`).join('\n');
    const exampleShape = JSON.stringify(Object.fromEntries(selected.map((p) => [p, '...'])));
    const prompt = `You are a social media repurposing assistant. Given the source content below, produce repurposed versions for these formats:\n${platformList}\n\nReturn ONLY valid JSON, no markdown fences, with EXACTLY these keys and no others: ${selected.join(', ')}\nExample shape: ${exampleShape}\n\nSOURCE CONTENT:\n"""\n${content.slice(0, 12000)}\n"""`;

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const raw = message.content[0].text.trim();
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/\{[\s\S]*\}/);
      parsed = match ? JSON.parse(match[0]) : {};
    }

    // Keep only the platforms actually requested, dropping any extra/duplicate keys the model may add.
    const results = Object.fromEntries(
      selected.filter((p) => typeof parsed[p] === 'string').map((p) => [p, parsed[p]])
    );

    if (Object.keys(results).length === 0) {
      return res.status(502).json({ error: 'Could not parse AI response. Please try again.' });
    }

    incrementUsage(anonId);

    res.json({ results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Generation failed. Please try again.' });
  }
});

app.post('/api/create-checkout-session', async (req, res) => {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_PRICE_ID) {
    return res.status(501).json({ error: 'Stripe not configured yet. See README.' });
  }
  const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  const { anonId } = req.body;
  if (!anonId) return res.status(400).json({ error: 'anonId required' });

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: anonId,
      success_url: `${req.headers.origin}/?upgraded=1`,
      cancel_url: `${req.headers.origin}/?canceled=1`,
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Could not start checkout.' });
  }
});

app.get('/api/admin/stats', (req, res) => {
  if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) {
    return res.status(404).end();
  }
  res.json(getStats());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Repurpose AI running on http://localhost:${PORT}`));
