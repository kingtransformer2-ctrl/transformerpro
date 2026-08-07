import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { apiClient } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AlertCircle, Shield, CheckCircle, User, Users } from 'lucide-react';

export default function AdminSetup() {
  const { user } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupSecret, setSetupSecret] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Redirect if already authenticated
  if (user) {
    return <Navigate to="/" replace />;
  }

  // Check if setup is allowed (only in development or if a secret is provided)
  const isSetupAllowed = import.meta.env.DEV || (setupSecret && setupSecret === import.meta.env.VITE_ADMIN_SETUP_SECRET);

  const createFreshAdmin = async () => {
    if (!email || !password) {
      setError('Email and password are required');
      return;
    }

    if (!isSetupAllowed) {
      setError('Admin setup is restricted. Please provide the correct setup secret.');
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    try {
      // Create a completely new admin account
      const { error: signUpError } = await apiClient.auth.signUp({
        email,
        password,
        options: {
          data: {
            first_name: 'System',
            last_name: 'Admin',
            role: 'admin'
          },
          emailRedirectTo: `${window.location.origin}/`
        },
      });

      if (signUpError && !signUpError.message.includes('already been registered')) {
        throw signUpError;
      }

      // Try to sign in immediately
      const { error: signInError } = await apiClient.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        throw signInError;
      }

      setSuccess('Admin account initialized and logged in successfully! Redirecting...');
      
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);

    } catch (err: any) {
      setError(`Setup failed: ${err.message}`);
    }
    setLoading(false);
  };

  return (
    <div className="h-full flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mb-4">
            <Shield className="w-6 h-6 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold">System Initialization</CardTitle>
          <CardDescription>
            Initialize the first administrative account for this instance
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="setup-secret">Setup Secret</Label>
              <Input
                id="setup-secret"
                type="password"
                value={setupSecret}
                onChange={(e) => setSetupSecret(e.target.value)}
                placeholder="Enter VITE_ADMIN_SETUP_SECRET"
              />
              <p className="text-[10px] text-muted-foreground">Required for production environments</p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="admin-email">Admin Email</Label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="admin-password">Admin Password</Label>
              <Input
                id="admin-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a strong password"
              />
            </div>
          </div>

          <div className="space-y-3 pt-4">
            <Button 
              onClick={createFreshAdmin} 
              className="w-full h-12" 
              disabled={loading}
              variant="default"
            >
              {loading ? 'Initializing...' : 'Initialize Admin Account'}
            </Button>
          </div>

          <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg border border-dashed">
            <p className="font-bold mb-1">Security Notice:</p>
            <p>This page should only be used during the initial deployment. In production, access is restricted by a server-side secret key.</p>
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert className="border-green-200 bg-green-50">
              <CheckCircle className="h-4 w-4 text-green-600" />
              <AlertDescription className="text-green-800">{success}</AlertDescription>
            </Alert>
          )}

          <div className="text-center">
            <Button variant="link" onClick={() => window.location.href = '/auth'}>
              Back to Login
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
