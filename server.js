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
 * PM2 / VPS — IMPORTANT:
 *   - PM2 often sets process.cwd() to a directory that is NOT your app folder.
 *   - dotenv is configured below with path: join(__dirname, '.env') so .env is
 *     loaded next to server.js. If you rely on shell env only, omit .env and
 *     inject vars via `pm2 ecosystem` env: { } or `pm2 start --update-env`.
 *
 * LOCAL DEVELOPMENT:
 * Copy .env.example to .env and fill in credentials.
 * Run: npm install && npm run dev
 * Visit: http://localhost:3000
 */

const path = require('path');
const fs = require('fs');

const envPath = path.join(__dirname, '.env');
const dotenvResult = require('dotenv').config({ path: envPath });

const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');

const LOG_PREFIX = '[ColonyGo SMTP]';

function envDefined(name) {
  const v = process.env[name];
  return v !== undefined && v !== null && String(v).trim() !== '';
}

function envPresent(name) {
  return envDefined(name) ? 'yes' : 'NO';
}

function logStartupEnv() {
  const dotenvFileExists = fs.existsSync(envPath);
  console.log(LOG_PREFIX, 'Startup diagnostics');
  console.log(LOG_PREFIX, '  NODE_ENV:', process.env.NODE_ENV || '(unset)');
  console.log(LOG_PREFIX, '  process.cwd():', process.cwd());
  console.log(LOG_PREFIX, '  __dirname:', __dirname);
  console.log(LOG_PREFIX, '  .env path:', envPath, '| exists:', dotenvFileExists);
  if (dotenvResult.error && dotenvFileExists) {
    console.warn(LOG_PREFIX, '  dotenv read error (file exists):', dotenvResult.error.message);
  } else if (dotenvResult.error && !dotenvFileExists) {
    console.log(LOG_PREFIX, '  dotenv: no .env file (using process.env only — normal in production)');
  } else if (dotenvResult.parsed) {
    console.log(
      LOG_PREFIX,
      '  dotenv loaded keys from file:',
      Object.keys(dotenvResult.parsed).filter(function (k) {
        return k.indexOf('PASS') === -1 && k.indexOf('SECRET') === -1 && k.indexOf('KEY') === -1;
      }).join(', ') || '(none or only secret keys)'
    );
  }

  console.log(LOG_PREFIX, '  SMTP_HOST defined:', envPresent('SMTP_HOST'));
  console.log(LOG_PREFIX, '  SMTP_PORT defined:', envPresent('SMTP_PORT'));
  console.log(LOG_PREFIX, '  SMTP_USER defined:', envPresent('SMTP_USER'));
  console.log(LOG_PREFIX, '  SMTP_PASS defined:', envDefined('SMTP_PASS') ? 'yes (length hidden)' : 'NO');
  console.log(LOG_PREFIX, '  SMTP_SECURE raw:', JSON.stringify(process.env.SMTP_SECURE));

  const port = parseInt(process.env.SMTP_PORT, 10);
  const secure = process.env.SMTP_SECURE === 'true';
  if (!Number.isNaN(port)) {
    if (port === 465 && !secure) {
      console.warn(
        LOG_PREFIX,
        '  WARNING: port 465 usually requires SMTP_SECURE=true (implicit TLS).'
      );
    }
    if ((port === 587 || port === 25) && secure) {
      console.warn(
        LOG_PREFIX,
        '  WARNING: port',
        port,
        'typically uses STARTTLS (SMTP_SECURE=false). Try SMTP_SECURE=false for submission port.'
      );
    }
  }
}

logStartupEnv();

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

function getSmtpSettings() {
  const host = (process.env.SMTP_HOST || '').trim();
  const portRaw = process.env.SMTP_PORT;
  const port = parseInt(portRaw, 10);
  const secure = process.env.SMTP_SECURE === 'true';
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS != null ? String(process.env.SMTP_PASS) : '';
  return { host, port, portRaw, secure, user, pass };
}

