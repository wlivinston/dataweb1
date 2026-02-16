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

function normalizeSlug(slugInput) {
  return String(slugInput || '')
    .trim()
    .toLowerCase()
    .replace(/%20/g, ' ')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseReadTimeMinutes(input) {
  if (typeof input === 'number' && Number.isFinite(input)) {
    return Math.min(240, Math.max(1, Math.round(input)));
  }

  if (typeof input === 'string') {
    const parsed = Number.parseInt(input.replace(/[^0-9]/g, ''), 10);
    if (Number.isFinite(parsed)) {
      return Math.min(240, Math.max(1, parsed));
    }
  }

  return 5;
}

function isMissingUniqueOnSlugError(error) {
  const message = String(error?.message || '').toLowerCase();
  const code = String(error?.code || '');
  return (
    code === '42P10' ||
    message.includes('no unique or exclusion constraint matching the on conflict specification')
  );
}

function tryExtractMissingColumn(error) {
  const message = String(error?.message || '');
  const match = message.match(/column "([^"]+)"/i);
  return match?.[1] || null;
}

function sanitizeIdentifier(identifier) {
  const value = String(identifier || '').trim();
  if (!/^[a-z_][a-z0-9_]*$/i.test(value)) {
    throw new Error(`Invalid SQL identifier: ${value}`);
  }
  return value;
}

