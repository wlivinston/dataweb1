const fs = require('fs');
const path = require('path');
const net = require('net');
const matter = require('gray-matter');
const { supabase } = require('../../config/supabase');
const { query } = require('../../config/database');
const blogRepository = require('./blog.repository');

const BLOGS_DIR = path.join(__dirname, '../../../src/blogs');

function parsePositiveInt(value, fallback, min = 1, max = 200) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
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

  const target = normalizeSlug(slugInput);
  if (!target) return null;

  const files = fs.readdirSync(BLOGS_DIR).filter((file) => file.endsWith('.md'));
  const match = files.find((file) => normalizeSlug(file.replace(/\.md$/i, '')) === target);
  if (!match) return null;

  return path.join(BLOGS_DIR, match);
}

function normalizeInetCandidate(rawValue) {
  if (!rawValue) return null;

  const first = String(rawValue)
    .split(',')[0]
    .trim()
    .replace(/^\[|\]$/g, '');

  if (!first) return null;

  const v4WithPort = first.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (v4WithPort) {
    const ip = v4WithPort[1];
    return net.isIP(ip) ? ip : null;
  }

  const normalized = first.replace(/^::ffff:/i, '');
  return net.isIP(normalized) ? normalized : null;
}

function getClientInet(req) {
  const candidates = [
    req.ip,
    req.headers['x-forwarded-for'],
    req.socket?.remoteAddress,
    req.connection?.remoteAddress,
  ];

  for (const candidate of candidates) {
    const ip = normalizeInetCandidate(candidate);
    if (ip) return ip;
  }

  return null;
}

