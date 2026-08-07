import { useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';
import { apiClient } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const useWebAuthn = () => {
  const [loading, setLoading] = useState(false);

  const registerBiometric = async (email: string) => {
    setLoading(true);
    try {
      // Check if WebAuthn is supported
      if (!window.PublicKeyCredential) {
        toast.error('WebAuthn is not supported in this browser');
        return false;
      }

      // Generate registration options
      const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      
      const registrationOptions = {
        challenge,
        rp: {
          name: 'Inventory Management System',
          id: window.location.hostname,
        },
        user: {
          id: btoa(email),
          name: email,
          displayName: email,
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' as const },
          { alg: -257, type: 'public-key' as const },
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform' as const,
          userVerification: 'required' as const,
          requireResidentKey: false,
        },
        timeout: 60000,
        attestation: 'direct' as const,
      };

      const registrationResponse = await startRegistration({ optionsJSON: registrationOptions });
      
      // Store the credential in localStorage for this demo
      // In production, you'd want to store this server-side
      const credentials = JSON.parse(localStorage.getItem('webauthn_credentials') || '{}');
      credentials[email] = {
        id: registrationResponse.id,
        rawId: registrationResponse.rawId,
        response: registrationResponse.response,
        type: registrationResponse.type,
        challenge: challenge,
      };
      localStorage.setItem('webauthn_credentials', JSON.stringify(credentials));
      
      toast.success('Fingerprint authentication registered successfully!');
      return true;
    } catch (error) {
      console.error('Registration failed:', error);
      toast.error('Failed to register fingerprint authentication');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const authenticateWithBiometric = async (email: string) => {
    setLoading(true);
    try {
      // Check if WebAuthn is supported
      if (!window.PublicKeyCredential) {
        toast.error('WebAuthn is not supported in this browser');
        return false;
      }

      // Get stored credentials
      const credentials = JSON.parse(localStorage.getItem('webauthn_credentials') || '{}');
      const userCredential = credentials[email];
      
      if (!userCredential) {
        toast.error('No fingerprint authentication registered for this email');
        return false;
      }

      // Generate authentication options
      const challenge = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
      
      const authenticationOptions = {
        challenge,
        allowCredentials: [{
          id: userCredential.rawId,
          type: 'public-key' as const,
          transports: ['internal'] as AuthenticatorTransport[],
        }],
        userVerification: 'required' as const,
        timeout: 60000,
      };

      const authenticationResponse = await startAuthentication({ optionsJSON: authenticationOptions });
      
      // In a real implementation, you'd verify this server-side
      // For this demo, we'll just check if the credential ID matches
      if (authenticationResponse.id === userCredential.id) {
        toast.success('Fingerprint authentication successful!');
        return true;
      } else {
        toast.error('Fingerprint authentication failed');
        return false;
      }
    } catch (error) {
      console.error('Authentication failed:', error);
      toast.error('Fingerprint authentication failed');
      return false;
    } finally {
      setLoading(false);
    }
  };

  const isBiometricRegistered = (email: string) => {
    const credentials = JSON.parse(localStorage.getItem('webauthn_credentials') || '{}');
    return !!credentials[email];
  };

  const isWebAuthnSupported = () => {
    return !!(window.PublicKeyCredential && 
             window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable);
  };

  return {
    registerBiometric,
    authenticateWithBiometric,
    isBiometricRegistered,
    isWebAuthnSupported,
    loading,
  };
};
