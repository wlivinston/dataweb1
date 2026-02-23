const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');
const { body, validationResult } = require('express-validator');

const supportEmail = process.env.ADMIN_EMAIL || process.env.SUPPORT_EMAIL || 'senyo@diaspora-n.com';
const fromEmail = process.env.FROM_EMAIL || process.env.SMTP_USER || 'noreply@example.com';
const ALLOWED_REPORT_TYPES = new Set([
  'data-analysis',
  'market-research',
  'financial-analysis',
  'dashboard-design',
  'custom',
]);

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

// Create transporter for sending notification emails
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

// POST /api/reports/request - Submit a report request
router.post(
  '/request',
  [
    body('name').isString().trim().isLength({ min: 2, max: 120 }),
    body('email').isEmail().normalizeEmail(),
    body('company').optional({ nullable: true }).isString().trim().isLength({ max: 160 }),
    body('reportType').isString().trim().custom((value) => {
      if (!ALLOWED_REPORT_TYPES.has(value)) {
        throw new Error('Unsupported reportType');
      }
      return true;
    }),
    body('description').isString().trim().isLength({ min: 10, max: 4000 }),
    body('timeline').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
    body('budget').optional({ nullable: true }).isString().trim().isLength({ max: 120 }),
  ],
  async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Invalid request payload',
        details: errors.array().map((e) => ({ field: e.path, message: e.msg })),
      });
    }

    const { name, email, company, reportType, description, timeline, budget } = req.body;

    // Try to store in Supabase if available
    let requestId = null;
    try {
      const { supabase } = require('../config/supabase');
      if (supabase) {
        const { data, error } = await supabase
          .from('report_requests')
          .insert({
            customer_name: name,
            customer_email: email,
            company: company || null,
            report_type: reportType,
            description: description,
            timeline: timeline || null,
            budget_range: budget || null,
            status: 'pending'
          })
          .select('id')
          .single();

        if (!error && data) {
          requestId = data.id;
        }
      }
    } catch (dbError) {
      console.log('DB storage skipped:', dbError.message);
      // Continue without DB - email notification will still be sent
    }

    // Send notification email to admin
    try {
      const transporter = createTransporter();

      const reportTypeLabels = {
        'data-analysis': 'Data Analysis Report',
        'market-research': 'Market Research Report',
        'financial-analysis': 'Financial Analysis Report',
        'dashboard-design': 'Dashboard Design & Development',
        'custom': 'Custom Report'
      };

      const mailOptions = {
        from: `"DataAfrik" <${fromEmail}>`,
        to: supportEmail,
        subject: `New Report Request: ${escapeHtml(reportTypeLabels[reportType] || reportType)}`,
        html: `
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
                  <tr><td style="padding: 8px 0; color: #666; font-weight: bold;">Report Type:</td><td style="padding: 8px 0; color: #333;">${escapeHtml(reportTypeLabels[reportType] || reportType)}</td></tr>
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
        `
      };

      await transporter.sendMail(mailOptions);
      console.log('Report request notification sent');
    } catch (emailError) {
      console.error('Failed to send report request email:', emailError.message);
      // Don't fail the request if email fails
    }

    res.status(201).json({
      success: true,
      message: 'Report request submitted successfully. Our team will contact you within 24 hours.',
      requestId: requestId
    });

  } catch (error) {
    console.error('Error processing report request:', error);
    res.status(500).json({
      error: 'Failed to submit report request',
      message: `Please try again or contact us directly at ${supportEmail}`
    });
  }
});

module.exports = router;
