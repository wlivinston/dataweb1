const net = require('net');
const commentsRepository = require('./comments.repository');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isNumericId(value) {
  return /^\d+$/.test(String(value || '').trim());
}

function isUuidId(value) {
  return UUID_REGEX.test(String(value || '').trim());
}

function isSupportedId(value) {
  return isNumericId(value) || isUuidId(value);
}

function normalizeId(value) {
  return String(value ?? '').trim();
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

function organizeCommentsIntoTree(comments, hasParentId) {
  const commentMap = new Map();
  const topLevelComments = [];

  comments.forEach((comment) => {
    const hydrated = { ...comment, replies: [] };
    commentMap.set(hydrated.id, hydrated);
  });

  commentMap.forEach((comment) => {
    if (hasParentId && comment.parent_id) {
      const parent = commentMap.get(comment.parent_id);
      if (parent) {
        parent.replies.push(comment);
        return;
      }
    }
    topLevelComments.push(comment);
  });

  return topLevelComments;
}

function parsePositiveInt(value, fallback, min = 1, max = 200) {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return Math.min(parsed, max);
}

async function listCommentsForPost({ postId, page, limit, req }) {
  const normalizedPostId = normalizeId(postId);
  if (!isSupportedId(normalizedPostId)) {
    const error = new Error('Invalid post identifier');
    error.statusCode = 400;
    throw error;
  }

  const safePage = parsePositiveInt(page, 1, 1, 100000);
  const safeLimit = parsePositiveInt(limit, 10, 1, 200);
  const offset = (safePage - 1) * safeLimit;
  const requesterIp = getClientInet(req);

  const blogCommentColumns = await commentsRepository.getTableColumns('blog_comments');
  const hasCommentLikesTable = await commentsRepository.tableExists('comment_likes');
  const visibleWhereClause = buildVisibleCommentsWhereClause('', blogCommentColumns);
  const visibleWhereClauseForAlias = buildVisibleCommentsWhereClause('c', blogCommentColumns);

  const totalComments = await commentsRepository.countVisibleComments({
    postId: normalizedPostId,
    whereClause: visibleWhereClause,
  });

  const rawComments = await commentsRepository.fetchVisibleComments({
    postId: normalizedPostId,
    requesterIp,
    limit: safeLimit,
    offset,
    blogCommentColumns,
    hasCommentLikesTable,
    whereClauseForAlias: visibleWhereClauseForAlias,
  });

  const comments = rawComments.map((row) => ({
    ...row,
    like_count: Number(row.like_count || 0),
    user_liked: Boolean(row.user_liked),
  }));

  const tree = organizeCommentsIntoTree(comments, blogCommentColumns.has('parent_id'));

  return {
    comments: tree,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total: totalComments,
      pages: Math.ceil(totalComments / safeLimit),
    },
  };
}

async function createComment({
  postId,
  content,
  parentId,
  user,
  req,
}) {
  const normalizedPostId = normalizeId(postId);
  const normalizedParentId = parentId == null ? null : normalizeId(parentId);

  if (!isSupportedId(normalizedPostId)) {
    const error = new Error('post_id must be a numeric id or UUID');
    error.statusCode = 400;
    throw error;
  }

  if (normalizedParentId && !isSupportedId(normalizedParentId)) {
    const error = new Error('parent_id must be a numeric id or UUID');
    error.statusCode = 400;
    throw error;
  }

  const post = await commentsRepository.findPublishedPostById(normalizedPostId);
  if (!post) {
    const error = new Error('Blog post not found');
    error.statusCode = 404;
    throw error;
  }

  if (normalizedParentId) {
    const parent = await commentsRepository.findApprovedParentComment(
      normalizedParentId,
      normalizedPostId
    );
    if (!parent) {
      const error = new Error('Parent comment not found');
      error.statusCode = 400;
      throw error;
    }
  }

  const requesterIp = getClientInet(req);
  const authorName = `${user.first_name} ${user.last_name}`.trim();

  const comment = await commentsRepository.createComment({
    postId: normalizedPostId,
    parentId: normalizedParentId,
    authorName,
    authorEmail: user.email,
    content,
    ipAddress: requesterIp,
    userAgent: req.get('User-Agent'),
  });

  await commentsRepository.refreshPostCommentCount(normalizedPostId);

  return {
    message: 'Comment posted successfully',
    comment: {
      ...comment,
      like_count: 0,
      user_liked: false,
      replies: [],
    },
  };
}

async function updateComment({ commentId, content, userEmail }) {
  const comment = await commentsRepository.findCommentById(commentId);
  if (!comment) {
    const error = new Error('Comment not found');
    error.statusCode = 404;
    throw error;
  }

  if (comment.author_email !== userEmail) {
    const error = new Error('You can only edit your own comments');
    error.statusCode = 403;
    throw error;
  }

  const updated = await commentsRepository.updateCommentContent(commentId, content);
  return {
    message: 'Comment updated successfully',
    comment: updated,
  };
}

async function deleteComment({ commentId, user }) {
  const comment = await commentsRepository.findCommentById(commentId);
  if (!comment) {
    const error = new Error('Comment not found');
    error.statusCode = 404;
    throw error;
  }

  const isAuthor = comment.author_email === user.email;
  const isAdmin = user.subscription_status === 'admin';

  if (!isAuthor && !isAdmin) {
    const error = new Error('You can only delete your own comments');
    error.statusCode = 403;
    throw error;
  }

  await commentsRepository.deleteCommentAndReplies(commentId);
  await commentsRepository.refreshPostCommentCount(comment.post_id);

  return { message: 'Comment deleted successfully' };
}

async function toggleCommentLike({ commentId, req }) {
  const requesterIp = getClientInet(req);
  if (!requesterIp) {
    const error = new Error('Unable to determine client IP address');
    error.statusCode = 400;
    throw error;
  }

  const comment = await commentsRepository.findApprovedCommentById(commentId);
  if (!comment) {
    const error = new Error('Comment not found');
    error.statusCode = 404;
    throw error;
  }

  const existingLike = await commentsRepository.findCommentLike(commentId, requesterIp);
  if (existingLike) {
    await commentsRepository.deleteCommentLike(commentId, requesterIp);
    return { message: 'Comment unliked', liked: false };
  }

  await commentsRepository.createCommentLike(commentId, requesterIp);
  return { message: 'Comment liked', liked: true };
}

async function getCommentStats(postId) {
  const normalizedPostId = normalizeId(postId);
  if (!isSupportedId(normalizedPostId)) {
    const error = new Error('Invalid post identifier');
    error.statusCode = 400;
    throw error;
  }

  const stats = await commentsRepository.getCommentStats(normalizedPostId);
  return { stats };
}

async function getPendingCommentsForAdmin(user) {
  if (user?.subscription_status !== 'admin') {
    const error = new Error('Admin access required');
    error.statusCode = 403;
    throw error;
  }

  const comments = await commentsRepository.getPendingCommentsForAdmin();
  return { comments };
}

async function moderateCommentByAdmin({ commentId, action, user }) {
  if (user?.subscription_status !== 'admin') {
    const error = new Error('Admin access required');
    error.statusCode = 403;
    throw error;
  }

  const updatedRows = await commentsRepository.moderateComment(commentId, action);
  if (!updatedRows) {
    const error = new Error('Comment not found');
    error.statusCode = 404;
    throw error;
  }

  return { message: `Comment ${action}d successfully` };
}

module.exports = {
  listCommentsForPost,
  createComment,
  updateComment,
  deleteComment,
  toggleCommentLike,
  getCommentStats,
  getPendingCommentsForAdmin,
  moderateCommentByAdmin,
};
