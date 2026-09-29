import React, { createContext, useContext, useEffect, useState, useMemo, ReactNode, useCallback } from 'react';
import { User } from '../api/types';
import { tokenStorage, setTokenRefreshCallback } from '../api/tokens';
import { authApi } from '../api/endpoints';
import { useNavigate } from 'react-router-dom';

// Helper function to decode JWT payload safely (handling base64url characters - and _ and missing padding)
export const decodeJwtPayload = (token: string): any => {
  const parts = token.split('.');
  if (parts.length < 2) {
    throw new Error('Invalid JWT format');
  }
  let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padLength = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(padLength);

  let jsonStr: string;
  try {
    jsonStr = decodeURIComponent(
      Array.prototype.map
        .call(
          atob(base64),
          (c: string) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2),
        )
        .join(''),
    );
  } catch {
    jsonStr = atob(base64);
  }

  return JSON.parse(jsonStr);
};

// Helper function to check if JWT token is expired
export const isTokenExpired = (token: string): boolean => {
  try {
    const payload = decodeJwtPayload(token);
    if (!payload || typeof payload.exp !== 'number') {
      return true;
    }
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
  logout: () => Promise<void>;
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
  const navigate = useNavigate();

  // Derive isAuthenticated once per token/user change.
  const isAuthenticated = useMemo(() => {
    return !!user && !!accessToken && !isTokenExpired(accessToken);
  }, [user, accessToken]);

  useEffect(() => {
    // Check token or rehydrate via refresh cookie on app load
    const rehydrateOrCheck = async () => {
      const currentToken = tokenStorage.getAccessToken();

      if (currentToken && !isTokenExpired(currentToken)) {
        setAccessTokenState(currentToken);
        setIsLoading(false);
      } else if (currentToken && isTokenExpired(currentToken)) {
        console.warn('Access token expired, clearing authentication state');
        tokenStorage.clearTokens();
        setUserState(null);
        setAccessTokenState(null);
        setIsLoading(false);
      } else {
        // Attempt silent token refresh via HttpOnly cookie on initial load
        try {
          const response = await authApi.refresh();
          if (response.accessToken && !isTokenExpired(response.accessToken)) {
            tokenStorage.setAccessToken(response.accessToken);
            setAccessTokenState(response.accessToken);
            if (response.user) {
              setUserState(response.user);
            }
          } else {
            tokenStorage.clearTokens();
            setUserState(null);
            setAccessTokenState(null);
          }
        } catch {
          tokenStorage.clearTokens();
          setUserState(null);
          setAccessTokenState(null);
        } finally {
          setIsLoading(false);
        }
      }
    };

    rehydrateOrCheck();

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

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      clearAuth();
      navigate('/');
    }
  }, [navigate]);

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
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};
