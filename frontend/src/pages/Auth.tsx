import { useState, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { clearPersistedSession, apiClient } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { ACTIVE_STAFF_SESSION_KEY } from '@/lib/hotelAccess';
import { resolveRoleLandingRoute } from '@/lib/hotelAccess';
import { AlertCircle, Bot, Cpu, Zap, ShieldCheck, ArrowRight, Lock } from 'lucide-react';

const SPECIAL_HOTEL_LOGIN_KEY = 'hotel.specialManagerAuth';
const SPECIAL_WAITER_LOGIN_KEY = 'hotel.specialWaiterAuth';
const SPECIAL_SYSTEM_LOGIN_KEY = 'hotel.specialSystemAuth';
const SPECIAL_HOTEL_EMAIL = 'admin@admin.com';
const SPECIAL_HOTEL_PASSWORD = '123456';

const SPECIAL_SYSTEM_EMAIL = 'admin@system.com';
const SPECIAL_SYSTEM_PASSWORD = 'admin123';

const SPECIAL_WAITER_ADMIN_EMAIL = 'waiter@admin.com';
const SPECIAL_WAITER_ADMIN_PASSWORD = 'waiter123';

// Valid UUID v4 for special accounts so API calls don't fail with invalid UUID errors
const SPECIAL_MANAGER_UUID = 'a0000000-0000-4000-8000-000000000001';
const SPECIAL_WAITER_ADMIN_UUID = 'a0000000-0000-4000-8000-000000000002';
const SPECIAL_SYSTEM_UUID = 'a0000000-0000-4000-8000-000000000003';

const C = {
  gold: '#D4AF37',
  goldDark: '#B8860B',
  goldGlow: 'rgba(212,175,55,0.35)',
  goldBorder: 'rgba(212,175,55,0.28)',
  goldFill: 'rgba(212,175,55,0.08)',
  blue: '#378ADD',
  blueDark: '#185FA5',
  blueGlow: 'rgba(55,138,221,0.20)',
  blueBorder: 'rgba(55,138,221,0.28)',
  blueFill: 'rgba(55,138,221,0.08)',
  inputBg: 'rgba(0,0,0,0.35)',
  cardBg: 'rgba(255,255,255,0.04)',
  textMuted: '#8BA0B8',
  textHint: '#5A6E85',
  textLabel: '#8B7340',
  error: '#E24B4A',
  errorBg: 'rgba(226,75,74,0.10)',
  errorBorder: 'rgba(226,75,74,0.25)',
};

export default function Auth() {
  const { user, loading: authLoading, landingPage, userRole, userRoles, refreshAuthState } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [showHotelAccessHint, setShowHotelAccessHint] = useState(false);
  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  // Upsert special staff accounts on app load to ensure they exist in DB
  useEffect(() => {
    const ensureSpecialAccounts = async () => {
      try {
        const specialAccounts = [
          {
            id: SPECIAL_MANAGER_UUID,
            first_name: 'Restaurant',
            last_name: 'Manager',
            email: SPECIAL_HOTEL_EMAIL,
            role: 'manager',
            pin: '1234',
            is_active: true,
            allowed_hotel_routes: []
          },
          {
            id: SPECIAL_WAITER_ADMIN_UUID,
            first_name: 'Waiter',
            last_name: 'Admin',
            email: SPECIAL_WAITER_ADMIN_EMAIL,
            role: 'waiter_admin',
            pin: '1235',
            is_active: true,
            allowed_hotel_routes: []
          },
          {
            id: SPECIAL_SYSTEM_UUID,
            first_name: 'System',
            last_name: 'Administrator',
            email: SPECIAL_SYSTEM_EMAIL,
            role: 'admin',
            pin: '1236',
            is_active: true,
            allowed_hotel_routes: []
          }
        ];

        await Promise.all(
          specialAccounts.map(account =>
            apiClient.from('hotel_staff').upsert(account, { onConflict: 'id' })
          )
        );

        console.log('[Auth] Special accounts upserted successfully');
      } catch (error) {
        console.error('[Auth] Failed to upsert special accounts:', error);
      }
    };

    ensureSpecialAccounts();
  }, []);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center" style={{ background: 'linear-gradient(135deg,#0a1628 0%,#0d1f3c 50%,#1a1200 100%)' }}>
        <div className="h-12 w-12 animate-spin rounded-full border-4" style={{ borderColor: C.gold, borderTopColor: 'transparent' }} />
      </div>
    );
  }

  if (user && (landingPage || userRole || (Array.isArray(userRoles) && userRoles.length > 0))) {
    const destination = landingPage || resolveRoleLandingRoute(userRole || userRoles[0] || null);
    return <Navigate to={destination} replace />;
  }

  const getSpecialAccountUuid = (role: string): string => {
    if (role === 'manager') return SPECIAL_MANAGER_UUID;
    if (role === 'waiter_admin') return SPECIAL_WAITER_ADMIN_UUID;
    if (role === 'admin') return SPECIAL_SYSTEM_UUID;
    return crypto.randomUUID();
  };

  const provisionSpecialAccount = async (
    role: string,
    firstName: string,
    lastName: string
  ): Promise<void> => {
    const validUuid = getSpecialAccountUuid(role);

    // Upsert special staff in DB first to ensure the record exists
    try {
      const { error: upsertError } = await apiClient
        .from('hotel_staff')
        .upsert({
          id: validUuid,
          first_name: firstName,
          last_name: lastName,
          email: role === 'manager' ? SPECIAL_HOTEL_EMAIL : role === 'admin' ? SPECIAL_SYSTEM_EMAIL : SPECIAL_WAITER_ADMIN_EMAIL,
          role: role,
          is_active: true,
          pin: role === 'manager' ? '1234' : role === 'admin' ? '1236' : '1235',
          allowed_hotel_routes: []
        }, { onConflict: 'id' })
        .select();

      if (upsertError) {
        console.error('[Auth] Error upserting special staff:', upsertError);
      }
    } catch (error) {
      console.error('[Auth] Failed to upsert special staff:', error);
    }

    // Create staff session directly without API auth
    const staffData = {
      staff_id: validUuid,
      first_name: firstName,
      last_name: lastName,
      role: role,
      allowed_hotel_routes: [],
    };

    // Mark special auth so AuthContext can detect it on reload/navigation
    if (role === 'manager') {
      localStorage.setItem(SPECIAL_HOTEL_LOGIN_KEY, 'true');
      localStorage.removeItem(SPECIAL_WAITER_LOGIN_KEY);
      localStorage.removeItem(SPECIAL_SYSTEM_LOGIN_KEY);
    } else if (role === 'waiter_admin') {
      localStorage.setItem(SPECIAL_WAITER_LOGIN_KEY, 'true');
      localStorage.removeItem(SPECIAL_HOTEL_LOGIN_KEY);
      localStorage.removeItem(SPECIAL_SYSTEM_LOGIN_KEY);
    } else if (role === 'admin') {
      localStorage.setItem(SPECIAL_SYSTEM_LOGIN_KEY, 'true');
      localStorage.removeItem(SPECIAL_HOTEL_LOGIN_KEY);
      localStorage.removeItem(SPECIAL_WAITER_LOGIN_KEY);
    }

    localStorage.setItem(ACTIVE_STAFF_SESSION_KEY, JSON.stringify(staffData));
    sessionStorage.removeItem("waiterTableEntry");
    sessionStorage.removeItem("hotel.waiterPosAccess");
    sessionStorage.removeItem("hotel.posAccessGranted");

    window.dispatchEvent(new CustomEvent('hotel:active-staff-updated', { detail: staffData }));
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      clearPersistedSession();
      localStorage.removeItem(ACTIVE_STAFF_SESSION_KEY);
      sessionStorage.removeItem("waiterTableEntry");
      sessionStorage.removeItem("hotel.waiterPosAccess");
      sessionStorage.removeItem("hotel.posAccessGranted");

      const normalizedEmail = email.trim().toLowerCase();

      // Check for special accounts FIRST
      if (normalizedEmail === SPECIAL_HOTEL_EMAIL && password === SPECIAL_HOTEL_PASSWORD) {
        await provisionSpecialAccount('manager', 'Hotel', 'Manager');
        await refreshAuthState();
        return;
      }

      if (normalizedEmail === SPECIAL_SYSTEM_EMAIL && password === SPECIAL_SYSTEM_PASSWORD) {
        // System admin uses special local auth (pinned to 'admin' role)
        await provisionSpecialAccount('admin', 'System', 'Administrator');
        await refreshAuthState();
        return;
      }

      if (normalizedEmail === SPECIAL_WAITER_ADMIN_EMAIL && password === SPECIAL_WAITER_ADMIN_PASSWORD) {
        await provisionSpecialAccount('waiter_admin', 'Waiter', 'Admin');
        await refreshAuthState();
        return;
      }

      // For normal accounts, try API auth
      const signOutResult = await new Promise<any>((resolve) => {
        const result = apiClient.auth.signOut({ scope: 'local' });
        resolve(result);
      });
      if (signOutResult.error) {
        console.error('Sign out error:', signOutResult.error);
      }

      const signInResult = await new Promise<any>((resolve) => {
        const result = apiClient.auth.signInWithPassword({ email, password });
        resolve(result);
      });
      const signInError = signInResult.error;

      if (!signInError) {
        localStorage.removeItem('app-mode');
        await refreshAuthState();
        return;
      }

      // Handle errors
      if (signInError.message.includes('Local server unreachable') || signInError.message.includes('Failed to fetch')) {
        if (email === 'admin' && password === 'admin') {
          localStorage.setItem('app-mode', 'local-only');
          window.location.reload();
          return;
        } else {
          setError('Backend server unreachable. Use local admin credentials.');
        }
      } else if (signInError.message.includes('Invalid login credentials')) {
        setError('Invalid email or password. Access denied.');
      } else {
        setError(signInError.message);
      }
    } catch (err) {
      setError('An unexpected error occurred during sign in.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row overflow-hidden relative" style={{ background: 'linear-gradient(135deg,#0a1628 0%,#0d1f3c 40%,#0f1a10 70%,#1a1200 100%)', color: '#e2e8f0' }}>
      <div className="absolute pointer-events-none animate-pulse" style={{ top: '-10%', left: '-10%', width: '40%', height: '40%', background: `radial-gradient(circle, ${C.goldGlow} 0%, transparent 70%)`, borderRadius: '50%' }} />
      <div className="absolute pointer-events-none" style={{ bottom: '-10%', right: '-10%', width: '40%', height: '40%', background: `radial-gradient(circle, ${C.blueGlow} 0%, transparent 70%)`, borderRadius: '50%' }} />

      <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
        <svg className="w-full h-full" style={{ opacity: 0.06 }} viewBox="0 0 800 600" preserveAspectRatio="none">
          <line x1="0" y1="100" x2="200" y2="100" stroke={C.gold} strokeWidth="1"/>
          <line x1="200" y1="100" x2="250" y2="150" stroke={C.gold} strokeWidth="1"/>
          <line x1="250" y1="150" x2="400" y2="150" stroke={C.gold} strokeWidth="1"/>
          <line x1="400" y1="150" x2="450" y2="200" stroke={C.gold} strokeWidth="1"/>
          <circle cx="200" cy="100" r="3" fill={C.gold}/>
          <circle cx="250" cy="150" r="3" fill={C.gold}/>
          <circle cx="400" cy="150" r="3" fill={C.gold}/>
          <circle cx="450" cy="200" r="3" fill={C.gold}/>
          <line x1="600" y1="50" x2="750" y2="50" stroke={C.blue} strokeWidth="1"/>
          <line x1="750" y1="50" x2="750" y2="150" stroke={C.blue} strokeWidth="1"/>
          <line x1="750" y1="150" x2="800" y2="200" stroke={C.blue} strokeWidth="1"/>
          <circle cx="600" cy="50" r="3" fill={C.blue}/>
          <circle cx="750" cy="50" r="3" fill={C.blue}/>
          <circle cx="750" cy="150" r="3" fill={C.blue}/>
          <line x1="0" y1="450" x2="150" y2="450" stroke={C.gold} strokeWidth="1"/>
          <line x1="150" y1="450" x2="200" y2="400" stroke={C.gold} strokeWidth="1"/>
          <line x1="200" y1="400" x2="350" y2="400" stroke={C.gold} strokeWidth="1"/>
          <circle cx="150" cy="450" r="3" fill={C.gold}/>
          <circle cx="200" cy="400" r="3" fill={C.gold}/>
          <circle cx="350" cy="400" r="3" fill={C.gold}/>
          <line x1="500" y1="500" x2="650" y2="500" stroke={C.blue} strokeWidth="1"/>
          <line x1="650" y1="500" x2="700" y2="550" stroke={C.blue} strokeWidth="1"/>
          <circle cx="500" cy="500" r="3" fill={C.blue}/>
          <circle cx="650" cy="500" r="3" fill={C.blue}/>
          <circle cx="700" cy="550" r="3" fill={C.blue}/>
        </svg>
      </div>

      <div className="absolute inset-0 pointer-events-none z-0">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="absolute w-1 h-1 rounded-full animate-float" style={{ left: `${10 + i * 7}%`, top: `${15 + ((i * 11) % 70)}%`, animationDelay: `${i * 0.3}s`, opacity: 0.3 + (i % 4) * 0.1, background: i % 2 === 0 ? C.gold : C.blue }} />
        ))}
      </div>

      <div className="absolute left-0 bottom-0 w-64 md:w-96 h-64 md:h-96 pointer-events-none z-0" style={{ opacity: 0.1 }}>
        <svg viewBox="0 0 200 200" fill="none" className="w-full h-full">
          <path d="M100 20L120 50H80L100 20Z" fill={C.gold}/>
          <circle cx="100" cy="70" r="35" stroke={C.gold} strokeWidth="3" fill="none"/>
          <circle cx="88" cy="65" r="8" fill={C.gold}/>
          <circle cx="112" cy="65" r="8" fill={C.gold}/>
          <rect x="85" y="110" width="30" height="50" rx="5" stroke={C.gold} strokeWidth="3" fill="none"/>
          <rect x="60" y="115" width="20" height="40" rx="3" stroke={C.gold} strokeWidth="2" fill="none" opacity=".5"/>
          <rect x="120" y="115" width="20" height="40" rx="3" stroke={C.gold} strokeWidth="2" fill="none" opacity=".5"/>
          <rect x="75" y="165" width="20" height="25" rx="3" stroke={C.gold} strokeWidth="2" fill="none" opacity=".5"/>
          <rect x="105" y="165" width="20" height="25" rx="3" stroke={C.gold} strokeWidth="2" fill="none" opacity=".5"/>
          <line x1="70" y1="130" x2="50" y2="120" stroke={C.gold} strokeWidth="2"/>
          <line x1="130" y1="130" x2="150" y2="120" stroke={C.gold} strokeWidth="2"/>
          <circle cx="50" cy="120" r="5" fill={C.gold}/>
          <circle cx="150" cy="120" r="5" fill={C.gold}/>
        </svg>
      </div>

      <div className="absolute right-0 top-10 w-48 md:w-72 h-48 md:h-48 pointer-events-none z-0 rotate-12" style={{ opacity: 0.08 }}>
        <svg viewBox="0 0 200 200" fill="none" className="w-full h-full">
          <path d="M100 20L120 50H80L100 20Z" fill={C.blue}/>
          <circle cx="100" cy="70" r="35" stroke={C.blue} strokeWidth="3" fill="none"/>
          <circle cx="88" cy="65" r="8" fill={C.blue}/>
          <circle cx="112" cy="65" r="8" fill={C.blue}/>
          <rect x="85" y="110" width="30" height="50" rx="5" stroke={C.blue} strokeWidth="3" fill="none"/>
          <rect x="60" y="115" width="20" height="40" rx="3" stroke={C.blue} strokeWidth="2" fill="none" opacity=".5"/>
          <rect x="120" y="115" width="20" height="40" rx="3" stroke={C.blue} strokeWidth="2" fill="none" opacity=".5"/>
          <rect x="75" y="165" width="20" height="25" rx="3" stroke={C.blue} strokeWidth="2" fill="none" opacity=".5"/>
          <rect x="105" y="165" width="20" height="25" rx="3" stroke={C.blue} strokeWidth="2" fill="none" opacity=".5"/>
          <line x1="70" y1="130" x2="50" y2="120" stroke={C.blue} strokeWidth="2"/>
          <line x1="130" y1="130" x2="150" y2="120" stroke={C.blue} strokeWidth="2"/>
          <circle cx="50" cy="120" r="5" fill={C.blue}/>
          <circle cx="150" cy="120" r="5" fill={C.blue}/>
        </svg>
      </div>

      <div className="relative flex-1 flex flex-col justify-center px-8 md:px-16 py-12 z-10 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(135deg, ${C.goldFill} 0%, transparent 60%)`, opacity: 0.6 }} />

        <div className="relative space-y-8 max-w-xl">
          <div className="flex items-center gap-4 group">
            <div className="p-3 rounded-2xl group-hover:scale-110 transition-transform duration-500" style={{ background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`, boxShadow: `0 0 28px ${C.goldGlow}` }}>
              <Bot className="w-10 h-10 text-white animate-bounce-slow" />
            </div>
            <div>
              <h1 className="text-3xl md:text-5xl font-black tracking-tighter uppercase leading-none">TRANSFORMER</h1>
              <span className="text-3xl md:text-5xl font-black tracking-widest uppercase block mt-1" style={{ color: C.gold, textShadow: `0 0 18px ${C.goldGlow}` }}>ROBOT</span>
            </div>
          </div>

          <div className="space-y-4">
            <h2 className="text-2xl md:text-4xl font-bold leading-tight">
              The Future of{' '}
              <span style={{ background: `linear-gradient(90deg, ${C.gold}, ${C.blue})`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Intelligent Logistics</span>
            </h2>
            <p className="text-lg md:text-xl leading-relaxed max-w-md" style={{ color: C.textMuted }}>
              Empowering your business with AI-driven robotics and autonomous inventory control.
              Experience zero-error stock management.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4 pt-4">
            <div className="p-4 rounded-2xl group hover:scale-105 transition-all duration-300" style={{ background: C.goldFill, border: `0.5px solid ${C.goldBorder}` }}>
              <Cpu className="w-6 h-6 mb-2 group-hover:rotate-12 transition-transform" style={{ color: C.gold }} />
              <div className="font-bold text-sm uppercase tracking-wider" style={{ color: C.gold }}>AI Core</div>
              <div className="text-xs mt-1" style={{ color: C.textHint }}>Real-time optimization</div>
            </div>
            <div className="p-4 rounded-2xl group hover:scale-105 transition-all duration-300" style={{ background: C.blueFill, border: `0.5px solid ${C.blueBorder}` }}>
              <ShieldCheck className="w-6 h-6 mb-2 group-hover:scale-110 transition-transform" style={{ color: C.blue }} />
              <div className="font-bold text-sm uppercase tracking-wider" style={{ color: C.blue }}>Secure</div>
              <div className="text-xs mt-1" style={{ color: C.textHint }}>End-to-end encryption</div>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-6 md:p-12 z-10">
        <Card className="w-full max-w-md shadow-2xl relative overflow-hidden" style={{ background: C.cardBg, backdropFilter: 'blur(24px)', border: `0.5px solid ${C.goldBorder}`, borderRadius: '20px' }}>
          <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${C.gold} 40%, ${C.blue} 60%, transparent)` }} />

          <CardContent className="p-8 space-y-7">
            <div className="text-center space-y-2">
              <div className="inline-flex p-3 rounded-full mb-2" style={{ background: `linear-gradient(135deg, ${C.goldFill}, ${C.blueFill})`, border: `0.5px solid ${C.goldBorder}` }}>
                <Lock className="w-6 h-6" style={{ color: C.gold }} />
              </div>
              <h3 className="text-2xl font-bold text-white tracking-tight">System Access</h3>
              <p className="text-sm" style={{ color: C.textHint }}>Enter your credentials to initiate session</p>
            </div>

            <form onSubmit={handleSignIn} className="space-y-5" autoComplete="off">
              <div className="space-y-2">
                <Label htmlFor="signin-email" className="text-xs font-black uppercase tracking-widest transition-colors" style={{ color: emailFocused ? C.gold : C.textLabel }}>
                  Email
                </Label>
                <div className="relative">
                  <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none transition-colors" style={{ color: emailFocused ? C.gold : C.textLabel }} />
                  <Input id="signin-email" type="email" placeholder="name@transformer.io" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" onFocus={() => setEmailFocused(true)} onBlur={() => setEmailFocused(false)} style={{ height: '48px', paddingLeft: '38px', fontSize: '15px', borderRadius: '10px', background: C.inputBg, border: `1px solid ${emailFocused ? C.gold : C.goldBorder}`, boxShadow: emailFocused ? `0 0 0 3px ${C.goldGlow}` : 'none', color: '#e2e8f0', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s', caretColor: C.gold }} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="signin-password" className="text-xs font-black uppercase tracking-widest transition-colors" style={{ color: passwordFocused ? C.blue : C.textLabel }}>
                  Password
                </Label>
                <div className="relative">
                  <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 pointer-events-none transition-colors" style={{ color: passwordFocused ? C.blue : C.textLabel }} />
                  <Input id="signin-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="off" onFocus={() => setPasswordFocused(true)} onBlur={() => setPasswordFocused(false)} style={{ height: '48px', paddingLeft: '38px', fontSize: '15px', borderRadius: '10px', background: C.inputBg, border: `1px solid ${passwordFocused ? C.blue : C.goldBorder}`, boxShadow: passwordFocused ? `0 0 0 3px ${C.blueGlow}` : 'none', color: '#e2e8f0', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s', caretColor: C.blue }} />
                </div>
              </div>

              <div className="text-left">
                <button type="button" onClick={() => setShowHotelAccessHint((v) => !v)} className="text-[11px] font-bold uppercase tracking-[0.18em] transition-colors" style={{ color: C.textLabel }} onMouseEnter={(e) => (e.currentTarget.style.color = C.gold)} onMouseLeave={(e) => (e.currentTarget.style.color = C.textLabel)}>
                  {showHotelAccessHint ? 'Hide Hotel Access' : 'Show Hotel Access'}
                </button>
                {showHotelAccessHint && (
                  <div className="mt-3 rounded-xl px-4 py-3" style={{ border: `0.5px solid ${C.goldBorder}`, background: C.goldFill }}>
                    <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: C.gold }}>Hotel Quick Access</p>
                    <p className="mt-2 text-xs" style={{ color: C.textMuted }}>
                      • <span className="font-semibold text-white">{SPECIAL_HOTEL_EMAIL}</span> / <span className="font-semibold text-white">{SPECIAL_HOTEL_PASSWORD}</span> — Manager
                    </p>
                    <p className="mt-1 text-xs" style={{ color: C.textMuted }}>
                      • <span className="font-semibold text-white">{SPECIAL_SYSTEM_EMAIL}</span> / <span className="font-semibold text-white">{SPECIAL_SYSTEM_PASSWORD}</span> — System Admin
                    </p>
                    <p className="mt-1 text-xs" style={{ color: C.textMuted }}>
                      • <span className="font-semibold text-white">{SPECIAL_WAITER_ADMIN_EMAIL}</span> / <span className="font-semibold text-white">{SPECIAL_WAITER_ADMIN_PASSWORD}</span> — Waiter Admin
                    </p>
                  </div>
                )}
              </div>

              {error && (
                <Alert className="animate-in fade-in slide-in-from-top-2 duration-300" style={{ background: C.errorBg, border: `0.5px solid ${C.errorBorder}`, borderRadius: '10px' }}>
                  <AlertCircle className="h-4 w-4" style={{ color: C.error }} />
                  <AlertDescription className="text-xs font-bold uppercase tracking-tight" style={{ color: C.error }}>{error}</AlertDescription>
                </Alert>
              )}

              <Button type="submit" disabled={loading} className="w-full relative overflow-hidden active:scale-[0.98] transition-all group/btn" style={{ height: '52px', fontSize: '15px', fontWeight: 800, letterSpacing: '0.14em', borderRadius: '12px', border: 'none', background: `linear-gradient(135deg, ${C.goldDark} 0%, ${C.gold} 45%, ${C.blueDark} 100%)`, boxShadow: `0 0 28px ${C.goldGlow}`, color: '#fff', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.8 : 1 }}>
                <div className="absolute inset-0 -translate-x-full group-hover/btn:animate-shimmer pointer-events-none" style={{ background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.18) 50%, transparent 60%)' }} />
                {loading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 rounded-full animate-spin" style={{ border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff' }} />
                    <span>Synchronizing...</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center gap-2">
                    <span>INITIATE LOGIN</span>
                    <ArrowRight className="w-5 h-5 group-hover/btn:translate-x-1 transition-transform" />
                  </div>
                )}
              </Button>
            </form>

            <div className="pt-4 text-center" style={{ borderTop: '0.5px solid rgba(255,255,255,0.06)' }}>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: '#2E3D50' }}>Secure Portal // Transformer Robot Systems</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes shimmer { 100% { transform: translateX(200%); } }
        .animate-shimmer { animation: shimmer 2.2s infinite; }
        .animate-bounce-slow { animation: bounceSlow 3s ease-in-out infinite; }
        @keyframes bounceSlow {
          0%, 100% { transform: translateY(-6px); animation-timing-function: cubic-bezier(0.8,0,1,1); }
          50%       { transform: translateY(0);   animation-timing-function: cubic-bezier(0,0,0.2,1); }
        }
      `}} />
    </div>
  );
}