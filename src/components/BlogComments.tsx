import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { MessageCircle, Reply, Heart, User, LogIn, AlertCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { isSupabaseConfigured, supabase, supabaseConfigError } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';

interface Comment {
  id: number;
  post_id: number;
  parent_id?: number;
  author_name: string;
  author_email: string;
  author_website?: string;
  content: string;
  is_approved: boolean;
  created_at: string;
  replies?: Comment[];
  like_count: number;
  user_liked: boolean;
}

interface BlogCommentsProps {
  postId: number;
  postSlug: string;
}

const BlogComments: React.FC<BlogCommentsProps> = ({ postId, postSlug }) => {
  const [comments, setComments] = useState<Comment[]>([]);
  const [newComment, setNewComment] = useState({
    content: ''
  });
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyContent, setReplyContent] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const { user } = useAuth();

  useEffect(() => {
    if (!supabase) {
      setComments([]);
      return;
    }

    fetchComments();
  }, [postId]);

  const fetchComments = async () => {
    if (!supabase) return;

    try {
      const { data, error } = await supabase
        .from('blog_comments')
        .select('*')
        .eq('post_id', postId)
        .eq('is_approved', true)
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching comments:', error);
        return;
      }

      // Organize comments into parent-child structure
      const commentMap = new Map();
      const topLevelComments: Comment[] = [];

      data.forEach((comment: any) => {
        comment.replies = [];
        comment.like_count = 0; // You can implement like counting later
        comment.user_liked = false; // You can implement user like tracking later
        commentMap.set(comment.id, comment);
      });

      data.forEach((comment: any) => {
        if (comment.parent_id) {
          const parent = commentMap.get(comment.parent_id);
          if (parent) {
            parent.replies.push(comment);
          }
        } else {
          topLevelComments.push(comment);
        }
      });

      setComments(topLevelComments);
    } catch (error) {
      console.error('Error fetching comments:', error);
    }
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!supabase) {
      setError(supabaseConfigError ?? 'Comments are unavailable right now.');
      return;
    }

    if (!user) {
      setError('You must be logged in to post comments. Please create an account or log in.');
      return;
    }

    if (!newComment.content.trim()) {
      setError('Please enter a comment');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('blog_comments')
        .insert({
          post_id: postId,
          author_name: `${user.user_metadata.first_name} ${user.user_metadata.last_name}`,
          author_email: user.email!,
          content: newComment.content.trim(),
          is_approved: true // Auto-approve authenticated users
        });

      if (error) {
        setError('Failed to post comment');
        return;
      }

      setSuccess('Comment posted successfully!');
      setNewComment({ content: '' });

      // Refresh comments
      await fetchComments();
    } catch (error) {
      console.error('Error posting comment:', error);
      setError('Failed to post comment. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitReply = async (parentId: number) => {
    if (!supabase) {
      setError(supabaseConfigError ?? 'Comments are unavailable right now.');
      return;
    }

    if (!user) {
      setError('You must be logged in to reply to comments.');
      return;
    }

    if (!replyContent.trim()) {
      setError('Please enter a reply');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('blog_comments')
        .insert({
          post_id: postId,
          parent_id: parentId,
          author_name: `${user.user_metadata.first_name} ${user.user_metadata.last_name}`,
          author_email: user.email!,
          content: replyContent.trim(),
          is_approved: true // Auto-approve authenticated users
        });

      if (error) {
        setError('Failed to post reply');
        return;
      }

      setSuccess('Reply posted successfully!');
      setReplyContent('');
      setReplyTo(null);

      // Refresh comments
      await fetchComments();
    } catch (error) {
      console.error('Error posting reply:', error);
      setError('Failed to post reply. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLike = async (commentId: number) => {
    try {
      // For now, just refresh comments
      // You can implement like functionality later with a separate likes table
      await fetchComments();
    } catch (error) {
      console.error('Error liking comment:', error);
    }
  };

  const renderComment = (comment: Comment, isReply = false) => (
    <div key={comment.id} className={`bg-white rounded-lg p-6 ${isReply ? 'ml-8 border-l-2 border-gray-200' : 'border border-gray-200'}`}>
      <div className="flex items-start gap-4">
        <Avatar className="h-10 w-10">
          <AvatarImage src={`https://api.dicebear.com/7.x/initials/svg?seed=${comment.author_name}`} />
          <AvatarFallback>{comment.author_name.split(' ').map(n => n[0]).join('')}</AvatarFallback>
        </Avatar>
        
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
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

          {/* Reply Form */}
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
                <Button
                  onClick={() => handleSubmitReply(comment.id)}
                  disabled={isSubmitting}
                  size="sm"
                >
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

          {/* Replies */}
          {comment.replies && comment.replies.length > 0 && (
            <div className="mt-4 space-y-4">
              {comment.replies.map(reply => renderComment(reply, true))}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="mt-12">
      <div className="flex items-center gap-2 mb-8">
        <MessageCircle className="h-5 w-5 text-gray-600" />
        <h3 className="text-xl font-semibold text-gray-900">
          Comments ({comments.length})
        </h3>
      </div>

      {/* Error/Success Messages */}
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

      {!isSupabaseConfigured && (
        <Alert className="mb-6 border-amber-200 bg-amber-50">
          <AlertCircle className="h-4 w-4 text-amber-700" />
          <AlertDescription className="text-amber-900">
            {supabaseConfigError}. Commenting is disabled until Supabase is configured.
          </AlertDescription>
        </Alert>
      )}

                        {/* Comment Form */}
                  <div className="bg-gray-50 rounded-lg p-6 mb-8">
                    {!isSupabaseConfigured ? (
                      <div className="text-center py-4 text-sm text-gray-700">
                        Comments are currently unavailable.
                      </div>
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
            <p className="text-gray-600 mb-4">
              You need to create an account or log in to post comments.
            </p>
                                    <div className="flex gap-3 justify-center">
                          <Button onClick={() => window.location.href = '/login'}>
                            <LogIn className="h-4 w-4 mr-2" />
                            Create Account
                          </Button>
                          <Button variant="outline" onClick={() => window.location.href = '/login'}>
                            Log In
                          </Button>
                        </div>
          </div>
        )}
      </div>

      {/* Comments List */}
      <div className="space-y-6">
        {comments.length === 0 ? (
          <div className="text-center py-12">
            <MessageCircle className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h4 className="text-lg font-semibold text-gray-900 mb-2">No Comments Yet</h4>
            <p className="text-gray-600">
              Be the first to share your thoughts on this post!
            </p>
          </div>
        ) : (
          comments.map(comment => renderComment(comment))
        )}
      </div>
    </div>
  );
};

export default BlogComments;
