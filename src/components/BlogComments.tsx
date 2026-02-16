import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageCircle, Reply, Heart, User, LogIn, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { getApiUrl } from '@/lib/publicConfig';
import { useAuth } from '@/hooks/useAuth';
import { useNavigate } from 'react-router-dom';

interface Comment {
  id: string;
  post_id: string;
  parent_id: string | null;
  author_name: string;
  author_email: string;
  author_website: string | null;
  content: string;
  is_approved?: boolean;
  created_at: string;
  updated_at?: string;
  replies: Comment[];
  like_count: number;
  user_liked: boolean;
}

interface BlogCommentsProps {
  postId?: string | number | null;
  postSlug: string;
}

interface ApiErrorResponse {
  error?: string;
  errors?: Array<{ msg?: string }>;
}

const normalizeComment = (raw: Partial<Comment> & { replies?: unknown }): Comment => {
  const rawReplies = Array.isArray(raw.replies) ? raw.replies : [];

  return {
    id: raw.id == null ? '' : String(raw.id),
    post_id: raw.post_id == null ? '' : String(raw.post_id),
    parent_id: raw.parent_id == null ? null : String(raw.parent_id),
    author_name: String(raw.author_name ?? 'Anonymous'),
    author_email: String(raw.author_email ?? ''),
    author_website: raw.author_website == null ? null : String(raw.author_website),
    content: String(raw.content ?? ''),
    is_approved: raw.is_approved,
    created_at: String(raw.created_at ?? new Date().toISOString()),
    updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
    replies: rawReplies.map((reply) => normalizeComment(reply as Partial<Comment> & { replies?: unknown })),
    like_count: Number(raw.like_count ?? 0),
    user_liked: Boolean(raw.user_liked),
  };
};

const extractErrorMessage = async (response: Response, fallback: string): Promise<string> => {
  try {
    const payload = (await response.json()) as ApiErrorResponse;

    if (typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error;
    }

    if (Array.isArray(payload.errors) && payload.errors.length > 0) {
      const first = payload.errors[0];
      if (first?.msg) {
        return first.msg;
      }
    }
  } catch {
    // Ignore parsing issues and fall back to default message.
  }

  return fallback;
};

