import React, { createContext, useContext, useEffect, useState, useMemo, ReactNode } from 'react';
import { User } from '../api/types';
import { tokenStorage, setTokenRefreshCallback } from '../api/tokens';
import { authApi } from '../api/endpoints';

// Helper function to check if JWT token is expired
const isTokenExpired = (token: string): boolean => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const currentTime = Date.now() / 1000;
    return payload.exp < currentTime;
  } catch {
    return true; // If token is malformed, consider it expired
  }
};

interface AuthContextValue {
  user: User | null;
  setUser: (user: User | null) => void;
  isAuthenticated: boolean;
  isLoading: boolean;
  clearAuth: () => void;
  login: (accessToken: string, user: User) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUserState] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  // Track the access token in React state so `isAuthenticated` is reactive.
  const [accessToken, setAccessTokenState] = useState<string | null>(() =>
    tokenStorage.getAccessToken(),
  );

  // Derive isAuthenticated once per token/user change.
  const isAuthenticated = useMemo(() => {
    return !!user && !!accessToken && !isTokenExpired(accessToken);
  }, [user, accessToken]);

  useEffect(() => {
    /**
     * Bootstrap the session on every full page load.
     *
     * We always call `bootstrapAuth` (one POST /auth/refresh) rather than
     * branching on whether an access token is already in memory.  The
     * in-memory token is gone after every hard refresh, so any fast-path
     * that skips the network call would leave `user` unpopulated and force
     * protected routes to redirect to /login.
     *
     * `AuthProvider` renders a full-screen spinner while `isLoading` is true,
     * so no route — and therefore no protected API call — can mount before
     * this resolves.  That eliminates the page-load race that previously
     * required the cooldown guard in `refreshTokens` (#960).
     */
    const bootstrap = async () => {
      try {
        const response = await authApi.bootstrapAuth();
        if (response.accessToken && !isTokenExpired(response.accessToken)) {
          tokenStorage.setAccessToken(response.accessToken);
          setAccessTokenState(response.accessToken);
          if (response.user) {
            setUserState(response.user);
          }
        } else {
          // Server returned a token but it's already expired — treat as
          // unauthenticated so the user gets a clean login prompt.
          tokenStorage.clearTokens();
          setUserState(null);
          setAccessTokenState(null);
        }
      } catch {
        // No valid refresh-token cookie (new visitor, logged-out user, or
        // expired session) — start unauthenticated.
        tokenStorage.clearTokens();
        setUserState(null);
        setAccessTokenState(null);
      } finally {
        setIsLoading(false);
      }
    };

    bootstrap();

    // Keep AuthContext in sync when apiClient silently refreshes the access token.
    setTokenRefreshCallback((newAccessToken, refreshedUser) => {
      if (isTokenExpired(newAccessToken)) {
        return;
      }
      setAccessTokenState(newAccessToken);
      if (refreshedUser) {
        setUserState(refreshedUser);
      }
      setIsLoading(false);
    });

    // Set up periodic token expiration check (every 5 minutes)
    const interval = setInterval(() => {
      const currentToken = tokenStorage.getAccessToken();
      if (currentToken && isTokenExpired(currentToken)) {
        console.warn('Access token expired, clearing authentication state');
        tokenStorage.clearTokens();
        setUserState(null);
        setAccessTokenState(null);
      }
    }, 5 * 60 * 1000);

    return () => {
      clearInterval(interval);
      // Drop the callback so a torn-down provider can't update stale state.
      setTokenRefreshCallback(() => {});
    };
  }, []);

  useEffect(() => {
    if (!user) {
      tokenStorage.clearTokens();
      setAccessTokenState(null);
    }
  }, [user]);

  const setUser = (nextUser: User | null) => setUserState(nextUser);

  const clearAuth = () => {
    setUserState(null);
    tokenStorage.clearTokens();
    setAccessTokenState(null);
  };

  const login = (accessToken: string, nextUser: User) => {
    if (isTokenExpired(accessToken)) {
      console.error('Attempted to login with expired token');
      return;
    }

    // Access token is held in-memory in tokenStorage
    tokenStorage.setAccessToken(accessToken);
    setAccessTokenState(accessToken);
    setUserState(nextUser);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 dark:bg-slate-950">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-blue-600" />
      </div>
    );
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        isAuthenticated,
        isLoading,
        clearAuth,
        login,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