function smtpConfigOk(settings) {
  return (
    settings.host &&
    !Number.isNaN(settings.port) &&
    settings.port > 0 &&
    settings.user &&
    settings.pass.length > 0
  );
}

/** Safe for logs: never includes password. */
function smtpConfigForLog(settings) {
  return {
    host: settings.host || '(missing)',
    port: settings.port,
    portRaw: settings.portRaw,
    secure: settings.secure,
    user: (function (u) {
      if (!u) return '(missing)';
      var at = u.indexOf('@');
      if (at < 1) return '(invalid)';
      return u[0] + '***' + u.slice(at);
    })(settings.user),
    passSet: settings.pass.length > 0,
  };
}

let transporter;
function buildTransporter() {
  const s = getSmtpSettings();
  const transportOptions = {
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: {
      user: s.user,
      pass: s.pass,
    },
    tls: {
      rejectUnauthorized: true,
    },
  };

  if (s.port === 587 && !s.secure) {
    transportOptions.requireTLS = true;
  }

  console.log(LOG_PREFIX, 'Creating transporter with:', smtpConfigForLog(s));
  return nodemailer.createTransport(transportOptions);
}

function getTransporter() {
  if (transporter) return transporter;
  transporter = buildTransporter();
  return transporter;
}

function invalidateTransporter() {
  transporter = null;
}

function logMailError(err, context) {
  console.error(LOG_PREFIX, context || 'sendMail failed');
  console.error(LOG_PREFIX, '  message:', err && err.message);
  console.error(LOG_PREFIX, '  code:', err && err.code);
  console.error(LOG_PREFIX, '  errno:', err && err.errno);
  console.error(LOG_PREFIX, '  syscall:', err && err.syscall);
  console.error(LOG_PREFIX, '  address:', err && err.address);
  console.error(LOG_PREFIX, '  port:', err && err.port);
  console.error(LOG_PREFIX, '  command:', err && err.command);
  console.error(LOG_PREFIX, '  responseCode:', err && err.responseCode);
  if (err && err.response) {
    console.error(LOG_PREFIX, '  response (truncated):', String(err.response).slice(0, 500));
  }
  if (err && err.stack) {
    console.error(LOG_PREFIX, '  stack:\n' + err.stack);
  }
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

  const settings = getSmtpSettings();
  if (!smtpConfigOk(settings)) {
    console.error(LOG_PREFIX, 'Refusing send: incomplete SMTP env.', smtpConfigForLog(settings));
    return res.status(503).json({
      success: false,
      error: "Erreur d'envoi, réessayez.",
    });
  }

  const subject = '[Demande de démo] ' + societe + ' — ' + prenom + ' ' + nom;
  const isoDate = new Date().toISOString();
  const clientIp = req.ip || (req.connection && req.connection.remoteAddress) || '';

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
    console.log(LOG_PREFIX, 'sendMail OK for societe=', societe.slice(0, 40));
    return res.status(200).json({
      success: true,
      message: 'Email envoyé avec succès',
    });
  } catch (err) {
    logMailError(err, 'sendMail');
    invalidateTransporter();
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

  const s = getSmtpSettings();
  if (!smtpConfigOk(s)) {
    console.error(
      LOG_PREFIX,
      'SMTP is not fully configured — demo emails will fail until env vars are set.'
    );
    return;
  }

  setImmediate(function () {
    try {
      getTransporter().verify(function (verifyErr) {
        if (verifyErr) {
          logMailError(verifyErr, 'transporter.verify() at startup');
          console.error(
            LOG_PREFIX,
            'Hint: check firewall OUTBOUND to',
            s.host,
            'port',
            s.port,
            '| Ionos: try port 587 + SMTP_SECURE=false if 465 is blocked.'
          );
        } else {
          console.log(LOG_PREFIX, 'transporter.verify() OK — SMTP handshake successful.');
        }
      });
    } catch (e) {
      logMailError(e, 'transporter.verify() sync');
    }
  });
});
