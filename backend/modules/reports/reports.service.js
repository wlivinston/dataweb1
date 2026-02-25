const nodemailer = require('nodemailer');
const reportsRepository = require('./reports.repository');

const supportEmail = process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || 'senyo@diaspora-n.com';
const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com';

const ALLOWED_REPORT_TYPES = new Set([
  'data-analysis',
  'market-research',
  'financial-analysis',
  'dashboard-design',
  'custom',
]);

const REPORT_TYPE_LABELS = {
  'data-analysis': 'Data Analysis Report',
  'market-research': 'Market Research Report',
  'financial-analysis': 'Financial Analysis Report',
  'dashboard-design': 'Dashboard Design & Development',
  custom: 'Custom Report',
};

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function createTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
}

function isAllowedReportType(value) {
  return ALLOWED_REPORT_TYPES.has(String(value || '').trim());
}

function buildNotificationHtml({
  name,
  email,
  company,
  reportType,
  description,
  timeline,
  budget,
  requestId,
}) {
  const label = REPORT_TYPE_LABELS[reportType] || reportType;
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%); padding: 30px; text-align: center; color: white;">
        <h1 style="margin: 0; font-size: 28px;">DataAfrik</h1>
        <p style="margin: 10px 0 0 0; opacity: 0.9;">New Report Request</p>
      </div>

      <div style="padding: 30px; background: #f9f9f9;">
        <h2 style="color: #333; margin-bottom: 20px;">Report Request Details</h2>

        <div style="background: #fff; padding: 20px; border-radius: 8px; border-left: 4px solid #2563eb;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td style="padding: 8px 0; color: #666; font-weight: bold;">Name:</td><td style="padding: 8px 0; color: #333;">${escapeHtml(name)}</td></tr>
            <tr><td style="padding: 8px 0; color: #666; font-weight: bold;">Email:</td><td style="padding: 8px 0; color: #333;">${escapeHtml(email)}</td></tr>
            ${company ? `<tr><td style="padding: 8px 0; color: #666; font-weight: bold;">Company:</td><td style="padding: 8px 0; color: #333;">${escapeHtml(company)}</td></tr>` : ''}
            <tr><td style="padding: 8px 0; color: #666; font-weight: bold;">Report Type:</td><td style="padding: 8px 0; color: #333;">${escapeHtml(label)}</td></tr>
            ${timeline ? `<tr><td style="padding: 8px 0; color: #666; font-weight: bold;">Timeline:</td><td style="padding: 8px 0; color: #333;">${escapeHtml(timeline)}</td></tr>` : ''}
            ${budget ? `<tr><td style="padding: 8px 0; color: #666; font-weight: bold;">Budget:</td><td style="padding: 8px 0; color: #333;">${escapeHtml(budget)}</td></tr>` : ''}
          </table>
        </div>

        <div style="margin-top: 20px; background: #fff; padding: 20px; border-radius: 8px;">
          <h3 style="color: #333; margin-top: 0;">Description</h3>
          <p style="color: #666; line-height: 1.6; white-space: pre-wrap;">${escapeHtml(description)}</p>
        </div>

        ${requestId ? `<p style="color: #999; font-size: 12px; margin-top: 20px;">Request ID: ${escapeHtml(requestId)}</p>` : ''}
      </div>
    </div>
  `;
}

async function sendReportNotificationEmail({
  name,
  email,
  company,
  reportType,
  description,
  timeline,
  budget,
  requestId,
}) {
  const transporter = createTransporter();
  const label = REPORT_TYPE_LABELS[reportType] || reportType;

  await transporter.sendMail({
    from: `"DataAfrik" <${fromEmail}>`,
    to: supportEmail,
    subject: `New Report Request: ${escapeHtml(label)}`,
    html: buildNotificationHtml({
      name,
      email,
      company,
      reportType,
      description,
      timeline,
      budget,
      requestId,
    }),
  });
}

async function submitReportRequest({
  name,
  email,
  company,
  reportType,
  description,
  timeline,
  budget,
}) {
  let requestId = null;

  try {
    requestId = await reportsRepository.createReportRequest({
      customerName: name,
      customerEmail: email,
      company,
      reportType,
      description,
      timeline,
      budget,
    });
  } catch (dbError) {
    console.log('DB storage skipped:', dbError.message);
  }

  try {
    await sendReportNotificationEmail({
      name,
      email,
      company,
      reportType,
      description,
      timeline,
      budget,
      requestId,
    });
  } catch (emailError) {
    console.error('Failed to send report request email:', emailError.message);
  }

  return {
    success: true,
    message: 'Report request submitted successfully. Our team will contact you within 24 hours.',
    requestId,
  };
}

module.exports = {
  supportEmail,
  isAllowedReportType,
  submitReportRequest,
};