async function getTableColumns(tableName) {
  const result = await query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`,
    [tableName]
  );

  return new Set(result.rows.map((row) => String(row.column_name || '').trim()));
}

function buildPostLikeIdentity(req, postId, postLikeColumns) {
  const userId = String(req.user?.id || req.user?.auth_user_id || '').trim();
  const userEmail = String(req.user?.email || '').trim().toLowerCase();

  if (userId && postLikeColumns.has('user_id')) {
    const insertColumns = ['post_id', 'user_id'];
    const insertValues = [postId, userId];

    if (postLikeColumns.has('user_email') && userEmail) {
      insertColumns.push('user_email');
      insertValues.push(userEmail);
    }

    if (postLikeColumns.has('ip_address')) {
      const ip = getClientInet(req);
      if (ip) {
        insertColumns.push('ip_address');
        insertValues.push(ip);
      }
    }

    return {
      whereClause: 'post_id = $1 AND user_id = $2',
      whereValues: [postId, userId],
      insertColumns,
      insertValues,
    };
  }

  if (userEmail && postLikeColumns.has('user_email')) {
    const insertColumns = ['post_id', 'user_email'];
    const insertValues = [postId, userEmail];

    if (postLikeColumns.has('ip_address')) {
      const ip = getClientInet(req);
      if (ip) {
        insertColumns.push('ip_address');
        insertValues.push(ip);
      }
    }

    return {
      whereClause: 'post_id = $1 AND lower(user_email) = lower($2)',
      whereValues: [postId, userEmail],
      insertColumns,
      insertValues,
    };
  }

  if (postLikeColumns.has('ip_address')) {
    const requesterIp = getClientInet(req);
    if (!requesterIp) return null;

    return {
      whereClause: 'post_id = $1 AND ip_address = $2',
      whereValues: [postId, requesterIp],
      insertColumns: ['post_id', 'ip_address'],
      insertValues: [postId, requesterIp],
    };
  }

  return null;
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

      const existing = await query('SELECT id FROM blog_posts WHERE slug = $1 LIMIT 1', [
        String(filteredPayload.slug),
      ]);

      const existingRow = existing.rows?.[0] || null;

      if (existingRow?.id) {
        const updateEntries = Object.entries(filteredPayload).filter(
          ([key]) => key !== 'id' && key !== 'slug'
        );
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

  const sqlResult = await query('SELECT id, slug, title FROM blog_posts WHERE slug = $1 LIMIT 1', [
    normalizedSlug,
  ]);

  return sqlResult.rows?.[0] || null;
}

async function writeBlogPostBySlug(payload) {
  if (!supabase) {
    return writeBlogPostBySlugSql(payload);
  }

  let mutablePayload = { ...payload };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const upsertResponse = await supabase
      .from('blog_posts')
      .upsert(mutablePayload, { onConflict: 'slug' });

    if (!upsertResponse.error) {
      return mutablePayload;
    }

    const missingColumn = tryExtractMissingColumn(upsertResponse.error);
    if (missingColumn && Object.prototype.hasOwnProperty.call(mutablePayload, missingColumn)) {
      const nextPayload = { ...mutablePayload };
      delete nextPayload[missingColumn];
      mutablePayload = nextPayload;
      continue;
    }

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
        const insertResult = await supabase.from('blog_posts').insert(mutablePayload);
        if (insertResult.error) {
          throw insertResult.error;
        }
      }

      return mutablePayload;
    }

    try {
      return await writeBlogPostBySlugSql(mutablePayload);
    } catch (_sqlFallbackError) {
      // preserve original error
    }

    throw upsertResponse.error;
  }

  return mutablePayload;
}

async function syncMarkdownPostBySlug(slugInput) {
  const filePath = findMarkdownFileBySlug(slugInput);
  if (!filePath) return null;

  const fileName = path.basename(filePath);
  const slug = normalizeSlug(fileName.replace(/\.md$/i, ''));
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
  const slugRaw = String(slugInput || '').trim();
  const slug = normalizeSlug(slugRaw);
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

    if (slugRaw && slugRaw !== slug) {
      response = await supabase
        .from('blog_posts')
        .select('*')
        .eq('slug', slugRaw)
        .eq('published', true)
        .maybeSingle();

      if (!response.error && response.data) {
        return response.data;
      }
    }

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

  const exact = await query('SELECT * FROM blog_posts WHERE slug = $1 AND published = true LIMIT 1', [
    slug,
  ]);
  if (exact.rows?.[0]) return exact.rows[0];

  const fallback = await query(
    'SELECT * FROM blog_posts WHERE lower(slug) = lower($1) AND published = true LIMIT 1',
    [slug]
  );
  if (fallback.rows?.[0]) return fallback.rows[0];

  const normalizedFallback = await query(
    `SELECT *
     FROM blog_posts
     WHERE trim(both '-' from regexp_replace(lower(slug), '[^a-z0-9]+', '-', 'g')) = $1
       AND published = true
     LIMIT 1`,
    [slug]
  );

  return normalizedFallback.rows?.[0] || null;
}

async function getPublishedPosts(input = {}) {
  const page = parsePositiveInt(input.page, 1, 1, 100000);
  const limit = parsePositiveInt(input.limit, 10, 1, 200);
  const category = String(input.category || '').trim() || null;
  const tag = String(input.tag || '').trim() || null;
  const search = String(input.search || '').trim() || null;

  const result = await blogRepository.listPublishedPosts({
    page,
    limit,
    category,
    tag,
    search,
  });

  const postsWithUserData = result.posts.map((post) => ({
    ...post,
    user_liked: false,
    user_bookmarked: false,
  }));

  return {
    posts: postsWithUserData,
    pagination: {
      page: result.page,
      limit: result.limit,
      total: result.total,
      pages: Math.ceil(result.total / result.limit),
    },
  };
}

async function syncMarkdownPosts({ body, queryParams }) {
  if (!fs.existsSync(BLOGS_DIR)) {
    const error = new Error('Blogs directory not found');
    error.statusCode = 404;
    throw error;
  }

  const bodySlugs = Array.isArray(body?.slugs)
    ? body.slugs.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  const querySlugs =
    typeof queryParams?.slugs === 'string'
      ? queryParams.slugs
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
    } catch (syncError) {
      errors.push({ slug, error: syncError.message });
    }
  }

  return {
    message: 'Markdown sync completed',
    synced_count: synced.length,
    error_count: errors.length,
    posts: synced,
    errors,
  };
}

async function ensurePost(incoming) {
  const payloadIn = incoming || {};
  const slug = normalizeSlug(payloadIn.slug);
  if (!slug) {
    const error = new Error('Valid slug is required');
    error.statusCode = 400;
    throw error;
  }

  const title = String(payloadIn.title || slug).trim() || slug;
  const excerpt = String(payloadIn.excerpt || '').trim();
  const content = String(payloadIn.content || '').trim();
  const author = String(payloadIn.author || 'DataWeb Team').trim() || 'DataWeb Team';
  const category = String(payloadIn.category || 'General').trim() || 'General';
  const publishedAt =
    typeof payloadIn.date === 'string' && payloadIn.date.trim()
      ? payloadIn.date.trim()
      : new Date().toISOString();

  const payload = {
    slug,
    title,
    excerpt,
    content,
    author,
    category,
    tags: normalizeTags(payloadIn.tags),
    featured: payloadIn.featured === true,
    published: true,
    published_at: publishedAt,
    read_time: parseReadTimeMinutes(payloadIn.read_time ?? payloadIn.readTime),
  };

  await writeBlogPostBySlug(payload);
  const ensuredPost = await fetchBlogPostIdentityBySlug(slug);

  if (!ensuredPost) {
    const error = new Error('Unable to ensure blog post row');
    error.statusCode = 500;
    throw error;
  }

  return {
    message: 'Blog post row ensured',
    post: ensuredPost,
  };
}

async function getRelatedPosts(post) {
  if (supabase) {
    const { data } = await supabase
      .from('blog_posts')
      .select('id, slug, title, excerpt, author, category, published_at, view_count')
      .eq('published', true)
      .neq('id', post.id)
      .or(`category.eq.${post.category},tags.cs.{${post.tags?.[0] || ''}}`)
      .order('published_at', { ascending: false })
      .limit(3);

    return data || [];
  }

  const result = await query(
    `SELECT id, slug, title, excerpt, author, category, published_at, view_count
     FROM blog_posts
     WHERE published = true
       AND id <> $1
       AND (category = $2 OR ($3 <> '' AND $3 = ANY(tags)))
     ORDER BY published_at DESC
     LIMIT 3`,
    [post.id, post.category || '', String(post.tags?.[0] || '')]
  );
  return result.rows || [];
}

async function incrementPostView(post, slug, req) {
  const nextViewCount = Number(post.view_count || 0) + 1;

  if (supabase) {
    await supabase
      .from('blog_posts')
      .update({ view_count: nextViewCount })
      .eq('id', post.id);

    await supabase.from('page_views').insert({
      page_url: `/blog/${slug}`,
      ip_address: req.ip,
      user_agent: req.get('User-Agent'),
      referrer: req.get('Referrer'),
    });
    return;
  }

  await query('UPDATE blog_posts SET view_count = $2 WHERE id = $1', [post.id, nextViewCount]);
  try {
    await query(
      `INSERT INTO page_views (page_url, ip_address, user_agent, referrer)
       VALUES ($1, $2, $3, $4)`,
      [`/blog/${slug}`, req.ip || null, req.get('User-Agent') || null, req.get('Referrer') || null]
    );
  } catch (_error) {
    // analytics table may be absent in some environments
  }
}

async function getPostBySlug({ slugInput, req }) {
  const slug = normalizeSlug(slugInput);
  if (!slug) {
    const error = new Error('Invalid slug');
    error.statusCode = 400;
    throw error;
  }

  let post = await getPublishedPostBySlug(slug);
  if (!post) {
    const synced = await syncMarkdownPostBySlug(slug).catch(() => null);
    if (synced) {
      post = await getPublishedPostBySlug(synced.slug);
    }
  }

  if (!post) {
    const error = new Error('Blog post not found');
    error.statusCode = 404;
    error.slug = slug;
    throw error;
  }

  const postLikeColumns = await getTableColumns('post_likes').catch(() => new Set());
  let userLiked = false;
  if (postLikeColumns.size > 0) {
    const identity = buildPostLikeIdentity(req, post.id, postLikeColumns);
    if (identity) {
      const likedResult = await query(
        `SELECT 1 FROM post_likes WHERE ${identity.whereClause} LIMIT 1`,
        identity.whereValues
      );
      userLiked = likedResult.rows.length > 0;
    }
  }

  await incrementPostView(post, slug, req).catch(() => undefined);
  const relatedPosts = await getRelatedPosts(post).catch(() => []);

  return {
    post: {
      ...post,
      user_liked: userLiked,
      user_bookmarked: false,
    },
    related_posts: relatedPosts,
  };
}

async function likePost({ slugInput, req }) {
  if (!req.user) {
    const error = new Error('You must be logged in to like a post');
    error.statusCode = 401;
    throw error;
  }

  const slug = normalizeSlug(slugInput);
  if (!slug) {
    const error = new Error('Invalid slug');
    error.statusCode = 400;
    throw error;
  }

  const post = await getPublishedPostBySlug(slug);
  if (!post?.id) {
    const error = new Error('Blog post not found');
    error.statusCode = 404;
    throw error;
  }

  const postLikeColumns = await getTableColumns('post_likes');
  const identity = buildPostLikeIdentity(req, post.id, postLikeColumns);
  if (!identity) {
    const error = new Error('Unable to resolve like identity for current user');
    error.statusCode = 400;
    throw error;
  }

  const existingLike = await query(
    `SELECT id FROM post_likes WHERE ${identity.whereClause} LIMIT 1`,
    identity.whereValues
  );

  if (existingLike.rows.length > 0) {
    const likeCountResult = await query(
      'SELECT COUNT(*)::INTEGER AS like_count FROM post_likes WHERE post_id = $1',
      [post.id]
    );
    const likeCount = Number(likeCountResult.rows?.[0]?.like_count || 0);
    return { message: 'Post already liked', liked: true, like_count: likeCount };
  }

  const placeholders = identity.insertColumns.map((_, index) => `$${index + 1}`).join(', ');
  await query(
    `INSERT INTO post_likes (${identity.insertColumns.join(', ')}) VALUES (${placeholders})`,
    identity.insertValues
  );

  const likeCountResult = await query(
    'SELECT COUNT(*)::INTEGER AS like_count FROM post_likes WHERE post_id = $1',
    [post.id]
  );
  const likeCount = Number(likeCountResult.rows?.[0]?.like_count || 0);

  await query('UPDATE blog_posts SET like_count = $2 WHERE id = $1', [post.id, likeCount]);

  return { message: 'Post liked', liked: true, like_count: likeCount };
}

async function getCategories() {
  const result = await query(
    `SELECT category, COUNT(*) as post_count
     FROM blog_posts
     WHERE published = true
     GROUP BY category
     ORDER BY post_count DESC`,
    []
  );

  return { categories: result.rows || [] };
}

async function getTags() {
  const result = await query(
    `SELECT unnest(tags) as tag, COUNT(*) as post_count
     FROM blog_posts
     WHERE published = true
     GROUP BY tag
     ORDER BY post_count DESC`,
    []
  );

  return { tags: result.rows || [] };
}

async function getFeaturedPosts() {
  const result = await query(
    `SELECT id, slug, title, excerpt, author, category, tags,
            published_at, view_count, like_count, comment_count
     FROM blog_posts
     WHERE published = true AND featured = true
     ORDER BY published_at DESC
     LIMIT 5`,
    []
  );

  return { posts: result.rows || [] };
}

async function getRecentPosts(limitInput) {
  const limit = parsePositiveInt(limitInput, 5, 1, 50);
  const result = await query(
    `SELECT id, slug, title, excerpt, author, category, tags,
            published_at, view_count, like_count, comment_count
     FROM blog_posts
     WHERE published = true
     ORDER BY published_at DESC
     LIMIT $1`,
    [limit]
  );

  return { posts: result.rows || [] };
}

async function getPopularPosts({ periodInput, limitInput }) {
  const period = parsePositiveInt(periodInput, 30, 1, 3650);
  const limit = parsePositiveInt(limitInput, 10, 1, 100);

  const result = await query(
    `SELECT id, slug, title, excerpt, author, category, tags,
            published_at, view_count, like_count, comment_count
     FROM blog_posts
     WHERE published = true
       AND published_at > CURRENT_TIMESTAMP - ($1 || ' days')::interval
     ORDER BY (view_count + like_count * 2 + comment_count * 3) DESC
     LIMIT $2`,
    [String(period), limit]
  );

  return { posts: result.rows || [] };
}

async function searchPosts({ q, pageInput, limitInput }) {
  const searchQuery = String(q || '').trim();
  if (searchQuery.length < 2) {
    const error = new Error('Search query must be at least 2 characters');
    error.statusCode = 400;
    throw error;
  }

  const page = parsePositiveInt(pageInput, 1, 1, 100000);
  const limit = parsePositiveInt(limitInput, 10, 1, 100);
  const offset = (page - 1) * limit;
  const searchTerm = `%${searchQuery}%`;

  const countResult = await query(
    `SELECT COUNT(*)::INTEGER AS total
     FROM blog_posts
     WHERE published = true
       AND (title ILIKE $1 OR excerpt ILIKE $1 OR content ILIKE $1)`,
    [searchTerm]
  );
  const totalPosts = Number(countResult.rows?.[0]?.total || 0);

  const result = await query(
    `SELECT id, slug, title, excerpt, author, category, tags,
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

  return {
    posts: result.rows || [],
    pagination: {
      page,
      limit,
      total: totalPosts,
      pages: Math.ceil(totalPosts / limit),
    },
    search_query: searchQuery,
  };
}

