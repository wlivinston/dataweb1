const { query } = require('../../config/database');

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

async function countVisibleComments({ postId, whereClause }) {
  const result = await query(
    `SELECT COUNT(*) FROM blog_comments WHERE ${whereClause}`,
    [postId]
  );

  return Number.parseInt(String(result.rows?.[0]?.count || '0'), 10) || 0;
}

async function fetchVisibleComments({
  postId,
  requesterIp,
  limit,
  offset,
  blogCommentColumns,
  hasCommentLikesTable,
  whereClauseForAlias,
}) {
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
        ${baseSelectFields.join(',\n        ')},
        ${likesSelectField},
        ${userLikedSelectField}
      FROM blog_comments c
      LEFT JOIN comment_likes cl ON c.id = cl.comment_id
      WHERE ${whereClauseForAlias}
      GROUP BY c.id
      ORDER BY c.created_at DESC
      LIMIT $3 OFFSET $4`
    : `SELECT
        ${baseSelectFields.join(',\n        ')},
        ${likesSelectField},
        ${userLikedSelectField}
      FROM blog_comments c
      WHERE ${whereClauseForAlias}
      ORDER BY c.created_at DESC
      LIMIT $2 OFFSET $3`;

  const params = hasCommentLikesTable
    ? [postId, requesterIp, limit, offset]
    : [postId, limit, offset];

  const result = await query(commentsSql, params);
  return result.rows || [];
}

async function findPublishedPostById(postId) {
  const result = await query(
    'SELECT id FROM blog_posts WHERE id = $1 AND published = true',
    [postId]
  );
  return result.rows?.[0] || null;
}

async function findApprovedParentComment(parentId, postId) {
  const result = await query(
    'SELECT id FROM blog_comments WHERE id = $1 AND post_id = $2 AND is_approved = true',
    [parentId, postId]
  );
  return result.rows?.[0] || null;
}

async function createComment({
  postId,
  parentId,
  authorName,
  authorEmail,
  content,
  ipAddress,
  userAgent,
}) {
  const result = await query(
    `INSERT INTO blog_comments (
      post_id, parent_id, author_name, author_email, content, ip_address, user_agent, is_approved
    )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, post_id, parent_id, author_name, author_email, content, created_at`,
    [postId, parentId || null, authorName, authorEmail, content, ipAddress, userAgent, true]
  );
  return result.rows?.[0] || null;
}

async function refreshPostCommentCount(postId) {
  await query(
    `UPDATE blog_posts
     SET comment_count = (
       SELECT COUNT(*) FROM blog_comments WHERE post_id = $1 AND is_approved = true
     )
     WHERE id = $1`,
    [postId]
  );
}

async function findCommentById(commentId) {
  const result = await query(
    'SELECT id, author_email, post_id FROM blog_comments WHERE id = $1',
    [commentId]
  );
  return result.rows?.[0] || null;
}

async function updateCommentContent(commentId, content) {
  const result = await query(
    `UPDATE blog_comments
     SET content = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2
     RETURNING id, content, updated_at`,
    [content, commentId]
  );
  return result.rows?.[0] || null;
}

async function deleteCommentAndReplies(commentId) {
  await query('DELETE FROM blog_comments WHERE id = $1 OR parent_id = $1', [commentId]);
}

async function findApprovedCommentById(commentId) {
  const result = await query(
    'SELECT id FROM blog_comments WHERE id = $1 AND is_approved = true',
    [commentId]
  );
  return result.rows?.[0] || null;
}

async function findCommentLike(commentId, ipAddress) {
  const result = await query(
    'SELECT id FROM comment_likes WHERE comment_id = $1 AND ip_address = $2',
    [commentId, ipAddress]
  );
  return result.rows?.[0] || null;
}

async function deleteCommentLike(commentId, ipAddress) {
  await query('DELETE FROM comment_likes WHERE comment_id = $1 AND ip_address = $2', [
    commentId,
    ipAddress,
  ]);
}

async function createCommentLike(commentId, ipAddress) {
  await query('INSERT INTO comment_likes (comment_id, ip_address) VALUES ($1, $2)', [
    commentId,
    ipAddress,
  ]);
}

async function getCommentStats(postId) {
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
  return result.rows?.[0] || null;
}

async function getPendingCommentsForAdmin() {
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
  return result.rows || [];
}

async function moderateComment(commentId, action) {
  let updateQuery = '';
  switch (action) {
    case 'approve':
      updateQuery =
        'UPDATE blog_comments SET is_approved = true, is_spam = false WHERE id = $1';
      break;
    case 'reject':
      updateQuery =
        'UPDATE blog_comments SET is_approved = false, is_spam = false WHERE id = $1';
      break;
    case 'mark_spam':
      updateQuery =
        'UPDATE blog_comments SET is_spam = true, is_approved = false WHERE id = $1';
      break;
    default:
      return 0;
  }

  const result = await query(updateQuery, [commentId]);
  return result.rowCount || 0;
}

module.exports = {
  getTableColumns,
  tableExists,
  countVisibleComments,
  fetchVisibleComments,
  findPublishedPostById,
  findApprovedParentComment,
  createComment,
  refreshPostCommentCount,
  findCommentById,
  updateCommentContent,
  deleteCommentAndReplies,
  findApprovedCommentById,
  findCommentLike,
  deleteCommentLike,
  createCommentLike,
  getCommentStats,
  getPendingCommentsForAdmin,
  moderateComment,
};
