// api/order-sms.js
// Sends order confirmation SMS via BulkSMSBD when Shopify webhook fires.

const crypto = require('crypto');
const fetch = require('node-fetch');

// 🔑 Directly set API Key & Sender ID (for testing)
// Better: keep them in Vercel Environment Variables
const API_KEY   = "CqGUEe5Vmqt8yPKo7K8t";
const SENDER_ID = "8809617617772";

// Option A (recommended): HMAC verification if you use a Custom App webhook
const SHOPIFY_WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || "";

// Option B (simpler): URL token fallback if you use Notifications → Webhooks
// Example: https://your-vercel.vercel.app/api/order-sms?token=YOUR_TOKEN
const ORDER_WEBHOOK_TOKEN = process.env.ORDER_WEBHOOK_TOKEN || "";

// --- helpers ---
function ok(res, body) { return res.status(200).json(body); }
function bad(res, code, msg) { return res.status(code).json({ success:false, error: msg }); }

function verifyHmac(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;
  const digest = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(digest));
  } catch {
    return false;
  }
}

function normalizeBD(phone) {
  if (!phone) return '';
  let p = ('' + phone).trim();
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('88')) return p;
  if (p.startsWith('0')) return '88' + p;
  if (p.startsWith('1')) return '880' + p;
  return p;
}

async function sendSMS(number, text) {
  const msg = encodeURIComponent(text);
  const url = `http://bulksmsbd.net/api/smsapi?api_key=${encodeURIComponent(API_KEY)}&type=text&number=${encodeURIComponent(number)}&senderid=${encodeURIComponent(SENDER_ID)}&message=${msg}`;
  const r = await fetch(url);
  return { ok: r.ok, body: await r.text().catch(()=> '') };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Shopify-Hmac-Sha256');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return bad(res, 405, 'method_not_allowed');

  if (!API_KEY || !SENDER_ID) return bad(res, 500, 'missing_sms_env');

  try {
    const raw = JSON.stringify(req.body || {});
    const hmacHeader = req.headers['x-shopify-hmac-sha256'];

    let allowed = false;
    if (SHOPIFY_WEBHOOK_SECRET) {
      allowed = verifyHmac(raw, hmacHeader, SHOPIFY_WEBHOOK_SECRET);
    } else if (ORDER_WEBHOOK_TOKEN) {
      allowed = req.query && req.query.token === ORDER_WEBHOOK_TOKEN;
    }

    if (!allowed) return bad(res, 401, 'unauthorized');

    const order = req.body || {};
    const phone =
      order?.shipping_address?.phone ||
      order?.customer?.phone ||
      order?.billing_address?.phone ||
      '';

    const number = normalizeBD(phone);
    if (!/^8801[3-9]\d{8}$/.test(number)) {
      return ok(res, { success:true, skipped:'missing_or_invalid_phone' });
    }

    const name = order?.customer?.first_name || order?.shipping_address?.first_name || 'Customer';
    const orderNo = order?.name || `#${order?.order_number || ''}`;
    const total = order?.total_price || '';
    const statusUrl = order?.order_status_url || '';

    const text = `ধন্যবাদ ${name}! আপনার অর্ডার ${orderNo} নিশ্চিত হয়েছে। মোট: ৳${total}. ট্র্যাক: ${statusUrl}`;

    const out = await sendSMS(number, text);
    return ok(res, { success: out.ok, provider_response: out.body });
  } catch (e) {
    return bad(res, 500, 'server_error');
  }
};
