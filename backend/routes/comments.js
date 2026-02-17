const express = require('express');
const net = require('net');
const { body, validationResult } = require('express-validator');
const { query } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isNumericId = (value) => /^\d+$/.test(String(value || '').trim());
const isUuidId = (value) => UUID_REGEX.test(String(value || '').trim());
const isSupportedId = (value) => isNumericId(value) || isUuidId(value);
const normalizeId = (value) => String(value ?? '').trim();

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

async function tableExists(tableName) {
  const result = await query(
    `SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = $1
    ) AS exists`,
    [tableName]
  );

  return Boolean(result.rows?.[0]?.exists);
}

function buildVisibleCommentsWhereClause(alias, blogCommentColumns) {
  const column = (name) => (alias ? `${alias}.${name}` : name);
  const clauses = [`${column('post_id')} = $1`];

  if (blogCommentColumns.has('is_approved')) {
    clauses.push(`${column('is_approved')} = true`);
  }

  if (blogCommentColumns.has('is_spam')) {
    clauses.push(`COALESCE(${column('is_spam')}, false) = false`);
  }

  return clauses.join(' AND ');
}

// Get comments for a blog post
router.get('/post/:postId', optionalAuth, async (req, res) => {
  try {
    const postId = normalizeId(req.params.postId);
    if (!isSupportedId(postId)) {
      return res.status(400).json({ error: 'Invalid post identifier' });
    }

    const parsedPage = Number.parseInt(String(req.query.page ?? '1'), 10);
    const parsedLimit = Number.parseInt(String(req.query.limit ?? '10'), 10);
    const page = Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1;
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 200) : 10;
    const offset = (page - 1) * limit;
    const requesterIp = getClientInet(req);

    const blogCommentColumns = await getTableColumns('blog_comments');
    const hasCommentLikesTable = await tableExists('comment_likes');

    const visibleWhereClause = buildVisibleCommentsWhereClause('', blogCommentColumns);
    const visibleWhereClauseForAlias = buildVisibleCommentsWhereClause('c', blogCommentColumns);

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM blog_comments WHERE ${visibleWhereClause}`,
      [postId]
    );
    const totalComments = parseInt(countResult.rows[0].count);

    const baseSelectFields = [
      'c.id',
      'c.post_id',
      blogCommentColumns.has('parent_id') ? 'c.parent_id' : 'NULL AS parent_id',
      'c.author_name',
      'c.author_email',
      blogCommentColumns.has('author_website') ? 'c.author_website' : 'NULL AS author_website',
      'c.content',
      blogCommentColumns.has('is_approved') ? 'c.is_approved' : 'true AS is_approved',
      'c.created_at',
      blogCommentColumns.has('updated_at') ? 'c.updated_at' : 'c.created_at AS updated_at',
    ];

    const likesSelectField = hasCommentLikesTable
      ? 'COUNT(cl.id) AS like_count'
      : '0::bigint AS like_count';
    const userLikedSelectField = hasCommentLikesTable
      ? 'EXISTS(SELECT 1 FROM comment_likes WHERE comment_id = c.id AND ip_address = $2) AS user_liked'
      : 'false AS user_liked';

    const commentsSql = hasCommentLikesTable
      ? `SELECT
          ${baseSelectFields.join(',\n          ')},
          ${likesSelectField},
          ${userLikedSelectField}
         FROM blog_comments c
         LEFT JOIN comment_likes cl ON c.id = cl.comment_id
         WHERE ${visibleWhereClauseForAlias}
         GROUP BY c.id
         ORDER BY c.created_at DESC
         LIMIT $3 OFFSET $4`
      : `SELECT
          ${baseSelectFields.join(',\n          ')},
          ${likesSelectField},
          ${userLikedSelectField}
         FROM blog_comments c
         WHERE ${visibleWhereClauseForAlias}
         ORDER BY c.created_at DESC
         LIMIT $2 OFFSET $3`;

    const commentQueryParams = hasCommentLikesTable
      ? [postId, requesterIp, limit, offset]
      : [postId, limit, offset];

    // Get comments with replies
    const result = await query(commentsSql, commentQueryParams);
    const comments = result.rows.map((row) => ({
      ...row,
      like_count: Number(row.like_count || 0),
      user_liked: Boolean(row.user_liked),
    }));

    // Organize comments into parent-child structure
    const commentMap = new Map();
    const topLevelComments = [];
    const hasParentId = blogCommentColumns.has('parent_id');

    comments.forEach(comment => {
      comment.replies = [];
      commentMap.set(comment.id, comment);
    });

    comments.forEach(comment => {
      if (hasParentId && comment.parent_id) {
        const parent = commentMap.get(comment.parent_id);
        if (parent) {
          parent.replies.push(comment);
        }
      } else {
        topLevelComments.push(comment);
      }
    });

    res.json({
      comments: topLevelComments,
      pagination: {
        page,
        limit,
        total: totalComments,
        pages: Math.ceil(totalComments / limit)
      }
    });

  } catch (error) {
    console.error('Get comments error:', error);
    res.status(500).json({
      error:
        process.env.NODE_ENV === 'development'
          ? `Failed to fetch comments: ${error.message}`
          : 'Failed to fetch comments',
    });
  }
});

// Create a new comment (requires authentication)
router.post('/', authenticateToken, [
  body('post_id').custom((value) => {
    if (!isSupportedId(value)) {
      throw new Error('post_id must be a numeric id or UUID');
    }
    return true;
  }),
  body('content').trim().isLength({ min: 1, max: 2000 }),
  body('parent_id')
    .optional({ nullable: true })
    .custom((value) => {
      if (!isSupportedId(value)) {
        throw new Error('parent_id must be a numeric id or UUID');
      }
      return true;
    })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const post_id = normalizeId(req.body.post_id);
    const content = req.body.content;
    const parent_id = req.body.parent_id == null ? null : normalizeId(req.body.parent_id);
    const requesterIp = getClientInet(req);

    // Check if post exists
    const postResult = await query(
      'SELECT id FROM blog_posts WHERE id = $1 AND published = true',
      [post_id]
    );

    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: 'Blog post not found' });
    }

    // If this is a reply, check if parent comment exists
    if (parent_id) {
      const parentResult = await query(
        'SELECT id FROM blog_comments WHERE id = $1 AND post_id = $2 AND is_approved = true',
        [parent_id, post_id]
      );

      if (parentResult.rows.length === 0) {
        return res.status(400).json({ error: 'Parent comment not found' });
      }
    }

    // Create comment
    const result = await query(
      `INSERT INTO blog_comments (post_id, parent_id, author_name, author_email, content, ip_address, user_agent, is_approved)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, post_id, parent_id, author_name, author_email, content, created_at`,
      [
        post_id,
        parent_id || null,
        `${req.user.first_name} ${req.user.last_name}`,
        req.user.email,
        content,
        requesterIp,
        req.get('User-Agent'),
        true // Auto-approve authenticated users
      ]
    );

    const comment = result.rows[0];

    // Update comment count on blog post
    await query(
      'UPDATE blog_posts SET comment_count = (SELECT COUNT(*) FROM blog_comments WHERE post_id = $1 AND is_approved = true) WHERE id = $1',
      [post_id]
    );

    res.status(201).json({
      message: 'Comment posted successfully',
      comment: {
        ...comment,
        like_count: 0,
        user_liked: false,
        replies: []
      }
    });

  } catch (error) {
    console.error('Create comment error:', error);
    res.status(500).json({ error: 'Failed to post comment' });
  }
});

// Update a comment (only by the author)
router.put('/:commentId', authenticateToken, [
  body('content').trim().isLength({ min: 1, max: 2000 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { commentId } = req.params;
    const { content } = req.body;

    // Check if comment exists and belongs to user
    const commentResult = await query(
      'SELECT id, author_email FROM blog_comments WHERE id = $1',
      [commentId]
    );

    if (commentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = commentResult.rows[0];

    if (comment.author_email !== req.user.email) {
      return res.status(403).json({ error: 'You can only edit your own comments' });
    }

    // Update comment
    const result = await query(
      'UPDATE blog_comments SET content = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, content, updated_at',
      [content, commentId]
    );

    res.json({
      message: 'Comment updated successfully',
      comment: result.rows[0]
    });

  } catch (error) {
    console.error('Update comment error:', error);
    res.status(500).json({ error: 'Failed to update comment' });
  }
});

// Delete a comment (only by the author or admin)
router.delete('/:commentId', authenticateToken, async (req, res) => {
  try {
    const { commentId } = req.params;

    // Check if comment exists
    const commentResult = await query(
      'SELECT id, author_email, post_id FROM blog_comments WHERE id = $1',
      [commentId]
    );

    if (commentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    const comment = commentResult.rows[0];

    // Check if user is author or admin
    const isAuthor = comment.author_email === req.user.email;
    const isAdmin = req.user.subscription_status === 'admin'; // You might want to add a proper role field

    if (!isAuthor && !isAdmin) {
      return res.status(403).json({ error: 'You can only delete your own comments' });
    }

    // Delete comment and its replies
    await query(
      'DELETE FROM blog_comments WHERE id = $1 OR parent_id = $1',
      [commentId]
    );

    // Update comment count on blog post
    await query(
      'UPDATE blog_posts SET comment_count = (SELECT COUNT(*) FROM blog_comments WHERE post_id = $1 AND is_approved = true) WHERE id = $1',
      [comment.post_id]
    );

    res.json({ message: 'Comment deleted successfully' });

  } catch (error) {
    console.error('Delete comment error:', error);
    res.status(500).json({ error: 'Failed to delete comment' });
  }
});

// Like/unlike a comment
router.post('/:commentId/like', optionalAuth, async (req, res) => {
  try {
    const { commentId } = req.params;
    const requesterIp = getClientInet(req);

    if (!requesterIp) {
      return res.status(400).json({ error: 'Unable to determine client IP address' });
    }

    // Check if comment exists
    const commentResult = await query(
      'SELECT id FROM blog_comments WHERE id = $1 AND is_approved = true',
      [commentId]
    );

    if (commentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    // Check if user already liked this comment
    const existingLike = await query(
      'SELECT id FROM comment_likes WHERE comment_id = $1 AND ip_address = $2',
      [commentId, requesterIp]
    );

    if (existingLike.rows.length > 0) {
      // Unlike
      await query(
        'DELETE FROM comment_likes WHERE comment_id = $1 AND ip_address = $2',
        [commentId, requesterIp]
      );

      res.json({ message: 'Comment unliked', liked: false });
    } else {
      // Like
      await query(
        'INSERT INTO comment_likes (comment_id, ip_address) VALUES ($1, $2)',
        [commentId, requesterIp]
      );

      res.json({ message: 'Comment liked', liked: true });
    }

  } catch (error) {
    console.error('Like comment error:', error);
    res.status(500).json({ error: 'Failed to like/unlike comment' });
  }
});

// Get comment statistics for a post
router.get('/stats/:postId', async (req, res) => {
  try {
    const postId = normalizeId(req.params.postId);
    if (!isSupportedId(postId)) {
      return res.status(400).json({ error: 'Invalid post identifier' });
    }

    const result = await query(
      `SELECT 
        COUNT(*) as total_comments,
        COUNT(CASE WHEN parent_id IS NULL THEN 1 END) as top_level_comments,
        COUNT(CASE WHEN parent_id IS NOT NULL THEN 1 END) as replies,
        COUNT(CASE WHEN created_at > CURRENT_TIMESTAMP - INTERVAL '24 hours' THEN 1 END) as recent_comments
       FROM blog_comments 
       WHERE post_id = $1 AND is_approved = true AND is_spam = false`,
      [postId]
    );

    res.json({ stats: result.rows[0] });

  } catch (error) {
    console.error('Get comment stats error:', error);
    res.status(500).json({ error: 'Failed to get comment statistics' });
  }
});

// Admin: Get pending comments for moderation
router.get('/admin/pending', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin (you might want to add a proper role field)
    if (req.user.subscription_status !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const result = await query(
      `SELECT 
        c.id, c.post_id, c.parent_id, c.author_name, c.author_email, c.content, 
        c.is_approved, c.is_spam, c.created_at, c.ip_address,
        p.title as post_title, p.slug as post_slug
       FROM blog_comments c
       JOIN blog_posts p ON c.post_id = p.id
       WHERE c.is_approved = false OR c.is_spam = true
       ORDER BY c.created_at DESC`,
      []
    );

    res.json({ comments: result.rows });

  } catch (error) {
    console.error('Get pending comments error:', error);
    res.status(500).json({ error: 'Failed to get pending comments' });
  }
});

// Admin: Approve/reject comment
router.put('/admin/:commentId/moderate', authenticateToken, [
  body('action').isIn(['approve', 'reject', 'mark_spam'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Check if user is admin
    if (req.user.subscription_status !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { commentId } = req.params;
    const { action } = req.body;

    let updateQuery;
    let updateParams;

    switch (action) {
      case 'approve':
        updateQuery = 'UPDATE blog_comments SET is_approved = true, is_spam = false WHERE id = $1';
        updateParams = [commentId];
        break;
      case 'reject':
        updateQuery = 'UPDATE blog_comments SET is_approved = false, is_spam = false WHERE id = $1';
        updateParams = [commentId];
        break;
      case 'mark_spam':
        updateQuery = 'UPDATE blog_comments SET is_spam = true, is_approved = false WHERE id = $1';
        updateParams = [commentId];
        break;
    }

    const result = await query(updateQuery, updateParams);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Comment not found' });
    }

    res.json({ message: `Comment ${action}d successfully` });

  } catch (error) {
    console.error('Moderate comment error:', error);
    res.status(500).json({ error: 'Failed to moderate comment' });
  }
});

module.exports = router;
