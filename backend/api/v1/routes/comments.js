const express = require('express');
const { body } = require('express-validator');
const { authenticateToken, optionalAuth } = require('../../../middleware/auth');
const commentsService = require('../../../modules/comments/comments.service');
const { assertValidRequest } = require('../../../modules/common/validation');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');

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
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
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
      assertValidRequest(req);
      const payload = await commentsService.createComment({
        postId: req.body?.post_id,
        content: req.body?.content,
        parentId: req.body?.parent_id,
        user: req.user,
        req,
      });
      return sendSuccess(res, { status: 201, data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.put(
  '/:commentId',
  authenticateToken,
  [body('content').trim().isLength({ min: 1, max: 2000 })],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await commentsService.updateComment({
        commentId: req.params.commentId,
        content: req.body?.content,
        userEmail: req.user?.email,
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

router.delete('/:commentId', authenticateToken, async (req, res) => {
  try {
    const payload = await commentsService.deleteComment({
      commentId: req.params.commentId,
      user: req.user,
    });
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/:commentId/like', optionalAuth, async (req, res) => {
  try {
    const payload = await commentsService.toggleCommentLike({
      commentId: req.params.commentId,
      req,
    });
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/stats/:postId', async (req, res) => {
  try {
    const payload = await commentsService.getCommentStats(req.params.postId);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/admin/pending', authenticateToken, async (req, res) => {
  try {
    const payload = await commentsService.getPendingCommentsForAdmin(req.user);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.put(
  '/admin/:commentId/moderate',
  authenticateToken,
  [body('action').isIn(['approve', 'reject', 'mark_spam'])],
  async (req, res) => {
    try {
      assertValidRequest(req);
      const payload = await commentsService.moderateCommentByAdmin({
        commentId: req.params.commentId,
        action: req.body?.action,
        user: req.user,
      });
      return sendSuccess(res, { data: payload });
    } catch (error) {
      return sendError(res, error);
    }
  }
);

module.exports = router;
