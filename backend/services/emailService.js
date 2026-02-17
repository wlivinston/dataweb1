const nodemailer = require('nodemailer');

// Create transporter
const createTransporter = () => {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
};

// Send verification email
const sendVerificationEmail = async (email, firstName, token) => {
  try {
    const transporter = createTransporter();
    
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
    
    const mailOptions = {
      from: `"DataWeb" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Verify Your Email - DataWeb',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px;">DataWeb</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Verify Your Email Address</p>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName}!</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              Thank you for registering with DataWeb! To complete your registration and start commenting on our blog posts, 
              please verify your email address by clicking the button below.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${verificationUrl}" 
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; 
                        padding: 15px 30px; 
                        text-decoration: none; 
                        border-radius: 5px; 
                        display: inline-block; 
                        font-weight: bold;">
                Verify Email Address
              </a>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">
              If the button doesn't work, you can copy and paste this link into your browser:
            </p>
            
            <p style="color: #667eea; word-break: break-all; margin-bottom: 25px;">
              ${verificationUrl}
            </p>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">
              This verification link will expire in 24 hours. If you didn't create an account with DataWeb, 
              you can safely ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #999; font-size: 14px; text-align: center;">
              Best regards,<br>
              The DataWeb Team
            </p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Verification email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send verification email:', error);
    return false;
  }
};

// Send password reset email
const sendPasswordResetEmail = async (email, firstName, token) => {
  try {
    const transporter = createTransporter();
    
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    
    const mailOptions = {
      from: `"DataWeb" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Reset Your Password - DataWeb',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px;">DataWeb</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Password Reset Request</p>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName}!</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              We received a request to reset your password for your DataWeb account. 
              Click the button below to create a new password.
            </p>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${resetUrl}" 
                 style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; 
                        padding: 15px 30px; 
                        text-decoration: none; 
                        border-radius: 5px; 
                        display: inline-block; 
                        font-weight: bold;">
                Reset Password
              </a>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">
              If the button doesn't work, you can copy and paste this link into your browser:
            </p>
            
            <p style="color: #667eea; word-break: break-all; margin-bottom: 25px;">
              ${resetUrl}
            </p>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">
              This password reset link will expire in 1 hour. If you didn't request a password reset, 
              you can safely ignore this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #999; font-size: 14px; text-align: center;">
              Best regards,<br>
              The DataWeb Team
            </p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Password reset email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send password reset email:', error);
    return false;
  }
};

// Send subscription welcome email
const sendSubscriptionEmail = async (email, firstName) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"DataWeb" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Welcome to DataWeb Newsletter!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px;">DataWeb</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Welcome to Our Newsletter!</p>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName}!</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              Thank you for subscribing to the DataWeb newsletter! You'll now receive updates about our latest blog posts, 
              data analytics insights, machine learning projects, and industry trends.
            </p>
            
            <div style="background: #e8f4fd; padding: 20px; border-radius: 5px; margin: 25px 0;">
              <h3 style="color: #333; margin-top: 0;">What you'll receive:</h3>
              <ul style="color: #666; line-height: 1.6;">
                <li>Latest blog posts and articles</li>
                <li>Data analytics tips and insights</li>
                <li>Machine learning project updates</li>
                <li>Industry news and trends</li>
                <li>Exclusive content and resources</li>
              </ul>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">
              We're excited to have you as part of our community! If you have any questions or suggestions, 
              feel free to reply to this email.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #999; font-size: 14px; text-align: center;">
              Best regards,<br>
              The DataWeb Team
            </p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Subscription email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send subscription email:', error);
    return false;
  }
};

// Send unsubscribe confirmation email
const sendUnsubscribeEmail = async (email, firstName) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"DataWeb" <${process.env.SMTP_USER}>`,
      to: email,
      subject: 'Unsubscribed from DataWeb Newsletter',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px;">DataWeb</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">Newsletter Unsubscription</p>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333; margin-bottom: 20px;">Hello ${firstName}!</h2>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 25px;">
              We're sorry to see you go! You have been successfully unsubscribed from the DataWeb newsletter.
            </p>
            
            <p style="color: #666; line-height: 1.6; margin-bottom: 15px;">
              You can always resubscribe at any time by visiting our website and signing up again. 
              We hope to see you back soon!
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #999; font-size: 14px; text-align: center;">
              Best regards,<br>
              The DataWeb Team
            </p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Unsubscribe email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send unsubscribe email:', error);
    return false;
  }
};

// Send comment notification email (for admin)
const sendCommentNotificationEmail = async (postTitle, commentAuthor, commentContent) => {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: `"DataWeb" <${process.env.SMTP_USER}>`,
      to: process.env.ADMIN_EMAIL,
      subject: 'New Comment on DataWeb Blog',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
            <h1 style="margin: 0; font-size: 28px;">DataWeb</h1>
            <p style="margin: 10px 0 0 0; opacity: 0.9;">New Comment Notification</p>
          </div>
          
          <div style="padding: 30px; background: #f9f9f9;">
            <h2 style="color: #333; margin-bottom: 20px;">New Comment Posted</h2>
            
            <div style="background: #fff; padding: 20px; border-radius: 5px; border-left: 4px solid #667eea;">
              <h3 style="color: #333; margin-top: 0;">Post: ${postTitle}</h3>
              <p style="color: #666; margin-bottom: 10px;"><strong>Author:</strong> ${commentAuthor}</p>
              <p style="color: #333; line-height: 1.6; font-style: italic;">"${commentContent}"</p>
            </div>
            
            <p style="color: #666; line-height: 1.6; margin-top: 20px;">
              You can review and moderate this comment from your admin dashboard.
            </p>
            
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            
            <p style="color: #999; font-size: 14px; text-align: center;">
              DataWeb Admin System
            </p>
          </div>
        </div>
      `
    };

    const info = await transporter.sendMail(mailOptions);
    console.log('✅ Comment notification email sent:', info.messageId);
    return true;
  } catch (error) {
    console.error('❌ Failed to send comment notification email:', error);
    return false;
  }
};

module.exports = {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSubscriptionEmail,
  sendUnsubscribeEmail,
  sendCommentNotificationEmail
};