async function getAnalytics(user) {
  if (!user || user.subscription_status !== 'admin') {
    const error = new Error('Admin access required');
    error.statusCode = 403;
    throw error;
  }

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

  const recentActivityResult = await query(
    `SELECT
      p.title, p.slug, p.published_at,
      COUNT(c.id) as new_comments,
      COUNT(pv.id) as new_views
     FROM blog_posts p
     LEFT JOIN blog_comments c
       ON p.id = c.post_id AND c.created_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
     LEFT JOIN page_views pv
       ON pv.page_url = CONCAT('/blog/', p.slug)
      AND pv.viewed_at > CURRENT_TIMESTAMP - INTERVAL '7 days'
     WHERE p.published_at > CURRENT_TIMESTAMP - INTERVAL '30 days'
     GROUP BY p.id, p.title, p.slug, p.published_at
     ORDER BY p.published_at DESC
     LIMIT 10`,
    []
  );

  const topPostsResult = await query(
    `SELECT title, slug, view_count, like_count, comment_count
     FROM blog_posts
     WHERE published = true
     ORDER BY view_count DESC
     LIMIT 10`,
    []
  );

  return {
    stats: statsResult.rows?.[0] || {},
    recent_activity: recentActivityResult.rows || [],
    top_posts: topPostsResult.rows || [],
  };
}

