const express = require('express');
const { supabase } = require('../config/supabase');
const { query } = require('../config/database');
const { optionalAuth } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const router = express.Router();
const BLOGS_DIR = path.join(__dirname, '../../src/blogs');

function parseFrontmatter(md) {
  const normalized = String(md || '').replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$/);

  if (!match) {
    return { data: {}, content: normalized };
  }

  const raw = match[1];
  const content = match[2];
  const data = {};

  raw.split(/\r?\n/).forEach((line) => {
    const idx = line.indexOf(':');
    if (idx === -1) return;

    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (value === 'true') data[key] = true;
    else if (value === 'false') data[key] = false;
    else data[key] = value;
  });

  return { data, content };
}

function findMarkdownFileBySlug(slugInput) {
  if (!fs.existsSync(BLOGS_DIR)) return null;

  const target = String(slugInput || '').trim().toLowerCase();
  if (!target) return null;

  const files = fs.readdirSync(BLOGS_DIR).filter((file) => file.endsWith('.md'));
  const match = files.find((file) => file.replace(/\.md$/i, '').toLowerCase() === target);
  if (!match) return null;

  return path.join(BLOGS_DIR, match);
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.map((tag) => String(tag).trim()).filter(Boolean);
  if (typeof tags === 'string') {
    return tags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

async function syncMarkdownPostBySlug(slugInput) {
  const filePath = findMarkdownFileBySlug(slugInput);
  if (!filePath) return null;

  const fileName = path.basename(filePath);
  const slug = fileName.replace(/\.md$/i, '');
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const { data, content } = parseFrontmatter(fileContent);

  const payload = {
    slug,
    title: data.title || slug,
    excerpt: data.excerpt || '',
    content,
    author: data.author || 'DataWeb Team',
    category: data.category || 'General',
    tags: normalizeTags(data.tags),
    featured: data.featured === true,
    published: true,
    published_at: data.date || new Date().toISOString(),
  };

  const { data: upserted, error } = await supabase
    .from('blog_posts')
    .upsert(payload, { onConflict: 'slug' })
    .select('id, slug, title')
    .single();

  if (error) {
    throw error;
  }

  return upserted;
}

// Get all blog posts
router.get('/posts', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 10, category, tag, search } = req.query;
    const from = (page - 1) * limit;
    const to = from + parseInt(limit) - 1;

    // Build query
    let query = supabase
      .from('blog_posts')
      .select('*', { count: 'exact' })
      .eq('published', true);

    if (category) {
      query = query.eq('category', category);
    }

    if (tag) {
      query = query.contains('tags', [tag]);
    }

    if (search) {
      query = query.or(`title.ilike.%${search}%,excerpt.ilike.%${search}%,content.ilike.%${search}%`);
    }

    // Get posts with pagination
    const { data: posts, error, count } = await query
      .order('featured', { ascending: false })
      .order('published_at', { ascending: false })
      .range(from, to);

    if (error) {
      console.error('Get blog posts error:', error);
      return res.status(500).json({ error: 'Failed to fetch blog posts' });
    }

    // Add user interaction data if authenticated
    const postsWithUserData = posts.map(post => ({
      ...post,
      user_liked: false, // You can implement this based on user likes
      user_bookmarked: false // You can implement this based on user bookmarks
    }));

    res.json({
      posts: postsWithUserData,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });

  } catch (error) {
    console.error('Get blog posts error:', error);
    res.status(500).json({ error: 'Failed to fetch blog posts' });
  }
});

