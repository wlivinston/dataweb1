import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase, supabaseConfigError } from '@/lib/supabase'

interface AuthState {
  user: User | null
  session: Session | null
  loading: boolean
}

interface SignUpData {
  email: string
  password: string
  first_name: string
  last_name: string
  age?: number
  registration_country?: string
  company?: string
}

interface AuthContextValue extends AuthState {
  isConfigured: boolean
  configError: string | null
  signUp: (data: SignUpData) => Promise<{ data: unknown; error: unknown }>
  signIn: (email: string, password: string) => Promise<{ data: unknown; error: unknown }>
  signOut: () => Promise<{ error: unknown }>
  resetPassword: (email: string) => Promise<{ error: unknown }>
  updatePassword: (password: string) => Promise<{ error: unknown }>
  updateProfile: (updates: { first_name?: string; last_name?: string; company?: string }) => Promise<{ data: unknown; error: unknown }>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

const missingConfigError = () =>
  new Error(supabaseConfigError ?? 'Supabase is not configured for this environment')

const createOrUpdateCustomer = async (user: User) => {
  if (!supabase) return

  try {
    const metadata = user.user_metadata || {}
    const metadataFirstName = typeof metadata.first_name === 'string' ? metadata.first_name.trim() : ''
    const metadataLastName = typeof metadata.last_name === 'string' ? metadata.last_name.trim() : ''
    const metadataCompany = typeof metadata.company === 'string' ? metadata.company.trim() : ''
    const metadataCountry =
      typeof metadata.registration_country === 'string' ? metadata.registration_country.trim() : ''

    const parsedAge = Number(metadata.age)
    const metadataAge =
      Number.isInteger(parsedAge) && parsedAge >= 13 && parsedAge <= 120 ? parsedAge : null

    const { data: existingCustomer } = await supabase
      .from('customers')
      .select('id')
      .eq('email', user.email)
      .maybeSingle()

    if (!existingCustomer) {
      const { error } = await supabase
        .from('customers')
        .insert({
          email: user.email!,
          first_name: metadataFirstName,
          last_name: metadataLastName,
          company: metadataCompany || null,
          age: metadataAge,
          registration_country: metadataCountry || null,
          subscription_status: 'free'
        })

      if (error) {
        console.error('Error creating customer:', error)
      }
      return
    }

    const updates: {
      last_login: string
      first_name?: string
      last_name?: string
      company?: string | null
      age?: number | null
      registration_country?: string | null
    } = {
      last_login: new Date().toISOString()
    }

    if (metadataFirstName) updates.first_name = metadataFirstName
    if (metadataLastName) updates.last_name = metadataLastName
    if (metadataCompany) updates.company = metadataCompany
    if (metadataCountry) updates.registration_country = metadataCountry
    if (metadataAge !== null) updates.age = metadataAge

    await supabase
      .from('customers')
      .update(updates)
      .eq('id', existingCustomer.id)
  } catch (error) {
    console.error('Error handling customer data:', error)
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    loading: isSupabaseConfigured
  })

  useEffect(() => {
    if (!supabase) {
      setAuthState({
        user: null,
        session: null,
        loading: false
      })
      return
    }

    let isMounted = true
    const forceStopLoadingTimer = window.setTimeout(() => {
      if (!isMounted) return
      setAuthState((prev) => (prev.loading ? { ...prev, loading: false } : prev))
    }, 7000)

    const getInitialSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (!isMounted) return

        setAuthState({
          user: session?.user ?? null,
          session,
          loading: false
        })
      } catch (error) {
        console.error('Error loading auth session:', error)
        if (!isMounted) return
        setAuthState({
          user: null,
          session: null,
          loading: false
        })
      }
    }

    getInitialSession()

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!isMounted) return

        setAuthState({
          user: session?.user ?? null,
          session,
          loading: false
        })

        if (event === 'SIGNED_IN' && session?.user) {
          await createOrUpdateCustomer(session.user)
        }
      }
    )

    return () => {
      isMounted = false
      window.clearTimeout(forceStopLoadingTimer)
      subscription.unsubscribe()
    }
  }, [])

  const signUp = useCallback(async (data: SignUpData) => {
    if (!supabase) {
      return { data: null, error: missingConfigError() }
    }

    try {
      const { data: authData, error } = await supabase.auth.signUp({
        email: data.email,
        password: data.password,
        options: {
          data: {
            first_name: data.first_name,
            last_name: data.last_name,
            age: data.age,
            registration_country: data.registration_country,
            company: data.company
          }
        }
      })

      if (error) throw error
      return { data: authData, error: null }
    } catch (error) {
      console.error('Sign up error:', error)
      return { data: null, error }
    }
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    if (!supabase) {
      return { data: null, error: missingConfigError() }
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      return { data, error: null }
    } catch (error) {
      console.error('Sign in error:', error)
      return { data: null, error }
    }
  }, [])

  const signOut = useCallback(async () => {
    if (!supabase) {
      return { error: missingConfigError() }
    }

    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      return { error: null }
    } catch (error) {
      console.error('Sign out error:', error)
      return { error }
    }
  }, [])

  const resetPassword = useCallback(async (email: string) => {
    if (!supabase) {
      return { error: missingConfigError() }
    }

    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`
      })

      if (error) throw error
      return { error: null }
    } catch (error) {
      console.error('Password reset error:', error)
      return { error }
    }
  }, [])

  const updatePassword = useCallback(async (password: string) => {
    if (!supabase) {
      return { error: missingConfigError() }
    }

    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      return { error: null }
    } catch (error) {
      console.error('Password update error:', error)
      return { error }
    }
  }, [])

  const updateProfile = useCallback(async (updates: {
    first_name?: string
    last_name?: string
    company?: string
  }) => {
    if (!supabase) {
      return { data: null, error: missingConfigError() }
    }

    try {
      const { data, error } = await supabase.auth.updateUser({
        data: updates
      })

      if (error) throw error

      if (authState.user) {
        await supabase
          .from('customers')
          .update({
            first_name: updates.first_name,
            last_name: updates.last_name,
            company: updates.company,
            updated_at: new Date().toISOString()
          })
          .eq('email', authState.user.email)
      }

      return { data, error: null }
    } catch (error) {
      console.error('Profile update error:', error)
      return { data: null, error }
    }
  }, [authState.user])

  const value = useMemo<AuthContextValue>(() => ({
    user: authState.user,
    session: authState.session,
    loading: authState.loading,
    isConfigured: isSupabaseConfigured,
    configError: supabaseConfigError,
    signUp,
    signIn,
    signOut,
    resetPassword,
    updatePassword,
    updateProfile
  }), [authState, signIn, signOut, signUp, resetPassword, updatePassword, updateProfile])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return context
}
