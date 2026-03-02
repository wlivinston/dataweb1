const express = require('express');
const { optionalAuth } = require('../../../middleware/auth');
const blogService = require('../../../modules/blog/blog.service');
const { sendSuccess, sendError } = require('../../../modules/common/apiResponse');
const { ApiError } = require('../../../modules/common/apiError');

const router = express.Router();

router.get('/posts', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.getPublishedPosts(req.query || {});
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/sync/markdown', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.syncMarkdownPosts({
      body: req.body,
      queryParams: req.query,
    });
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/sync/markdown', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.syncMarkdownPosts({
      body: req.body,
      queryParams: req.query,
    });
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/posts/ensure', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.ensurePost(req.body || {});
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/posts/:slug', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.getPostBySlug({
      slugInput: req.params.slug,
      req,
    });
    return sendSuccess(res, { data: payload });
  } catch (error) {
    if (error?.statusCode === 404) {
      return sendError(res, ApiError.notFound('Blog post not found', { slug: req.params.slug }));
    }
    return sendError(res, error);
  }
});

router.post('/posts/:slug/like', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.likePost({
      slugInput: req.params.slug,
      req,
    });
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/categories', async (_req, res) => {
  try {
    const payload = await blogService.getCategories();
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/tags', async (_req, res) => {
  try {
    const payload = await blogService.getTags();
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/featured', async (_req, res) => {
  try {
    const payload = await blogService.getFeaturedPosts();
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/recent', async (req, res) => {
  try {
    const payload = await blogService.getRecentPosts(req.query?.limit);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/popular', async (req, res) => {
  try {
    const payload = await blogService.getPopularPosts({
      periodInput: req.query?.period,
      limitInput: req.query?.limit,
    });
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/search', async (req, res) => {
  try {
    const payload = await blogService.searchPosts({
      q: req.query?.q,
      pageInput: req.query?.page,
      limitInput: req.query?.limit,
    });
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get('/analytics', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.getAnalytics(req.user);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

router.post('/import', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.importMarkdownPosts(req.user);
    return sendSuccess(res, { data: payload });
  } catch (error) {
    return sendError(res, error);
  }
});

module.exports = router;