async function handleMarkdownSync(req, res) {
  try {
    if (!fs.existsSync(BLOGS_DIR)) {
      return res.status(404).json({ error: 'Blogs directory not found' });
    }

    const bodySlugs = Array.isArray(req.body?.slugs)
      ? req.body.slugs.map((s) => String(s || '').trim()).filter(Boolean)
      : [];
    const querySlugs = typeof req.query?.slugs === 'string'
      ? req.query.slugs
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const requestedSlugs = bodySlugs.length > 0 ? bodySlugs : querySlugs;

    const files = fs.readdirSync(BLOGS_DIR).filter((file) => file.endsWith('.md'));
    const allSlugs = files.map((file) => file.replace(/\.md$/i, ''));
    const slugsToSync = requestedSlugs.length > 0 ? requestedSlugs : allSlugs;

    const synced = [];
    const errors = [];

    for (const slug of slugsToSync) {
      try {
        const post = await syncMarkdownPostBySlug(slug);
        if (post) {
          synced.push(post);
        } else {
          errors.push({ slug, error: 'Markdown file not found' });
        }
      } catch (error) {
        errors.push({ slug, error: error.message });
      }
    }

    res.json({
      message: 'Markdown sync completed',
      synced_count: synced.length,
      error_count: errors.length,
      posts: synced,
      errors,
    });
  } catch (error) {
    console.error('Sync markdown posts error:', error);
    res.status(500).json({ error: 'Failed to sync markdown posts' });
  }
}

// Sync markdown posts into backend table (supports all posts or specific slugs)
router.post('/sync/markdown', optionalAuth, handleMarkdownSync);
router.get('/sync/markdown', optionalAuth, handleMarkdownSync);

// Get a single blog post by slug
router.get('/posts/:slug', optionalAuth, async (req, res) => {
  try {
    const { slug } = req.params;

    // Get post from database
    const { data: post, error: postError } = await supabase
      .from('blog_posts')
      .select('*')
      .eq('slug', slug)
      .eq('published', true)
      .single();

    if (postError || !post) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    // Increment view count
    await supabase
      .from('blog_posts')
      .update({ view_count: post.view_count + 1 })
      .eq('id', post.id);

    // Record page view for analytics
    await supabase
      .from('page_views')
      .insert({
        page_url: `/blog/${slug}`,
        ip_address: req.ip,
        user_agent: req.get('User-Agent'),
        referrer: req.get('Referrer')
      });

    // Get related posts
    const { data: related, error: relatedError } = await supabase
      .from('blog_posts')
      .select('id, slug, title, excerpt, author, category, published_at, view_count')
      .eq('published', true)
      .neq('id', post.id)
      .or(`category.eq.${post.category},tags.cs.{${post.tags?.[0] || ''}}`)
      .order('published_at', { ascending: false })
      .limit(3);

    res.json({
      post: {
        ...post,
        user_liked: false, // You can implement this based on user likes
        user_bookmarked: false // You can implement this based on user bookmarks
      },
      related_posts: related || []
    });

  } catch (error) {
    console.error('Get blog post error:', error);
    res.status(500).json({ error: 'Failed to fetch blog post' });
  }
});

// Like/unlike a blog post
router.post('/posts/:slug/like', optionalAuth, async (req, res) => {
  try {
    const { slug } = req.params;

    // Get post
    const postResult = await query(
      'SELECT id FROM blog_posts WHERE slug = $1 AND published = true',
      [slug]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    const post = postResult.rows[0];

    // For now, we'll use IP-based likes. In a real app, you'd want user-based likes
    const existingLike = await query(
      'SELECT id FROM post_likes WHERE post_id = $1 AND ip_address = $2',
      [post.id, req.ip]
    );

    if (existingLike.rows.length > 0) {
      // Unlike
      await query(
        'DELETE FROM post_likes WHERE post_id = $1 AND ip_address = $2',
        [post.id, req.ip]
      );

      await query(
        'UPDATE blog_posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = $1',
        [post.id]
      );

      res.json({ message: 'Post unliked', liked: false });
    } else {
      // Like
      await query(
        'INSERT INTO post_likes (post_id, ip_address) VALUES ($1, $2)',
        [post.id, req.ip]
      );

      await query(
        'UPDATE blog_posts SET like_count = like_count + 1 WHERE id = $1',
        [post.id]
      );

      res.json({ message: 'Post liked', liked: true });
    }

  } catch (error) {
    console.error('Like post error:', error);
    res.status(500).json({ error: 'Failed to like/unlike post' });
  }
});

// Get blog categories
router.get('/categories', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        category,
        COUNT(*) as post_count
       FROM blog_posts 
       WHERE published = true 
       GROUP BY category 
       ORDER BY post_count DESC`,
      []
    );

    res.json({ categories: result.rows });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

// Get blog tags
router.get('/tags', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        unnest(tags) as tag,
        COUNT(*) as post_count
       FROM blog_posts 
       WHERE published = true 
       GROUP BY tag 
       ORDER BY post_count DESC`,
      []
    );

    res.json({ tags: result.rows });

  } catch (error) {
    console.error('Get tags error:', error);
    res.status(500).json({ error: 'Failed to fetch tags' });
  }
});

