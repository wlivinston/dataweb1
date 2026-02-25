const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken, optionalAuth } = require('../../../middleware/auth');
const commentsService = require('../../../modules/comments/comments.service');
const legacyCommentsRoutes = require('../../../routes/comments');

const router = express.Router();
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isNumericId = (value) => /^\d+$/.test(String(value || '').trim());
const isUuidId = (value) => UUID_REGEX.test(String(value || '').trim());
const isSupportedId = (value) => isNumericId(value) || isUuidId(value);

router.get('/post/:postId', optionalAuth, async (req, res) => {
  try {
    const payload = await commentsService.listCommentsForPost({
      postId: req.params.postId,
      page: req.query?.page,
      limit: req.query?.limit,
      req,
    });

    return res.json(payload);
  } catch (error) {
    console.error('v1 comments list error:', error);
    return res.status(error?.statusCode || 500).json({
      error:
        process.env.NODE_ENV === 'development'
          ? `Failed to fetch comments: ${error?.message || 'Unknown error'}`
          : 'Failed to fetch comments',
    });
  }
});

router.post(
  '/',
  authenticateToken,
  [
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
      }),
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await commentsService.createComment({
        postId: req.body?.post_id,
        content: req.body?.content,
        parentId: req.body?.parent_id,
        user: req.user,
        req,
      });
      return res.status(201).json(payload);
    } catch (error) {
      console.error('v1 create comment error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to post comment',
      });
    }
  }
);

router.put(
  '/:commentId',
  authenticateToken,
  [body('content').trim().isLength({ min: 1, max: 2000 })],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await commentsService.updateComment({
        commentId: req.params.commentId,
        content: req.body?.content,
        userEmail: req.user?.email,
      });
      return res.json(payload);
    } catch (error) {
      console.error('v1 update comment error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to update comment',
      });
    }
  }
);

router.delete('/:commentId', authenticateToken, async (req, res) => {
  try {
    const payload = await commentsService.deleteComment({
      commentId: req.params.commentId,
      user: req.user,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 delete comment error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to delete comment',
    });
  }
});

router.post('/:commentId/like', optionalAuth, async (req, res) => {
  try {
    const payload = await commentsService.toggleCommentLike({
      commentId: req.params.commentId,
      req,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 like comment error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to like/unlike comment',
    });
  }
});

router.get('/stats/:postId', async (req, res) => {
  try {
    const payload = await commentsService.getCommentStats(req.params.postId);
    return res.json(payload);
  } catch (error) {
    console.error('v1 comment stats error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to get comment statistics',
    });
  }
});

router.get('/admin/pending', authenticateToken, async (req, res) => {
  try {
    const payload = await commentsService.getPendingCommentsForAdmin(req.user);
    return res.json(payload);
  } catch (error) {
    console.error('v1 pending comments error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to get pending comments',
    });
  }
});

router.put(
  '/admin/:commentId/moderate',
  authenticateToken,
  [body('action').isIn(['approve', 'reject', 'mark_spam'])],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const payload = await commentsService.moderateCommentByAdmin({
        commentId: req.params.commentId,
        action: req.body?.action,
        user: req.user,
      });
      return res.json(payload);
    } catch (error) {
      console.error('v1 moderate comment error:', error);
      return res.status(error?.statusCode || 500).json({
        error: error?.message || 'Failed to moderate comment',
      });
    }
  }
);

// Compatibility fallback for endpoints not yet migrated in Phase B.
router.use('/', legacyCommentsRoutes);

module.exports = router;
