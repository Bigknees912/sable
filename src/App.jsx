import { useEffect, useState } from 'react'
import { supabase } from './lib/supabaseClient'
import { fetchProfile, signOut } from './lib/auth'
import LoginScreen from './auth/LoginScreen'
import SignupScreen from './auth/SignupScreen'
import CheckEmailScreen from './auth/CheckEmailScreen'
import ForgotPasswordScreen from './auth/ForgotPasswordScreen'
import ResetPasswordScreen from './auth/ResetPasswordScreen'
import RoleChoiceScreen from './auth/RoleChoiceScreen'
import PlanSelectionScreen from './auth/PlanSelectionScreen'
import OwnerOnboardingScreen from './auth/OwnerOnboardingScreen'
import EmployeeJoinScreen from './auth/EmployeeJoinScreen'
import { AuthShell, LIGHT } from './auth/ui'
import { ErrorState, ErrorBanner, LoadingState } from './dashboard/ui'
import AppShell from './dashboard/AppShell'

// State machine (see AUTH.md "Frontend implementation" for the reasoning):
//   session === undefined         -> still checking for an existing session
//   sessionError set              -> that check failed outright (network, etc.)
//   session === null              -> signed out: render pre-auth screens
//   session set, profile undefined, no profileError -> fetching the profile row
//   profileError set              -> the fetch itself failed - NOT the same as
//                                     "confirmed no profile", so this must not
//                                     fall through to the signup flow
//   session set, profile null      -> authenticated but no company yet:
//                                      render post-auth setup screens
//   session set, profile set       -> fully signed in
export default function App() {
  const [session, setSession] = useState(undefined)
  const [sessionError, setSessionError] = useState('')
  const [profile, setProfile] = useState(undefined)
  const [profileError, setProfileError] = useState('')
  const [refreshError, setRefreshError] = useState('')
  const [preAuthScreen, setPreAuthScreen] = useState('login') // login | signup | check-email | forgot-password
  const [pendingEmail, setPendingEmail] = useState('')
  const [postAuthScreen, setPostAuthScreen] = useState('role-choice') // role-choice | plan-selection | owner-onboarding | employee-join
  const [selectedPlan, setSelectedPlan] = useState('starter')
  const [passwordRecovery, setPasswordRecovery] = useState(false)

  // getSession() alone only reads whatever's in this browser's local
  // storage - it does not by itself prove the token is still valid on the
  // server. That distinction matters here specifically: a valid,
  // *current* session is the whole security boundary between one user's
  // dashboard and anyone else who might have this URL (there's no
  // per-user path or query param - the URL is identical for every user).
  // So on every load we don't just trust a locally-cached session object;
  // we call getUser(), which round-trips to Supabase and verifies the
  // access token against the server. If that fails - expired, revoked, or
  // simply absent, e.g. someone else opening a copied dashboard URL with no
  // session of their own - we treat it exactly like being signed out.
  function loadSession() {
    setSessionError('')
    supabase.auth.getSession()
      .then(async ({ data }) => {
        if (!data.session) {
          setSession(null)
          return
        }
        const { data: userData, error: userError } = await supabase.auth.getUser()
        if (userError || !userData.user) {
          setSession(null)
          return
        }
        setSession(data.session)
      })
      .catch((err) => setSessionError(err.message || String(err)))
  }

  useEffect(() => {
    loadSession()
    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      // Only reset the post-auth wizard on a genuine new sign-in - this
      // fires on every event, including a silent background
      // TOKEN_REFRESHED (Supabase access tokens are short-lived, ~1hr),
      // which would otherwise wipe out a partway-through-onboarding
      // owner's progress and bounce them back to "role choice" for no
      // visible reason.
      if (event === 'SIGNED_IN') {
        setPostAuthScreen('role-choice')
        setSelectedPlan('starter')
      }
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true)
      if (!newSession) setPreAuthScreen('login')
    })
    return () => listener.subscription.unsubscribe()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function loadProfile() {
    if (!session) return
    setProfileError('')
    setProfile(undefined)
    fetchProfile(session.user.id)
      .then(setProfile)
      .catch((err) => setProfileError(err.message || String(err)))
  }

  useEffect(() => {
    if (session === undefined) return
    if (!session) {
      setProfile(null)
      return
    }
    loadProfile()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  function refreshProfile() {
    if (!session) return
    setRefreshError('')
    fetchProfile(session.user.id)
      .then(setProfile)
      .catch((err) => setRefreshError(err.message || String(err)))
  }

  if (sessionError) {
    return (
      <AuthShell>
        <ErrorState message={`Couldn't check your session: ${sessionError}`} onRetry={loadSession} />
      </AuthShell>
    )
  }

  // Takes over the whole screen the moment a recovery-link click fires
  // PASSWORD_RECOVERY, ahead of the normal session/profile flow below -
  // that flow would otherwise start loading this user's profile using the
  // recovery session before they've actually set a new password.
  if (passwordRecovery) {
    return <ResetPasswordScreen onDone={() => setPasswordRecovery(false)} />
  }

  if (session === undefined || (session && profile === undefined && !profileError)) {
    return <LoadingScreen />
  }

  if (session && profileError) {
    return (
      <AuthShell>
        <ErrorState message={`Couldn't load your account: ${profileError}`} onRetry={loadProfile} />
      </AuthShell>
    )
  }

  if (!session) {
    if (preAuthScreen === 'signup') {
      return (
        <SignupScreen
          onBack={() => setPreAuthScreen('login')}
          onNeedsConfirmation={(email) => {
            setPendingEmail(email)
            setPreAuthScreen('check-email')
          }}
        />
      )
    }
    if (preAuthScreen === 'check-email') {
      return <CheckEmailScreen email={pendingEmail} onBack={() => setPreAuthScreen('login')} />
    }
    if (preAuthScreen === 'forgot-password') {
      return <ForgotPasswordScreen onBack={() => setPreAuthScreen('login')} />
    }
    return <LoginScreen onSignup={() => setPreAuthScreen('signup')} onForgotPassword={() => setPreAuthScreen('forgot-password')} />
  }

  if (!profile) {
    let screen
    if (postAuthScreen === 'plan-selection') {
      screen = (
        <PlanSelectionScreen
          onBack={() => setPostAuthScreen('role-choice')}
          onContinue={(plan) => {
            setSelectedPlan(plan)
            setPostAuthScreen('owner-onboarding')
          }}
        />
      )
    } else if (postAuthScreen === 'owner-onboarding') {
      screen = <OwnerOnboardingScreen plan={selectedPlan} onBack={() => setPostAuthScreen('plan-selection')} onDone={refreshProfile} />
    } else if (postAuthScreen === 'employee-join') {
      screen = <EmployeeJoinScreen onBack={() => setPostAuthScreen('role-choice')} onDone={refreshProfile} />
    } else {
      screen = (
        <RoleChoiceScreen
          userEmail={session.user.email}
          onPickOwner={() => setPostAuthScreen('plan-selection')}
          onPickEmployee={() => setPostAuthScreen('employee-join')}
        />
      )
    }
    return (
      <>
        {refreshError && (
          <div style={{ position: 'fixed', top: 12, left: 12, right: 12, zIndex: 100, maxWidth: 380, margin: '0 auto' }}>
            <ErrorBanner
              message={`That worked, but couldn't finish signing you in: ${refreshError}`}
              onRetry={refreshProfile}
              onDismiss={() => setRefreshError('')}
            />
          </div>
        )}
        {screen}
      </>
    )
  }

  if (profile.companies?.status === 'suspended' || profile.companies?.status === 'cancelled') {
    return <SuspendedScreen onSignOut={signOut} />
  }

  return <AppShell session={session} profile={profile} onSignOut={signOut} />
}

// Shown instead of the dashboard when the platform operator has suspended
// or cancelled this company from the super-admin panel. Data isn't
// deleted - current_company_id() (migration 037) just stops resolving for
// this company's users, so every RLS-scoped query returns nothing; this
// screen exists purely so that shows up as a clear message instead of a
// confusing empty dashboard.
function SuspendedScreen({ onSignOut }) {
  return (
    <AuthShell>
      <div style={{ paddingTop: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: LIGHT.ink, marginBottom: 10 }}>Account access paused</div>
        <div style={{ fontSize: 13.5, color: LIGHT.sub, marginBottom: 24, lineHeight: 1.5 }}>
          Your workspace's access has been paused by Sable support. Your data is safe and nothing has been
          deleted - reach out to support to get this resolved.
        </div>
        <button
          className="tap"
          onClick={onSignOut}
          style={{ background: LIGHT.ink, color: '#fff', border: 'none', borderRadius: 10, padding: '11px 22px', fontSize: 14, fontWeight: 600 }}
        >
          Sign Out
        </button>
      </div>
    </AuthShell>
  )
}

function LoadingScreen() {
  return (
    <AuthShell>
      <div style={{ paddingTop: 60 }}>
        <LoadingState />
      </div>
    </AuthShell>
  )
}