// Get featured posts
router.get('/featured', async (req, res) => {
  try {
    const result = await query(
      `SELECT 
        id, slug, title, excerpt, author, category, tags, 
        published_at, view_count, like_count, comment_count
       FROM blog_posts 
       WHERE published = true AND featured = true
       ORDER BY published_at DESC 
       LIMIT 5`,
      []
    );

    res.json({ posts: result.rows });

  } catch (error) {
    console.error('Get featured posts error:', error);
    res.status(500).json({ error: 'Failed to fetch featured posts' });
  }
});

// Get recent posts
router.get('/recent', async (req, res) => {
  try {
    const { limit = 5 } = req.query;

    const result = await query(
      `SELECT 
        id, slug, title, excerpt, author, category, tags, 
        published_at, view_count, like_count, comment_count
       FROM blog_posts 
       WHERE published = true
       ORDER BY published_at DESC 
       LIMIT $1`,
      [limit]
    );

    res.json({ posts: result.rows });

  } catch (error) {
    console.error('Get recent posts error:', error);
    res.status(500).json({ error: 'Failed to fetch recent posts' });
  }
});

// Get popular posts
router.get('/popular', async (req, res) => {
  try {
    const { period = '30', limit = 10 } = req.query;

    const result = await query(
      `SELECT 
        id, slug, title, excerpt, author, category, tags, 
        published_at, view_count, like_count, comment_count
       FROM blog_posts 
       WHERE published = true 
       AND published_at > CURRENT_TIMESTAMP - INTERVAL '${period} days'
       ORDER BY (view_count + like_count * 2 + comment_count * 3) DESC 
       LIMIT $1`,
      [limit]
    );

    res.json({ posts: result.rows });

  } catch (error) {
    console.error('Get popular posts error:', error);
    res.status(500).json({ error: 'Failed to fetch popular posts' });
  }
});

