# DataWeb Backend Deployment Guide

## 🚀 Complete Backend Setup for Digital Ocean

This guide will help you deploy the DataWeb backend to Digital Ocean and set up the complete comment and subscription system.

## 📋 Prerequisites

1. **Digital Ocean Account** with API token
2. **GitHub Repository** for your project
3. **Email Service** (Gmail, SendGrid, etc.) for sending verification emails
4. **Domain Name** (optional, for production)

## 🗄️ Database Setup

### Option 1: Digital Ocean Managed Database (Recommended)

1. **Create Database Cluster:**
   ```bash
   # Using Digital Ocean CLI
   doctl databases create dataweb-cluster --engine pg --version 15 --region nyc
   ```

2. **Get Connection String:**
   ```bash
   doctl databases get dataweb-cluster --format ConnectionString
   ```

### Option 2: Supabase (Alternative)

1. Create a new project on Supabase
2. Use the connection string from your project settings
3. Run the database schema from `database_schema.sql`

## 🔧 Backend Configuration

### 1. Environment Variables

Create a `.env` file in the backend directory:

```env
# Server Configuration
PORT=3001
NODE_ENV=production

# Database Configuration
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require

# JWT Configuration
JWT_SECRET=your-super-secret-jwt-key-here-make-it-long-and-random

# Email Configuration (SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Frontend URL
FRONTEND_URL=https://your-frontend-domain.com

# Admin Email
ADMIN_EMAIL=info@connectafrik.com
```

### 2. Email Service Setup

#### Gmail Setup:
1. Enable 2-factor authentication
2. Generate an App Password
3. Use the App Password in `SMTP_PASS`

#### SendGrid Setup:
1. Create a SendGrid account
2. Create an API key
3. Use SendGrid SMTP settings

## 🚀 Deployment to Digital Ocean

### Method 1: Using the Deployment Script

1. **Set Environment Variables:**
   ```bash
   export DIGITALOCEAN_API_TOKEN="your-api-token"
   ```

2. **Run Deployment Script:**
   ```bash
   python3 deploy_backend.py
   ```

### Method 2: Manual Deployment

1. **Create App Spec:**
   ```yaml
   # app.yaml
   name: dataweb-backend
   services:
     - name: api
       source_dir: /backend
       github:
         repo: your-username/dataweb
         branch: main
       run_command: npm start
       environment_slug: node-js
       instance_count: 1
       instance_size_slug: basic-xxs
       http_port: 3001
       envs:
         - key: NODE_ENV
           value: production
         - key: PORT
           value: "3001"
         - key: DATABASE_URL
           value: ${DATABASE_URL}
           type: SECRET
         - key: JWT_SECRET
           value: ${JWT_SECRET}
           type: SECRET
         - key: SMTP_HOST
           value: ${SMTP_HOST}
         - key: SMTP_PORT
           value: ${SMTP_PORT}
         - key: SMTP_USER
           value: ${SMTP_USER}
           type: SECRET
         - key: SMTP_PASS
           value: ${SMTP_PASS}
           type: SECRET
         - key: FRONTEND_URL
           value: ${FRONTEND_URL}
         - key: ADMIN_EMAIL
           value: ${ADMIN_EMAIL}
       health_check:
         http_path: /health
         initial_delay_seconds: 10
         period_seconds: 10
         timeout_seconds: 5
         success_threshold: 1
         failure_threshold: 3
   databases:
     - name: dataweb-db
       engine: PG
       version: "15"
       production: false
   region: nyc
   ```

2. **Deploy Using Digital Ocean CLI:**
   ```bash
   doctl apps create --spec app.yaml
   ```

## 🔐 Authentication System

### User Registration Flow:
1. User fills registration form
2. Backend creates user with verification token
3. Verification email sent
4. User clicks link to verify email
5. User can now post comments

### Login Flow:
1. User enters email/password
2. Backend validates credentials
3. JWT token generated and returned
4. Frontend stores token in localStorage
5. Token used for authenticated requests

## 💬 Comments System

### Features:
- ✅ User authentication required for posting
- ✅ Nested replies
- ✅ Like/unlike comments
- ✅ Comment moderation (admin)
- ✅ Spam protection
- ✅ Real-time updates

### API Endpoints:
- `GET /api/comments/post/:postId` - Get comments for a post
- `POST /api/comments` - Create new comment (authenticated)
- `PUT /api/comments/:commentId` - Update comment (author only)
- `DELETE /api/comments/:commentId` - Delete comment (author/admin)
- `POST /api/comments/:commentId/like` - Like/unlike comment

## 📧 Email Notifications

