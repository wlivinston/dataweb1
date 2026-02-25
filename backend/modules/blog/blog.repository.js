const { supabase } = require('../../config/supabase');
const { query } = require('../../config/database');

function assertSupabase() {
  if (!supabase) {
    const error = new Error('Supabase client is not configured');
    error.statusCode = 500;
    throw error;
  }
}

async function listPublishedPosts({ page, limit, category, tag, search }) {
  const from = (page - 1) * limit;
  const to = from + limit - 1;

  if (supabase) {
    let request = supabase
      .from('blog_posts')
      .select('*', { count: 'exact' })
      .eq('published', true);

    if (category) {
      request = request.eq('category', category);
    }

    if (tag) {
      request = request.contains('tags', [tag]);
    }

    if (search) {
      request = request.or(
        `title.ilike.%${search}%,excerpt.ilike.%${search}%,content.ilike.%${search}%`
      );
    }

    const { data, error, count } = await request
      .order('featured', { ascending: false })
      .order('published_at', { ascending: false })
      .range(from, to);

    if (!error) {
      return {
        posts: Array.isArray(data) ? data : [],
        total: Number.isFinite(count) ? count : 0,
        page,
        limit,
      };
    }
  }

  const whereClauses = ['published = true'];
  const whereParams = [];

  if (category) {
    whereParams.push(category);
    whereClauses.push(`category = $${whereParams.length}`);
  }

  if (tag) {
    whereParams.push(tag);
    whereClauses.push(`$${whereParams.length} = ANY(tags)`);
  }

  if (search) {
    whereParams.push(`%${search}%`);
    const token = `$${whereParams.length}`;
    whereClauses.push(`(title ILIKE ${token} OR excerpt ILIKE ${token} OR content ILIKE ${token})`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const countResult = await query(
    `SELECT COUNT(*)::INTEGER AS total FROM blog_posts ${whereSql}`,
    whereParams
  );
  const total = Number(countResult.rows?.[0]?.total || 0);

  const listParams = [...whereParams, limit, from];
  const listResult = await query(
    `SELECT *
     FROM blog_posts
     ${whereSql}
     ORDER BY featured DESC, published_at DESC
     LIMIT $${whereParams.length + 1}
     OFFSET $${whereParams.length + 2}`,
    listParams
  );

  return {
    posts: listResult.rows || [],
    total,
    page,
    limit,
  };
}

module.exports = {
  listPublishedPosts,
};