const BlogComments: React.FC<BlogCommentsProps> = ({ postId, postSlug }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState({ content: '' });
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [resolvedPostId, setResolvedPostId] = useState<string | null>(() =>
    postId == null ? null : String(postId).trim() || null
  );
  const [isResolvingPostId, setIsResolvingPostId] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { user, session, loading } = useAuth();
  const navigate = useNavigate();
  const encodedRedirect = useMemo(
    () => encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`),
    []
  );

  const authHeader = useMemo(() => {
    if (!session?.access_token) {
      return {} as Record<string, string>;
    }

    return {
      Authorization: `Bearer ${session.access_token}`,
    };
  }, [session?.access_token]);

  const resolveBackendPostId = useCallback(async (): Promise<string | null> => {
    const direct = postId == null ? '' : String(postId).trim();
    if (direct) {
      setResolvedPostId(direct);
      return direct;
    }

    const slug = String(postSlug || '').trim();
    if (!slug) {
      setResolvedPostId(null);
      return null;
    }

    setIsResolvingPostId(true);
    try {
      const lookupResponse = await fetch(
        getApiUrl(`/api/blog/posts/${encodeURIComponent(slug)}`),
        {
          headers: { ...authHeader },
        }
      );

      if (lookupResponse.ok) {
        const payload = await lookupResponse.json();
        const id = payload?.post?.id;
        const normalizedId = id == null ? '' : String(id).trim();
        if (normalizedId) {
          setResolvedPostId(normalizedId);
          return normalizedId;
        }
      }

      const ensureResponse = await fetch(getApiUrl('/api/blog/posts/ensure'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({ slug }),
      });

      if (ensureResponse.ok) {
        const ensurePayload = await ensureResponse.json();
        const ensuredId = ensurePayload?.post?.id;
        const normalizedEnsuredId = ensuredId == null ? '' : String(ensuredId).trim();
        if (normalizedEnsuredId) {
          setResolvedPostId(normalizedEnsuredId);
          return normalizedEnsuredId;
        }
      }
    } catch (resolveError) {
      console.error('Error resolving backend post id:', resolveError);
    } finally {
      setIsResolvingPostId(false);
    }

    setResolvedPostId(null);
    return null;
  }, [authHeader, postId, postSlug]);

  const fetchComments = useCallback(async () => {
    setIsLoading(true);

    try {
      const effectivePostId = await resolveBackendPostId();
      if (!effectivePostId) {
        setComments([]);
        setError('Comments are unavailable for this article until it is synced in the backend `blog_posts` table.');
        return;
      }

      const response = await fetch(getApiUrl(`/api/comments/post/${encodeURIComponent(effectivePostId)}?limit=200`), {
        headers: {
          ...authHeader,
        },
      });

      if (!response.ok) {
        const message = await extractErrorMessage(response, 'Failed to fetch comments.');
        setError(message);
        setComments([]);
        return;
      }

      const payload = (await response.json()) as { comments?: unknown[] };
      const normalized = Array.isArray(payload.comments)
        ? payload.comments.map((item) => normalizeComment(item as Partial<Comment> & { replies?: unknown }))
        : [];

      setComments(normalized);
      setError(null);
    } catch (fetchError) {
      console.error('Error fetching comments:', fetchError);
      setError('Unable to load comments right now.');
      setComments([]);
    } finally {
      setIsLoading(false);
    }
  }, [authHeader, resolveBackendPostId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!session?.access_token) {
      setError('You must be logged in to post comments.');
      return;
    }

    if (!newComment.content.trim()) {
      setError('Please enter a comment.');
      return;
    }

    if (!resolvedPostId) {
      setError('Comments are still syncing for this article. Please refresh and try again.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(getApiUrl('/api/comments'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({
          post_id: resolvedPostId,
          content: newComment.content.trim(),
        }),
      });

      if (!response.ok) {
        const message = await extractErrorMessage(response, 'Failed to post comment.');
        setError(message);
        return;
      }

      setSuccess('Comment posted successfully.');
      setNewComment({ content: '' });
      await fetchComments();
    } catch (submitError) {
      console.error('Error posting comment:', submitError);
      setError('Failed to post comment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReply = async (parentId: string) => {
    if (!session?.access_token) {
      setError('You must be logged in to reply to comments.');
      return;
    }

    if (!replyContent.trim()) {
      setError('Please enter a reply.');
      return;
    }

    if (!resolvedPostId) {
      setError('Comments are still syncing for this article. Please refresh and try again.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(getApiUrl('/api/comments'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeader,
        },
        body: JSON.stringify({
          post_id: resolvedPostId,
          parent_id: parentId,
          content: replyContent.trim(),
        }),
      });

      if (!response.ok) {
        const message = await extractErrorMessage(response, 'Failed to post reply.');
        setError(message);
        return;
      }

      setSuccess('Reply posted successfully.');
      setReplyContent('');
      setReplyTo(null);
      await fetchComments();
    } catch (replyError) {
      console.error('Error posting reply:', replyError);
      setError('Failed to post reply. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLike = async (commentId: string) => {
    try {
      const response = await fetch(getApiUrl(`/api/comments/${encodeURIComponent(commentId)}/like`), {
        method: 'POST',
        headers: {
          ...authHeader,
        },
      });

      if (!response.ok) {
        const message = await extractErrorMessage(response, 'Failed to like comment.');
        setError(message);
        return;
      }

      await fetchComments();
    } catch (likeError) {
      console.error('Error liking comment:', likeError);
      setError('Failed to update comment like.');
    }
  };

  const renderComment = (comment: Comment, isReply = false) => (
    <div
      key={comment.id}
      className={`bg-white rounded-lg p-6 ${isReply ? 'ml-8 border-l-2 border-gray-200' : 'border border-gray-200'}`}
    >
      <div className="flex items-start gap-4">
        <Avatar className="h-10 w-10">
          <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${comment.author_name}`} />
          <AvatarFallback>
            {comment.author_name
              .split(' ')
              .filter(Boolean)
              .map((n) => n[0])
              .join('')}
          </AvatarFallback>
        </Avatar>

        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="font-semibold text-gray-900">{comment.author_name}</span>
            {comment.author_website && (
              <a
                href={comment.author_website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 hover:underline text-sm"
              >
                {comment.author_website.replace(/^https?:\/\//, '')}
              </a>
            )}
            <Badge variant="secondary" className="text-xs">
              {new Date(comment.created_at).toLocaleDateString()}
            </Badge>
          </div>

          <p className="text-gray-700 mb-4 leading-relaxed">{comment.content}</p>

          <div className="flex items-center gap-4">
            <button
              onClick={() => handleLike(comment.id)}
              className={`flex items-center gap-1 text-sm transition-colors ${
                comment.user_liked ? 'text-red-500' : 'text-gray-500 hover:text-red-500'
              }`}
            >
              <Heart className={`h-4 w-4 ${comment.user_liked ? 'fill-current' : ''}`} />
              {comment.like_count}
            </button>

            <button
              onClick={() => setReplyTo(comment.id)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 transition-colors"
            >
              <Reply className="h-4 w-4" />
              Reply
            </button>
          </div>

          {replyTo === comment.id && (
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <Textarea
                value={replyContent}
                onChange={(e) => setReplyContent(e.target.value)}
                placeholder="Write your reply..."
                className="mb-3"
                rows={3}
              />
              <div className="flex gap-2">
                <Button onClick={() => handleSubmitReply(comment.id)} disabled={isSubmitting} size="sm">
                  {isSubmitting ? 'Posting...' : 'Post Reply'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setReplyTo(null);
                    setReplyContent('');
                  }}
                  size="sm"
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {comment.replies.length > 0 && (
            <div className="mt-4 space-y-4">{comment.replies.map((reply) => renderComment(reply, true))}</div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="mt-12" data-post-slug={postSlug}>
      <div className="flex items-center gap-2 mb-8">
        <MessageCircle className="h-5 w-5 text-gray-600" />
        <h3 className="text-xl font-semibold text-gray-900">Comments ({comments.length})</h3>
      </div>

      {error && (
        <Alert className="mb-6 border-red-200 bg-red-50">
          <AlertCircle className="h-4 w-4 text-red-600" />
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="mb-6 border-green-200 bg-green-50">
          <AlertDescription className="text-green-800">{success}</AlertDescription>
        </Alert>
      )}

      <div className="bg-gray-50 rounded-lg p-6 mb-8">
        {loading ? (
          <div className="text-center py-8 text-gray-600">Checking your login status...</div>
        ) : isResolvingPostId ? (
          <div className="text-center py-8 text-gray-600">Preparing comments...</div>
        ) : user ? (
          <>
            <h4 className="font-semibold text-gray-900 mb-4">Leave a Comment</h4>
            <form onSubmit={handleSubmitComment} className="space-y-4">
              <div>
                <Textarea
                  id="comment"
                  value={newComment.content}
                  onChange={(e) => setNewComment({ content: e.target.value })}
                  placeholder="Share your thoughts..."
                  className="min-h-[100px]"
                  required
                />
              </div>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? 'Posting...' : 'Post Comment'}
              </Button>
            </form>
          </>
        ) : (
          <div className="text-center py-8">
            <User className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h4 className="text-lg font-semibold text-gray-900 mb-2">Join the Conversation</h4>
            <p className="text-gray-600 mb-4">You need to create an account or log in to post comments.</p>
            <div className="flex gap-3 justify-center">
              <Button onClick={() => navigate(`/login?action=signup&redirect=${encodedRedirect}`)}>
                <LogIn className="h-4 w-4 mr-2" />
                Create Account
              </Button>
              <Button variant="outline" onClick={() => navigate(`/login?redirect=${encodedRedirect}`)}>
                Log In
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-6">
        {isLoading ? (
          <div className="text-center py-10 text-gray-600">Loading comments...</div>
        ) : comments.length === 0 ? (
          <div className="text-center py-12">
            <MessageCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h4 className="text-lg font-semibold text-gray-900 mb-2">No Comments Yet</h4>
            <p className="text-gray-600">Be the first to share your thoughts on this post.</p>
          </div>
        ) : (
          comments.map((comment) => renderComment(comment))
        )}
      </div>
    </div>
  );
};

export default BlogComments;
