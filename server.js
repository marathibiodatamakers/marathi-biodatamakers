// ============================================================
//  Marathi Biodata Maker — Backend Server
//  Node.js + Express  |  No email / resend dependency
// ============================================================

const express  = require('express');
const cors     = require('cors');
const Razorpay = require('razorpay');
const crypto   = require('crypto');
const path     = require('path');

const app = express();

// ── ENV VARS ─────────────────────────────────────────────────
const {
  RAZORPAY_KEY_ID,
  RAZORPAY_KEY_SECRET,
  FRONTEND_URL = '*',
  RAZORPAY_WEBHOOK_SECRET,
  PORT = 3000
} = process.env;

// ── Startup env guard ─────────────────────────────────────────
const REQUIRED_ENV = ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET'];
const missingEnv   = REQUIRED_ENV.filter(k => !process.env[k]);
if (missingEnv.length > 0) {
  console.error('❌ Missing required env vars:', missingEnv.join(', '));
  process.exit(1);
}

// ── Business constants (NEVER taken from client) ──────────────
const FIXED_AMOUNT_PAISE = 2500;                          // ₹25 — hardcoded
const FIXED_CURRENCY     = 'INR';
const PAYMENT_ID_RE      = /^pay_[A-Za-z0-9]{14,24}$/;
const ORDER_ID_RE        = /^order_[A-Za-z0-9]{14,24}$/;
const SIGNATURE_RE       = /^[a-f0-9]{64}$/;
const EMAIL_RE           = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;  // ← was missing, caused crash

// ── Helper: redact email for safe logging ────────────────────
function redactEmail(email) {                              // ← was missing, caused crash
  if (!email || typeof email !== 'string') return '(none)';
  const [local, domain] = email.split('@');
  if (!domain) return '***';
  return local.slice(0, 2) + '***@' + domain;
}

// ── Rate limiting (in-memory) ─────────────────────────────────
const rateLimitMap = new Map();
function rateLimit(ip, route, maxPerMinute) {
  const key    = `${ip}:${route}`;
  const now    = Date.now();
  const bucket = rateLimitMap.get(key) || { count: 0, resetAt: now + 60000 };
  if (now > bucket.resetAt) { bucket.count = 0; bucket.resetAt = now + 60000; }
  bucket.count++;
  rateLimitMap.set(key, bucket);
  return bucket.count > maxPerMinute;
}
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of rateLimitMap.entries()) {
    if (now > val.resetAt) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

// ── In-memory verified payment ledger (24 h TTL) ─────────────
const verifiedPayments = new Map();

function addVerifiedPayment(paymentId) {
  verifiedPayments.set(paymentId, Date.now());
}
function isPaymentVerified(paymentId) {
  return verifiedPayments.has(paymentId);
}
setInterval(() => {
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const [id, ts] of verifiedPayments.entries()) {
    if (ts < cutoff) verifiedPayments.delete(id);
  }
}, 60 * 60 * 1000);

// ── Trust Render's reverse proxy ─────────────────────────────
app.set('trust proxy', 1);

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin:         FRONTEND_URL === '*' ? '*' : [FRONTEND_URL],
  methods:        ['GET', 'POST'],
  allowedHeaders: ['Content-Type']
}));

// ── Raw body for webhook (must be BEFORE express.json) ───────
app.use('/webhook', express.raw({ type: 'application/json' }));

// ── JSON body for all other routes (25 MB for base64 data) ───
app.use(express.json({ limit: '25mb' }));

// ── Serve frontend static files ───────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));

// ── Razorpay instance ─────────────────────────────────────────
const razorpay = new Razorpay({
  key_id:     RAZORPAY_KEY_ID,
  key_secret: RAZORPAY_KEY_SECRET
});

// ============================================================
//  ROUTE: Health check
// ============================================================
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Marathi Biodata Maker Backend' });
});

// ============================================================
//  ROUTE: Create Razorpay Order
//  Amount/currency fixed server-side — client input ignored.
// ============================================================
app.post('/create-order', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (rateLimit(ip, 'create-order', 10)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  try {
    const rawReceipt = (typeof req.body.receipt === 'string' ? req.body.receipt : '')
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 40);
    const receipt = rawReceipt || `biodata_${Date.now()}`;

    const order = await razorpay.orders.create({
      amount:          FIXED_AMOUNT_PAISE,   // ← ALWAYS ₹25
      currency:        FIXED_CURRENCY,
      receipt:         receipt,
      payment_capture: 1
    });

    console.log(`[ORDER] Created: ${order.id}`);
    res.json(order);
  } catch (err) {
    console.error('[ORDER] Error:', err.message);
    res.status(500).json({ error: 'Order creation failed' });
  }
});