async function importMarkdownPosts(user) {
  if (!user || user.subscription_status !== 'admin') {
    const error = new Error('Admin access required');
    error.statusCode = 403;
    throw error;
  }

  if (!fs.existsSync(BLOGS_DIR)) {
    const error = new Error('Blogs directory not found');
    error.statusCode = 404;
    throw error;
  }

  const files = fs.readdirSync(BLOGS_DIR).filter((file) => file.endsWith('.md'));
  const importedPosts = [];
  const errors = [];

  for (const file of files) {
    try {
      const filePath = path.join(BLOGS_DIR, file);
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const { data, content } = matter(fileContent);
      const slug = file.replace('.md', '');

      const existingPost = await query('SELECT id FROM blog_posts WHERE slug = $1', [slug]);
      if (existingPost.rows.length > 0) {
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
            slug,
          ]
        );
      } else {
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
            true,
          ]
        );
      }

      importedPosts.push(slug);
    } catch (importError) {
      errors.push({ file, error: importError.message });
    }
  }

  return {
    message: 'Import completed',
    imported: importedPosts.length,
    errors: errors.length,
    imported_posts: importedPosts,
    error_details: errors,
  };
}

module.exports = {
  getPublishedPosts,
  syncMarkdownPosts,
  ensurePost,
  getPostBySlug,
  likePost,
  getCategories,
  getTags,
  getFeaturedPosts,
  getRecentPosts,
  getPopularPosts,
  searchPosts,
  getAnalytics,
  importMarkdownPosts,
};
