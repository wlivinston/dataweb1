import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { isSupabaseConfigured, supabase, supabaseConfigError } from '@/lib/supabase';
import { getApiUrl } from '@/lib/publicConfig';
import { saveFallbackAuth } from '@/lib/fallbackAuth';
import { LogIn, Mail, Lock, AlertCircle, User, MapPin, UserPlus } from 'lucide-react';
import SeoMeta from '@/components/SeoMeta';

type AuthMode = 'signin' | 'signup';

const Login: React.FC = () => {
  const [authMode, setAuthMode] = useState<AuthMode>(() => {
    const search = new URLSearchParams(window.location.search);
    return search.get('action') === 'signup' ? 'signup' : 'signin';
  });
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [age, setAge] = useState('');
  const [registrationCountry, setRegistrationCountry] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const navigate = useNavigate();
  const redirectTarget = useMemo(() => {
    const search = new URLSearchParams(window.location.search);
    const redirect = search.get('redirect') || '/';
    return redirect.startsWith('/') ? redirect : '/';
  }, []);

  const normalizeAuthError = (value: string) => {
    if (value === 'AUTH_TIMEOUT') {
      return 'Authentication timed out. Please check connectivity and try again.';
    }
    if (/anonymous sign-ins are disabled/i.test(value)) {
      return 'Please enter a valid email and password before continuing.';
    }
    if (/invalid login credentials/i.test(value)) {
      return 'Invalid email or password.';
    }
    return value;
  };

  const withTimeout = async <T,>(operation: Promise<T>, timeoutMs = 15000): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('AUTH_TIMEOUT')), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const signInViaBackendFallback = async (currentEmail: string, currentPassword: string) => {
    const response = await withTimeout(
      fetch(getApiUrl('/api/auth/supabase/sign-in'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: currentEmail,
          password: currentPassword,
        }),
      }),
      15000
    );

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const fallbackError = typeof payload?.error === 'string' ? payload.error : 'Sign-in failed';
      throw new Error(fallbackError);
    }

    const accessToken = typeof payload?.access_token === 'string' ? payload.access_token : '';
    const refreshToken = typeof payload?.refresh_token === 'string' ? payload.refresh_token : '';
    if (!accessToken || !refreshToken) {
      throw new Error('Missing session tokens from authentication fallback');
    }

    try {
      const { error } = await withTimeout(
        supabase!.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        }),
        8000
      );

      if (!error) return;
    } catch {
      // Direct browser-to-Supabase auth path is unreliable in this environment.
      // Fall through to local fallback token persistence below.
    }

    saveFallbackAuth({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: typeof payload?.token_type === 'string' ? payload.token_type : 'bearer',
      expires_at: typeof payload?.expires_at === 'number' ? payload.expires_at : undefined,
      expires_in: typeof payload?.expires_in === 'number' ? payload.expires_in : undefined,
      user: payload?.user && typeof payload.user === 'object' ? payload.user : null,
    });
  };

  const validateCredentials = (
    currentEmail: string,
    currentPassword: string,
    mode: AuthMode
  ) => {
    const trimmedEmail = currentEmail.trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!trimmedEmail) {
      return 'Email is required.';
    }

    if (!emailPattern.test(trimmedEmail)) {
      return 'Please enter a valid email address.';
    }

    if (!currentPassword) {
      return 'Password is required.';
    }

    if (mode === 'signup' && currentPassword.length < 6) {
      return 'Password must be at least 6 characters long.';
    }

    if (mode === 'signup') {
      if (firstName.trim().length < 2) {
        return 'First name must be at least 2 characters.';
      }

      if (lastName.trim().length < 2) {
        return 'Last name must be at least 2 characters.';
      }

      const parsedAge = Number(age);
      if (!Number.isInteger(parsedAge) || parsedAge < 13 || parsedAge > 120) {
        return 'Age must be a whole number between 13 and 120.';
      }

      if (!registrationCountry.trim()) {
        return 'Please provide where you are registering from.';
      }
    }

    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    if (!supabase) {
      setError(supabaseConfigError ?? 'Authentication is currently unavailable.');
      setLoading(false);
      return;
    }

    const validationError = validateCredentials(email, password, authMode);
    if (validationError) {
      setError(validationError);
      setLoading(false);
      return;
    }

    const trimmedEmail = email.trim();

    try {
      if (authMode === 'signin') {
        const authResult = await withTimeout(
          supabase.auth.signInWithPassword({
            email: trimmedEmail,
            password,
          })
        );

        if (authResult.error) {
          setError(normalizeAuthError(authResult.error.message));
          return;
        }
      } else {
        const authResult = await withTimeout(
          supabase.auth.signUp({
            email: trimmedEmail,
            password,
            options: {
              data: {
                first_name: firstName.trim(),
                last_name: lastName.trim(),
                age: Number(age),
                registration_country: registrationCountry.trim(),
              },
            },
          })
        );

        if (authResult.error) {
          setError(normalizeAuthError(authResult.error.message));
          return;
        }
      }

      if (authMode === 'signin') {
        setMessage('Login successful! Redirecting...');
        setTimeout(() => {
          navigate(redirectTarget);
        }, 1000);
      } else {
        setMessage('Account created. Check your email for the confirmation link.');
        setAuthMode('signin');
      }
    } catch (caughtError) {
      const errorMessage =
        caughtError instanceof Error ? caughtError.message : 'An unexpected error occurred';

      if (errorMessage === 'AUTH_TIMEOUT' && authMode === 'signin') {
        try {
          await signInViaBackendFallback(trimmedEmail, password);
          setMessage('Login successful! Redirecting...');
          setTimeout(() => {
            navigate(redirectTarget);
          }, 1000);
          return;
        } catch (fallbackError) {
          const fallbackMessage =
            fallbackError instanceof Error ? fallbackError.message : 'Authentication fallback failed';
          setError(normalizeAuthError(fallbackMessage));
          return;
        }
      }

      if (errorMessage === 'AUTH_TIMEOUT') {
        setError('Sign-in timed out. Please check your network or Supabase settings and try again.');
      } else if (/fetch|network|failed to fetch/i.test(errorMessage)) {
        setError('Unable to reach authentication service. Please try again shortly.');
      } else {
        setError(normalizeAuthError(errorMessage));
      }
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (nextMode: AuthMode) => {
    setAuthMode(nextMode);
    setError(null);
    setMessage(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <SeoMeta
        title={authMode === 'signin' ? 'Sign In | DataAfrik' : 'Create Account | DataAfrik'}
        description="Sign in or create a DataAfrik account."
        path="/login"
        noindex
      />
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome to DataAfrik</CardTitle>
          <CardDescription>
            {authMode === 'signin'
              ? 'Sign in to your account'
              : 'Create your account with profile details'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-2 mb-4">
            <Button
              type="button"
              variant={authMode === 'signin' ? 'default' : 'outline'}
              onClick={() => switchMode('signin')}
              disabled={loading}
            >
              Sign In
            </Button>
            <Button
              type="button"
              variant={authMode === 'signup' ? 'default' : 'outline'}
              onClick={() => switchMode('signup')}
              disabled={loading}
            >
              Create Account
            </Button>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {!isSupabaseConfigured && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertCircle className="h-4 w-4 text-amber-700" />
                <AlertDescription className="text-amber-900">
                  {supabaseConfigError}
                </AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="email"
                  type="email"
                  placeholder="Enter your email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                <Input
                  id="password"
                  type="password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10"
                  required
                />
              </div>
            </div>

            {authMode === 'signup' && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        id="firstName"
                        type="text"
                        placeholder="First name"
                        value={firstName}
                        onChange={(e) => setFirstName(e.target.value)}
                        className="pl-10"
                        required={authMode === 'signup'}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                      <Input
                        id="lastName"
                        type="text"
                        placeholder="Last name"
                        value={lastName}
                        onChange={(e) => setLastName(e.target.value)}
                        className="pl-10"
                        required={authMode === 'signup'}
                      />
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="age">Age</Label>
                  <Input
                    id="age"
                    type="number"
                    min={13}
                    max={120}
                    step={1}
                    placeholder="Enter your age"
                    value={age}
                    onChange={(e) => setAge(e.target.value)}
                    required={authMode === 'signup'}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="registrationCountry">Where Are You Registering From?</Label>
                  <div className="relative">
                    <MapPin className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                    <Input
                      id="registrationCountry"
                      type="text"
                      placeholder="Country or location"
                      value={registrationCountry}
                      onChange={(e) => setRegistrationCountry(e.target.value)}
                      className="pl-10"
                      required={authMode === 'signup'}
                    />
                  </div>
                </div>
              </>
            )}

            {error && (
              <Alert className="border-red-200 bg-red-50">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-red-800">{error}</AlertDescription>
              </Alert>
            )}

            {message && (
              <Alert className="border-green-200 bg-green-50">
                <AlertDescription className="text-green-800">{message}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Button
                type="submit"
                disabled={loading || !isSupabaseConfigured}
                className="w-full"
              >
                {authMode === 'signin' ? (
                  <LogIn className="h-4 w-4 mr-2" />
                ) : (
                  <UserPlus className="h-4 w-4 mr-2" />
                )}
                {loading
                  ? authMode === 'signin'
                    ? 'Signing in...'
                    : 'Creating account...'
                  : authMode === 'signin'
                  ? 'Sign In'
                  : 'Create Account'}
              </Button>
            </div>

            <div className="text-center space-y-2">
              {authMode === 'signin' ? (
                <>
                  <a href="/login?action=forgot-password" className="text-sm text-blue-600 hover:underline block">
                    Forgot your password?
                  </a>
                  <button
                    type="button"
                    className="text-sm text-blue-600 hover:underline block w-full"
                    onClick={() => switchMode('signup')}
                  >
                    Don't have an account? Sign up
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="text-sm text-blue-600 hover:underline block w-full"
                  onClick={() => switchMode('signin')}
                >
                  Already have an account? Sign in
                </button>
              )}
            </div>
          </form>

          <div className="mt-6 text-center text-sm text-gray-600">
            <p>
              By signing in, you agree to our{' '}
              <a href="#" className="text-blue-600 hover:underline">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="#" className="text-blue-600 hover:underline">
                Privacy Policy
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