// ============================================================
//  ROUTE: Verify Payment Signature
//  After success, browser downloads files directly — no email.
// ============================================================
app.post('/verify-payment', async (req, res) => {
  const ip = req.ip || req.connection.remoteAddress;
  if (rateLimit(ip, 'verify-payment', 10)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  try {
    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      user_email,
      user_name
    } = req.body;

    // ── Strict format validation ──────────────────────────────
    if (!razorpay_order_id   || !ORDER_ID_RE.test(razorpay_order_id)) {
      return res.status(400).json({ error: 'Invalid order_id format' });
    }
    if (!razorpay_payment_id || !PAYMENT_ID_RE.test(razorpay_payment_id)) {
      return res.status(400).json({ error: 'Invalid payment_id format' });
    }
    if (!razorpay_signature  || !SIGNATURE_RE.test(razorpay_signature)) {
      return res.status(400).json({ error: 'Invalid signature format' });
    }

    // ── Optional email validation (logging only) ─────────────
    if (user_email && (typeof user_email !== 'string' || !EMAIL_RE.test(user_email.trim()))) {
      return res.status(400).json({ error: 'Invalid user_email format' });
    }

    // ── Replay-attack guard ───────────────────────────────────
    if (isPaymentVerified(razorpay_payment_id)) {
      console.log(`[VERIFY] Cached ok: ${razorpay_payment_id}`);
      return res.json({ ok: true, payment_id: razorpay_payment_id, message: 'Payment verified (cached)' });
    }

    // ── HMAC-SHA256 verification ──────────────────────────────
    const sigBody  = razorpay_order_id + '|' + razorpay_payment_id;
    const expected = crypto
      .createHmac('sha256', RAZORPAY_KEY_SECRET)
      .update(sigBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expected, 'hex');
    const receivedBuf = Buffer.from(razorpay_signature, 'hex');
    const valid = expectedBuf.length === receivedBuf.length &&
                  crypto.timingSafeEqual(expectedBuf, receivedBuf);

    if (!valid) {
      console.warn(`[VERIFY] Signature mismatch — IP: ${ip}`);
      return res.status(400).json({ error: 'Invalid signature' });
    }

    addVerifiedPayment(razorpay_payment_id);
    console.log(`[VERIFY] OK: ${razorpay_payment_id} | email: ${redactEmail(user_email)}`);

    // No email sending — browser downloads directly after this response
    res.json({ ok: true, payment_id: razorpay_payment_id, message: 'Payment verified' });

  } catch (err) {
    console.error('[VERIFY] Error:', err.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ============================================================
//  ROUTE: Razorpay Webhook
// ============================================================
app.post('/webhook', (req, res) => {
  try {
    if (!RAZORPAY_WEBHOOK_SECRET) {
      console.warn('[WEBHOOK] RAZORPAY_WEBHOOK_SECRET not set — skipping signature verification');
      return res.status(200).json({ status: 'webhook secret not configured' });
    }

    const receivedSig = req.headers['x-razorpay-signature'];
    if (!receivedSig || !/^[a-f0-9]{64}$/.test(receivedSig)) {
      return res.status(400).json({ error: 'Missing or malformed webhook signature' });
    }

    const body        = req.body; // raw Buffer
    const expectedSig = crypto
      .createHmac('sha256', RAZORPAY_WEBHOOK_SECRET)
      .update(body)
      .digest('hex');

    const expBuf = Buffer.from(expectedSig, 'hex');
    const recBuf = Buffer.from(receivedSig,  'hex');
    const valid  = expBuf.length === recBuf.length && crypto.timingSafeEqual(expBuf, recBuf);

    if (!valid) {
      console.warn('[WEBHOOK] Invalid signature');
      return res.status(400).json({ error: 'Invalid webhook signature' });
    }

    const event = JSON.parse(body.toString());
    console.log(`[WEBHOOK] Event: ${event.event}`);

    if (event.event === 'payment.captured') {
      const payment = event.payload.payment.entity;
      addVerifiedPayment(payment.id);
      console.log(`[WEBHOOK] Captured: ${payment.id} ₹${payment.amount / 100}`);
    }

    res.json({ status: 'ok' });
  } catch (err) {
    console.error('[WEBHOOK] Error:', err.message);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
});

// ── Start server ──────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`   Razorpay Key: ${RAZORPAY_KEY_ID.slice(0, 12)}...`);
  console.log(`   Frontend URL: ${FRONTEND_URL}`);
  console.log(`   Fixed Price:  ₹${FIXED_AMOUNT_PAISE / 100}`);
});