### Email Types:
1. **Verification Email** - Sent when user registers
2. **Password Reset Email** - Sent when user requests password reset
3. **Welcome Email** - Sent when user subscribes to newsletter
4. **Comment Notification** - Sent to admin for new comments

### Email Templates:
All emails use professional HTML templates with:
- DataWeb branding
- Clear call-to-action buttons
- Mobile-responsive design
- Professional styling

## 🔒 Security Features

### Authentication:
- JWT tokens with 7-day expiration
- Password hashing with bcrypt (12 rounds)
- Email verification required
- Rate limiting on API endpoints

### Data Protection:
- Input validation and sanitization
- SQL injection prevention
- XSS protection
- CORS configuration
- Helmet.js security headers

### Admin Features:
- Comment moderation
- User management
- Analytics dashboard
- System monitoring

## 📊 Database Schema

### Key Tables:
1. **customers** - User accounts and profiles
2. **blog_posts** - Blog post content
3. **blog_comments** - Comments and replies
4. **comment_likes** - Comment like tracking
5. **subscription_plans** - Available plans
6. **customer_subscriptions** - User subscriptions
7. **newsletter_subscribers** - Newsletter signups
8. **page_views** - Analytics tracking

## 🔄 Frontend Integration

### Update Frontend Configuration:

1. **Environment Variables:**
   ```env
   REACT_APP_API_URL=https://your-backend-app.ondigitalocean.app/api
   ```

2. **Authentication Context:**
   ```typescript
   // src/contexts/AuthContext.tsx
   const AuthContext = createContext({
     user: null,
     login: (token: string) => {},
     logout: () => {},
     isAuthenticated: false
   });
   ```

3. **API Service:**
   ```typescript
   // src/services/api.ts
   const API_BASE_URL = process.env.REACT_APP_API_URL;
   
   export const api = {
     login: (credentials) => fetch(`${API_BASE_URL}/auth/login`, {...}),
     register: (userData) => fetch(`${API_BASE_URL}/auth/register`, {...}),
     getComments: (postId) => fetch(`${API_BASE_URL}/comments/post/${postId}`),
     postComment: (comment) => fetch(`${API_BASE_URL}/comments`, {...})
   };
   ```

## 🧪 Testing

### Health Check:
```bash
curl https://your-backend-app.ondigitalocean.app/health
```

### API Testing:
```bash
# Test authentication
curl -X POST https://your-backend-app.ondigitalocean.app/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"password123","first_name":"Test","last_name":"User"}'

# Test comments
curl https://your-backend-app.ondigitalocean.app/api/comments/post/1
```

## 📈 Monitoring & Analytics

### Built-in Analytics:
- Page view tracking
- Comment statistics
- User engagement metrics
- Popular posts tracking

### Admin Dashboard Features:
- Real-time comment moderation
- User management
- Subscription analytics
- System health monitoring

## 🚨 Troubleshooting

### Common Issues:

1. **Database Connection Failed:**
   - Check DATABASE_URL format
   - Verify SSL settings
   - Ensure database is accessible

2. **Email Not Sending:**
   - Verify SMTP credentials
   - Check email service settings
   - Review firewall settings

3. **Authentication Issues:**
   - Verify JWT_SECRET is set
   - Check token expiration
   - Validate frontend-backend URL configuration

4. **CORS Errors:**
   - Update CORS configuration
   - Verify frontend URL in backend settings
   - Check browser console for details

### Debug Commands:
```bash
# Check backend logs
doctl apps logs your-app-id

# Check database connection
doctl databases get your-db-id

# Test email service
curl -X POST https://your-backend-app.ondigitalocean.app/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'
```

## 🔄 Updates & Maintenance

### Regular Tasks:
1. **Security Updates:** Keep dependencies updated
2. **Database Backups:** Set up automated backups
3. **Monitoring:** Check application health regularly
4. **Analytics:** Review user engagement metrics

### Scaling:
- Increase instance size as needed
- Add load balancers for high traffic
- Implement caching for better performance
- Consider CDN for static assets

## 📞 Support

For issues or questions:
1. Check the troubleshooting section
2. Review Digital Ocean documentation
3. Check application logs
4. Test API endpoints individually

## 🎉 Success Checklist

- [ ] Backend deployed to Digital Ocean
- [ ] Database connected and schema applied
- [ ] Email service configured and tested
- [ ] Frontend updated with new API endpoints
- [ ] Authentication system working
- [ ] Comments system functional
- [ ] Admin features accessible
- [ ] Security measures implemented
- [ ] Monitoring and analytics active
- [ ] Backup system configured

---

**Congratulations!** Your DataWeb backend is now fully deployed and ready to handle user authentication, comments, and subscriptions. Users can now create accounts, verify their emails, and participate in discussions on your blog posts.
