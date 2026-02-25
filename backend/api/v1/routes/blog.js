const express = require('express');
const { optionalAuth } = require('../../../middleware/auth');
const blogService = require('../../../modules/blog/blog.service');
const legacyBlogRoutes = require('../../../routes/blog');

const router = express.Router();

router.get('/posts', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.getPublishedPosts(req.query || {});
    return res.json(payload);
  } catch (error) {
    console.error('v1 blog posts error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch blog posts',
    });
  }
});

router.post('/sync/markdown', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.syncMarkdownPosts({
      body: req.body,
      queryParams: req.query,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 sync markdown posts error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to sync markdown posts',
    });
  }
});

router.get('/sync/markdown', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.syncMarkdownPosts({
      body: req.body,
      queryParams: req.query,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 sync markdown posts error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to sync markdown posts',
    });
  }
});

router.post('/posts/ensure', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.ensurePost(req.body || {});
    return res.json(payload);
  } catch (error) {
    console.error('v1 ensure blog post row error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to ensure blog post row',
    });
  }
});

router.get('/posts/:slug', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.getPostBySlug({
      slugInput: req.params.slug,
      req,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 get blog post error:', error);
    const statusCode = error?.statusCode || 500;
    if (statusCode === 404) {
      return res.status(404).json({ error: 'Blog post not found', slug: error.slug });
    }
    return res.status(statusCode).json({
      error: error?.message || 'Failed to fetch blog post',
    });
  }
});

router.post('/posts/:slug/like', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.likePost({
      slugInput: req.params.slug,
      req,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 like post error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to like/unlike post',
    });
  }
});

router.get('/categories', async (_req, res) => {
  try {
    const payload = await blogService.getCategories();
    return res.json(payload);
  } catch (error) {
    console.error('v1 get categories error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch categories',
    });
  }
});

router.get('/tags', async (_req, res) => {
  try {
    const payload = await blogService.getTags();
    return res.json(payload);
  } catch (error) {
    console.error('v1 get tags error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch tags',
    });
  }
});

router.get('/featured', async (_req, res) => {
  try {
    const payload = await blogService.getFeaturedPosts();
    return res.json(payload);
  } catch (error) {
    console.error('v1 get featured posts error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch featured posts',
    });
  }
});

router.get('/recent', async (req, res) => {
  try {
    const payload = await blogService.getRecentPosts(req.query?.limit);
    return res.json(payload);
  } catch (error) {
    console.error('v1 get recent posts error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch recent posts',
    });
  }
});

router.get('/popular', async (req, res) => {
  try {
    const payload = await blogService.getPopularPosts({
      periodInput: req.query?.period,
      limitInput: req.query?.limit,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 get popular posts error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch popular posts',
    });
  }
});

router.get('/search', async (req, res) => {
  try {
    const payload = await blogService.searchPosts({
      q: req.query?.q,
      pageInput: req.query?.page,
      limitInput: req.query?.limit,
    });
    return res.json(payload);
  } catch (error) {
    console.error('v1 search posts error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to search posts',
    });
  }
});

router.get('/analytics', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.getAnalytics(req.user);
    return res.json(payload);
  } catch (error) {
    console.error('v1 get blog analytics error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to fetch blog analytics',
    });
  }
});

router.post('/import', optionalAuth, async (req, res) => {
  try {
    const payload = await blogService.importMarkdownPosts(req.user);
    return res.json(payload);
  } catch (error) {
    console.error('v1 import posts error:', error);
    return res.status(error?.statusCode || 500).json({
      error: error?.message || 'Failed to import posts',
    });
  }
});

// Compatibility fallback for any endpoint not yet migrated in Phase B.
router.use('/', legacyBlogRoutes);

module.exports = router;
