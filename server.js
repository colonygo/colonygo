/*
 * ColonyGo — Demo Request API Server
 *
 * DEPLOYMENT:
 * On your hosting platform (Render, Railway, VPS):
 * Set these environment variables in the dashboard:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE
 * Never use the .env file in production —
 * use the platform's environment variables panel.
 *
 * LOCAL DEVELOPMENT:
 * Copy .env.example to .env and fill in credentials.
 * Run: npm install && npm run dev
 * Visit: http://localhost:3000
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '32kb' }));

function stripHtml(str) {
  if (str == null || typeof str !== 'string') return '';
  return str.replace(/<[^>]*>/g, '').trim();
}

function sanitizeField(v) {
  if (v == null) return '';
  return stripHtml(String(v));
}

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const demoRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  handler: function (req, res) {
    res.status(429).json({
      success: false,
      error: 'Trop de requêtes. Réessayez dans une heure.',
    });
  },
});

let transporter;
function getTransporter() {
  if (transporter) return transporter;
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT, 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || pass === undefined || pass === '') {
    console.error('SMTP configuration is incomplete. Check SMTP_HOST, SMTP_USER, SMTP_PASS.');
  }

  transporter = nodemailer.createTransport({
    host: host,
    port: port,
    secure: secure,
    auth: {
      user: user,
      pass: pass,
    },
  });
  return transporter;
}

app.post('/api/send-demo-request', demoRequestLimiter, async function (req, res) {
  const body = req.body || {};

  const prenom = sanitizeField(body.prenom);
  const nom = sanitizeField(body.nom);
  const email = sanitizeField(body.email);
  const societe = sanitizeField(body.societe);
  const secteur = sanitizeField(body.secteur);
  const taille = sanitizeField(body.taille);
  const message = sanitizeField(body.message);

  if (!prenom || !nom || !email || !societe) {
    return res.status(400).json({
      success: false,
      error: 'Champs obligatoires manquants',
    });
  }

  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Champs obligatoires manquants',
    });
  }

  const subject = '[Demande de démo] ' + societe + ' — ' + prenom + ' ' + nom;
  const isoDate = new Date().toISOString();
  const clientIp = req.ip || req.connection?.remoteAddress || '';

  const htmlTable =
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="font-family:Inter, Arial, sans-serif;font-size:14px;color:#1F2937;line-height:1.6;">' +
    '<tr><td style="background-color:#0F2A45;color:#FFFFFF;padding:16px 20px;font-family:Poppins, Arial, sans-serif;font-size:18px;font-weight:700;">Nouvelle demande de démo ColonyGo</td></tr>' +
    '<tr><td style="background-color:#FFFFFF;padding:24px 20px;border:1px solid #E5E7EB;border-top:none;">' +
    '<table role="presentation" cellpadding="8" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">' +
    '<tr><td style="border-bottom:1px solid #E5E7EB;color:#6B7280;width:120px;">Prénom</td><td style="border-bottom:1px solid #E5E7EB;">' +
    escapeHtml(prenom) +
    '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #E5E7EB;color:#6B7280;">Nom</td><td style="border-bottom:1px solid #E5E7EB;">' +
    escapeHtml(nom) +
    '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #E5E7EB;color:#6B7280;">Email</td><td style="border-bottom:1px solid #E5E7EB;">' +
    escapeHtml(email) +
    '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #E5E7EB;color:#6B7280;">Société</td><td style="border-bottom:1px solid #E5E7EB;">' +
    escapeHtml(societe) +
    '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #E5E7EB;color:#6B7280;">Secteur</td><td style="border-bottom:1px solid #E5E7EB;">' +
    escapeHtml(secteur || '—') +
    '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #E5E7EB;color:#6B7280;">Taille</td><td style="border-bottom:1px solid #E5E7EB;">' +
    escapeHtml(taille || '—') +
    '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #E5E7EB;color:#6B7280;vertical-align:top;">Message</td><td style="border-bottom:1px solid #E5E7EB;">' +
    escapeHtml(message || '—') +
    '</td></tr>' +
    '<tr><td style="border-bottom:1px solid #E5E7EB;color:#6B7280;">Date</td><td style="border-bottom:1px solid #E5E7EB;">' +
    escapeHtml(isoDate) +
    '</td></tr>' +
    '<tr><td style="color:#6B7280;">IP</td><td>' +
    escapeHtml(String(clientIp)) +
    '</td></tr>' +
    '</table></td></tr></table>';

  try {
    const transport = getTransporter();
    await transport.sendMail({
      from: '"ColonyGo Demo Request" <contact@colonygo.com>',
      to: 'contact@colonygo.com',
      replyTo: email,
      subject: subject,
      html: htmlTable,
    });
    return res.status(200).json({
      success: true,
      message: 'Email envoyé avec succès',
    });
  } catch (err) {
    console.error('SMTP error:', err.message || err);
    return res.status(500).json({
      success: false,
      error: "Erreur d'envoi, réessayez.",
    });
  }
});

function escapeHtml(text) {
  const s = String(text);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT, function () {
  console.log('ColonyGo server running on port ' + PORT);
});
