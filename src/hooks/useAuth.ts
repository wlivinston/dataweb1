import { useState, useEffect } from 'react'
import { User, Session } from '@supabase/supabase-js'
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
  company?: string
}

export const useAuth = () => {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    loading: isSupabaseConfigured
  })

  const missingConfigError = () =>
    new Error(supabaseConfigError ?? 'Supabase is not configured for this environment')

  useEffect(() => {
    if (!supabase) {
      setAuthState({
        user: null,
        session: null,
        loading: false
      })
      return
    }

    // Get initial session
    const getInitialSession = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        setAuthState({
          user: session?.user ?? null,
          session,
          loading: false
        })
      } catch (error) {
        console.error('Error loading auth session:', error)
        setAuthState({
          user: null,
          session: null,
          loading: false
        })
      }
    }

    getInitialSession()

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setAuthState({
          user: session?.user ?? null,
          session,
          loading: false
        })

        // Handle specific auth events
        if (event === 'SIGNED_IN' && session?.user) {
          // Create or update customer record
          await createOrUpdateCustomer(session.user)
        }
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  const createOrUpdateCustomer = async (user: User) => {
    if (!supabase) return

    try {
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('email', user.email)
        .single()

      if (!existingCustomer) {
        // Create new customer record
        const { error } = await supabase
          .from('customers')
          .insert({
            email: user.email!,
            first_name: user.user_metadata.first_name || '',
            last_name: user.user_metadata.last_name || '',
            company: user.user_metadata.company || null,
            subscription_status: 'free'
          })

        if (error) {
          console.error('Error creating customer:', error)
        }
      } else {
        // Update last login
        await supabase
          .from('customers')
          .update({ last_login: new Date().toISOString() })
          .eq('id', existingCustomer.id)
      }
    } catch (error) {
      console.error('Error handling customer data:', error)
    }
  }

  const signUp = async (data: SignUpData) => {
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
  }

  const signIn = async (email: string, password: string) => {
    if (!supabase) {
      return { data: null, error: missingConfigError() }
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })

      if (error) throw error

      return { data, error: null }
    } catch (error) {
      console.error('Sign in error:', error)
      return { data: null, error }
    }
  }

  const signOut = async () => {
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
  }

  const resetPassword = async (email: string) => {
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
  }

  const updatePassword = async (password: string) => {
    if (!supabase) {
      return { error: missingConfigError() }
    }

    try {
      const { error } = await supabase.auth.updateUser({
        password
      })

      if (error) throw error

      return { error: null }
    } catch (error) {
      console.error('Password update error:', error)
      return { error }
    }
  }

  const updateProfile = async (updates: {
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

      // Also update customer record
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
  }

  return {
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
  }
}
