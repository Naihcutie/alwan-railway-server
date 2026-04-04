// Native Authentication Handler for Capacitor
// Handles Google and Facebook login in native Android app

import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { Capacitor } from '@capacitor/core';

class NativeAuthService {
    constructor() {
        this.isNative = Capacitor.isNativePlatform();
    }

    async signInWithGoogle() {
        if (!this.isNative) {
            console.log('Not native platform, using web auth');
            return null;
        }

        try {
            // Sign in with Google using native flow
            const result = await FirebaseAuthentication.signInWithGoogle();
            
            console.log('Google sign-in successful:', result.user);
            
            // Firebase auth state will be updated automatically
            return result.user;
        } catch (error) {
            console.error('Google sign-in error:', error);
            throw this.handleAuthError(error);
        }
    }

    async signInWithFacebook() {
        if (!this.isNative) {
            console.log('Not native platform, using web auth');
            return null;
        }

        try {
            // Sign in with Facebook using native flow
            const result = await FirebaseAuthentication.signInWithFacebook();
            
            console.log('Facebook sign-in successful:', result.user);
            
            return result.user;
        } catch (error) {
            console.error('Facebook sign-in error:', error);
            throw this.handleAuthError(error);
        }
    }

    async getCurrentUser() {
        if (!this.isNative) {
            return null;
        }

        try {
            const result = await FirebaseAuthentication.getCurrentUser();
            return result.user;
        } catch (error) {
            console.error('Get current user error:', error);
            return null;
        }
    }

    async signOut() {
        if (!this.isNative) {
            return;
        }

        try {
            await FirebaseAuthentication.signOut();
            console.log('Native sign out successful');
        } catch (error) {
            console.error('Sign out error:', error);
        }
    }

    handleAuthError(error) {
        const errorMessages = {
            'auth/user-cancelled': 'Sign-in was cancelled',
            'auth/network-request-failed': 'Network error. Please check your connection.',
            'auth/invalid-credential': 'Invalid credentials. Please try again.',
            'auth/account-exists-with-different-credential': 'An account already exists with the same email.',
        };

        const message = errorMessages[error.code] || error.message || 'Authentication failed';
        return new Error(message);
    }

    isNativePlatform() {
        return this.isNative;
    }
}

// Export singleton
const nativeAuthService = new NativeAuthService();
export default nativeAuthService;