// Search posts
router.get('/search', async (req, res) => {
  try {
    const { q, page = 1, limit = 10 } = req.query;
    const offset = (page - 1) * limit;

    if (!q || q.trim().length < 2) {
      return res.status(400).json({ error: 'Search query must be at least 2 characters' });
    }

    const searchTerm = `%${q.trim()}%`;

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM blog_posts 
       WHERE published = true 
       AND (title ILIKE $1 OR excerpt ILIKE $1 OR content ILIKE $1)`,
      [searchTerm]
    );
    const totalPosts = parseInt(countResult.rows[0].count);

    // Get posts
    const result = await query(
      `SELECT 
        id, slug, title, excerpt, author, category, tags, 
        published_at, view_count, like_count, comment_count
       FROM blog_posts 
       WHERE published = true 
       AND (title ILIKE $1 OR excerpt ILIKE $1 OR content ILIKE $1)
       ORDER BY 
         CASE 
           WHEN title ILIKE $1 THEN 3
           WHEN excerpt ILIKE $1 THEN 2
           ELSE 1
         END DESC,
         published_at DESC
       LIMIT $2 OFFSET $3`,
      [searchTerm, limit, offset]
    );

    res.json({
      posts: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalPosts,
        pages: Math.ceil(totalPosts / limit)
      },
      search_query: q
    });

  } catch (error) {
    console.error('Search posts error:', error);
    res.status(500).json({ error: 'Failed to search posts' });
  }
});

// Get blog analytics (admin only)
router.get('/analytics', optionalAuth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user || req.user.subscription_status !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // Get basic stats
    const statsResult = await query(
      `SELECT 
        COUNT(*) as total_posts,
        COUNT(CASE WHEN featured = true THEN 1 END) as featured_posts,
        COUNT(CASE WHEN published = true THEN 1 END) as published_posts,
        SUM(view_count) as total_views,
        SUM(like_count) as total_likes,
        SUM(comment_count) as total_comments
       FROM blog_posts`,
      []
    );

    // Get recent activity
    const recentActivityResult = await query(
      `SELECT 
        p.title, p.slug, p.published_at,
        COUNT(c.id) as new_comments,
        COUNT(pv.id) as new_views
       FROM blog_posts p
       LEFT JOIN blog_comments c ON p.id = c.post_id AND c.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
       LEFT JOIN page_views pv ON pv.page_url = CONCAT('/blog/', p.slug) AND pv.viewed_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
       WHERE p.published_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
       GROUP BY p.id, p.title, p.slug, p.published_at
       ORDER BY p.published_at DESC
       LIMIT 10`,
      []
    );

    // Get top posts by views
    const topPostsResult = await query(
      `SELECT 
        title, slug, view_count, like_count, comment_count
       FROM blog_posts 
       WHERE published = true
       ORDER BY view_count DESC 
       LIMIT 10`,
      []
    );

    res.json({
      stats: statsResult.rows[0],
      recent_activity: recentActivityResult.rows,
      top_posts: topPostsResult.rows
    });

  } catch (error) {
    console.error('Get blog analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch blog analytics' });
  }
});

// Import markdown files to database (admin only)
router.post('/import', optionalAuth, async (req, res) => {
  try {
    // Check if user is admin
    if (!req.user || req.user.subscription_status !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const blogsDir = path.join(__dirname, '../../src/blogs');
    
    if (!fs.existsSync(blogsDir)) {
      return res.status(404).json({ error: 'Blogs directory not found' });
    }

    const files = fs.readdirSync(blogsDir).filter(file => file.endsWith('.md'));
    const importedPosts = [];
    const errors = [];

    for (const file of files) {
      try {
        const filePath = path.join(blogsDir, file);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const { data, content } = matter(fileContent);
        const slug = file.replace('.md', '');

        // Check if post already exists
        const existingPost = await query(
          'SELECT id FROM blog_posts WHERE slug = $1',
          [slug]
        );

        if (existingPost.rows.length > 0) {
          // Update existing post
          await query(
            `UPDATE blog_posts 
             SET title = $1, excerpt = $2, content = $3, author = $4, category = $5, 
                 tags = $6, featured = $7, updated_at = CURRENT_TIMESTAMP
             WHERE slug = $8`,
            [
              data.title || slug,
              data.excerpt || '',
              content,
              data.author || 'Admin',
              data.category || 'General',
              data.tags || [],
              data.featured || false,
              slug
            ]
          );
        } else {
          // Create new post
          await query(
            `INSERT INTO blog_posts (slug, title, excerpt, content, author, category, tags, featured, published)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [
              slug,
              data.title || slug,
              data.excerpt || '',
              content,
              data.author || 'Admin',
              data.category || 'General',
              data.tags || [],
              data.featured || false,
              true
            ]
          );
        }

        importedPosts.push(slug);
      } catch (error) {
        errors.push({ file, error: error.message });
      }
    }

    res.json({
      message: 'Import completed',
      imported: importedPosts.length,
      errors: errors.length,
      imported_posts: importedPosts,
      error_details: errors
    });

  } catch (error) {
    console.error('Import posts error:', error);
    res.status(500).json({ error: 'Failed to import posts' });
  }
});

module.exports = router;