async function getBlogPostColumnsFromSql() {
  const result = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'blog_posts'`,
    []
  );

  return new Set(
    (result.rows || [])
      .map((row) => String(row.column_name || '').trim())
      .filter(Boolean)
  );
}

function filterPayloadToKnownColumns(payload, knownColumns) {
  return Object.entries(payload || {}).reduce((acc, [key, value]) => {
    if (!knownColumns.has(key)) return acc;
    if (value === undefined) return acc;
    acc[key] = value;
    return acc;
  }, {});
}

async function writeBlogPostBySlugSql(payload) {
  let mutablePayload = { ...payload };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const knownColumns = await getBlogPostColumnsFromSql();
      const filteredPayload = filterPayloadToKnownColumns(mutablePayload, knownColumns);

      if (!filteredPayload.slug) {
        throw new Error('blog_posts.slug is required');
      }

      const existing = await query(
        'SELECT id FROM blog_posts WHERE slug = $1 LIMIT 1',
        [String(filteredPayload.slug)]
      );

      const existingRow = existing.rows?.[0] || null;

      if (existingRow?.id) {
        const updateEntries = Object.entries(filteredPayload).filter(([key]) => key !== 'id' && key !== 'slug');
        if (updateEntries.length > 0) {
          const setClause = updateEntries
            .map(([column], index) => `${sanitizeIdentifier(column)} = $${index + 1}`)
            .join(', ');
          const updateValues = updateEntries.map(([, value]) => value);

          await query(
            `UPDATE blog_posts SET ${setClause} WHERE id = $${updateValues.length + 1}`,
            [...updateValues, existingRow.id]
          );
        }
      } else {
        const insertEntries = Object.entries(filteredPayload).filter(([key]) => key !== 'id');
        const columns = insertEntries.map(([column]) => sanitizeIdentifier(column));
        const placeholders = insertEntries.map((_, index) => `$${index + 1}`);
        const values = insertEntries.map(([, value]) => value);

        await query(
          `INSERT INTO blog_posts (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`,
          values
        );
      }

      return filteredPayload;
    } catch (error) {
      const missingColumn = tryExtractMissingColumn(error);
      if (missingColumn && Object.prototype.hasOwnProperty.call(mutablePayload, missingColumn)) {
        const nextPayload = { ...mutablePayload };
        delete nextPayload[missingColumn];
        mutablePayload = nextPayload;
        continue;
      }
      throw error;
    }
  }

  return mutablePayload;
}

async function fetchBlogPostIdentityBySlug(slug) {
  const normalizedSlug = String(slug || '').trim();
  if (!normalizedSlug) return null;

  if (supabase) {
    const { data: post, error } = await supabase
      .from('blog_posts')
      .select('id, slug, title')
      .eq('slug', normalizedSlug)
      .maybeSingle();

    if (!error && post) {
      return post;
    }
  }

  const sqlResult = await query(
    'SELECT id, slug, title FROM blog_posts WHERE slug = $1 LIMIT 1',
    [normalizedSlug]
  );

  return sqlResult.rows?.[0] || null;
}

async function writeBlogPostBySlug(payload) {
  if (!supabase) {
    return writeBlogPostBySlugSql(payload);
  }

  let mutablePayload = { ...payload };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    // Preferred path when slug unique index exists.
    const upsertResponse = await supabase
      .from('blog_posts')
      .upsert(mutablePayload, { onConflict: 'slug' });

    if (!upsertResponse.error) {
      return mutablePayload;
    }

    // If schema differs (missing column), drop the missing key and retry.
    const missingColumn = tryExtractMissingColumn(upsertResponse.error);
    if (missingColumn && Object.prototype.hasOwnProperty.call(mutablePayload, missingColumn)) {
      const nextPayload = { ...mutablePayload };
      delete nextPayload[missingColumn];
      mutablePayload = nextPayload;
      continue;
    }

    // Fallback path when slug unique constraint is missing.
    if (isMissingUniqueOnSlugError(upsertResponse.error)) {
      const lookup = await supabase
        .from('blog_posts')
        .select('id')
        .eq('slug', String(mutablePayload.slug || ''))
        .limit(1)
        .maybeSingle();

      if (lookup.error) {
        throw lookup.error;
      }

      if (lookup.data?.id) {
        const updateResult = await supabase
          .from('blog_posts')
          .update(mutablePayload)
          .eq('id', lookup.data.id);
        if (updateResult.error) {
          throw updateResult.error;
        }
      } else {
        const insertResult = await supabase
          .from('blog_posts')
          .insert(mutablePayload);
        if (insertResult.error) {
          throw insertResult.error;
        }
      }

      return mutablePayload;
    }

    // Last fallback: write directly via SQL when Supabase upsert path fails.
    try {
      return await writeBlogPostBySlugSql(mutablePayload);
    } catch (_sqlFallbackError) {
      // Preserve original Supabase error below for clearer debugging signal.
    }

    throw upsertResponse.error;
  }

  return mutablePayload;
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

  await writeBlogPostBySlug(payload);

  const upserted = await fetchBlogPostIdentityBySlug(slug);

  if (!upserted) {
    throw new Error(`Markdown sync completed but no row found for slug "${slug}"`);
  }

  return upserted;
}

async function getPublishedPostBySlug(slugInput) {
  const slug = String(slugInput || '').trim();
  if (!slug) return null;

  if (supabase) {
    let response = await supabase
      .from('blog_posts')
      .select('*')
      .eq('slug', slug)
      .eq('published', true)
      .maybeSingle();

    if (!response.error && response.data) {
      return response.data;
    }

    // Fallback to case-insensitive match for historical rows.
    response = await supabase
      .from('blog_posts')
      .select('*')
      .ilike('slug', slug)
      .eq('published', true)
      .limit(1)
      .maybeSingle();

    if (!response.error) {
      return response.data || null;
    }
  }

  try {
    const exact = await query(
      'SELECT * FROM blog_posts WHERE slug = $1 AND published = true LIMIT 1',
      [slug]
    );

    if (exact.rows?.[0]) {
      return exact.rows[0];
    }

    const fallback = await query(
      'SELECT * FROM blog_posts WHERE lower(slug) = lower($1) AND published = true LIMIT 1',
      [slug]
    );
    return fallback.rows?.[0] || null;
  } catch {
    return null;
  }
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

// Ensure a blog post row exists for a slug (useful when backend cannot read markdown files at runtime).
router.post('/posts/ensure', optionalAuth, async (req, res) => {
  try {
    const incoming = req.body || {};
    const slug = normalizeSlug(incoming.slug);

    if (!slug) {
      return res.status(400).json({ error: 'Valid slug is required' });
    }

    const title = String(incoming.title || slug).trim() || slug;
    const excerpt = String(incoming.excerpt || '').trim();
    const content = String(incoming.content || '').trim();
    const author = String(incoming.author || 'DataWeb Team').trim() || 'DataWeb Team';
    const category = String(incoming.category || 'General').trim() || 'General';
    const publishedAt =
      typeof incoming.date === 'string' && incoming.date.trim()
        ? incoming.date.trim()
        : new Date().toISOString();

    const payload = {
      slug,
      title,
      excerpt,
      content,
      author,
      category,
      tags: normalizeTags(incoming.tags),
      featured: incoming.featured === true,
      published: true,
      published_at: publishedAt,
      read_time: parseReadTimeMinutes(incoming.read_time ?? incoming.readTime),
    };

    await writeBlogPostBySlug(payload);

    const ensuredPost = await fetchBlogPostIdentityBySlug(slug);

    if (!ensuredPost) {
      return res.status(500).json({ error: 'Unable to ensure blog post row' });
    }

    return res.json({
      message: 'Blog post row ensured',
      post: ensuredPost,
    });
  } catch (error) {
    console.error('Ensure blog post row error:', error);
    return res.status(500).json({ error: 'Failed to ensure blog post row' });
  }
});

// Get a single blog post by slug
router.get('/posts/:slug', optionalAuth, async (req, res) => {
  try {
    const slug = String(req.params.slug || '').trim();
    let post = await getPublishedPostBySlug(slug);

    // Auto-sync this markdown file when row is missing from blog_posts.
    if (!post) {
      const synced = await syncMarkdownPostBySlug(slug).catch((error) => {
        console.warn(`Auto-sync skipped for slug "${slug}":`, error?.message || error);
        return null;
      });

      if (synced) {
        post = await getPublishedPostBySlug(synced.slug);
      }
    }

    if (!post) {
      return res.status(404).json({ error: 'Blog post not found', slug });
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
