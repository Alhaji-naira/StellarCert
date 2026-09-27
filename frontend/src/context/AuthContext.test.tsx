import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';
import { tokenStorage, notifyTokenRefreshed } from '../api/tokens';
import { User, UserRole } from '../api/types';

vi.mock('../api/endpoints', () => ({
  authApi: {
    bootstrapAuth: vi.fn().mockRejectedValue(new Error('No refresh cookie')),
    refresh: vi.fn().mockRejectedValue(new Error('No refresh cookie')),
  },
}));

/** Build a JWT-shaped token whose `exp` is `offsetSec` from now. */
const makeToken = (offsetSec: number): string => {
  const payload = btoa(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + offsetSec }),
  );
  return `header.${payload}.signature`;
};

const sampleUser: User = {
  id: '1',
  email: 'alice@example.com',
  firstName: 'Alice',
  lastName: 'Doe',
  role: UserRole.USER,
};

const Consumer: React.FC = () => {
  const { isAuthenticated, user } = useAuth();
  return (
    <div>
      <span data-testid="auth">{String(isAuthenticated)}</span>
      <span data-testid="user">{user?.email ?? 'none'}</span>
    </div>
  );
};

const renderAuth = () =>
  render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  );

beforeEach(() => {
  tokenStorage.clearTokens();
});

describe('AuthContext silent token refresh (#560)', () => {
  it('flips isAuthenticated to true and sets the user after a silent refresh', async () => {
    // Start unauthenticated (no token, no user).
    renderAuth();

    await act(async () => {
      // Allow initial rehydration promise to resolve
    });

    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('user').textContent).toBe('none');

    // Simulate apiClient's background refresh writing a fresh token + user.
    act(() => {
      tokenStorage.setAccessToken(makeToken(3600));
      notifyTokenRefreshed(makeToken(3600), sampleUser);
    });

    // Context updates immediately — no waiting for the 5-minute expiry check.
    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('alice@example.com');
  });

  it('updates the user object from the refresh response', async () => {
    tokenStorage.setAccessToken(makeToken(3600));

    renderAuth();

    await act(async () => {});

    act(() => {
      notifyTokenRefreshed(makeToken(3600), sampleUser);
    });

    expect(screen.getByTestId('user').textContent).toBe('alice@example.com');

    const updated: User = { ...sampleUser, email: 'alice.new@example.com' };
    act(() => {
      tokenStorage.setAccessToken(makeToken(3600));
      notifyTokenRefreshed(makeToken(3600), updated);
    });

    expect(screen.getByTestId('user').textContent).toBe('alice.new@example.com');
    expect(screen.getByTestId('auth').textContent).toBe('true');
  });

  it('keeps isAuthenticated false when a refresh carries no user', async () => {
    tokenStorage.setAccessToken(makeToken(-100)); // expired going in

    renderAuth();

    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('false');

    act(() => {
      notifyTokenRefreshed(makeToken(3600));
    });
    expect(screen.getByTestId('auth').textContent).toBe('false');
  });

  it('ignores a refreshed token that is already expired', async () => {
    renderAuth();

    await act(async () => {});

    act(() => {
      notifyTokenRefreshed(makeToken(-100), sampleUser);
    });
    // Expired token must not authenticate.
    expect(screen.getByTestId('auth').textContent).toBe('false');
  });
});


describe('AuthContext bootstrap on page load (#960)', () => {
  it('restores an authenticated session from bootstrapAuth', async () => {
    const token = makeToken(3600);
    vi.mocked(authApi.bootstrapAuth).mockResolvedValueOnce({
      accessToken: token,
      user: sampleUser,
    } as never);

    renderAuth();

    expect(screen.queryByTestId('auth')).toBeNull();

    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('true');
    expect(screen.getByTestId('user').textContent).toBe('alice@example.com');
  });

  it('starts unauthenticated when bootstrapAuth rejects', async () => {
    renderAuth();

    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('false');
    expect(screen.getByTestId('user').textContent).toBe('none');
  });

  it('rejects an already-expired bootstrap token', async () => {
    vi.mocked(authApi.bootstrapAuth).mockResolvedValueOnce({
      accessToken: makeToken(-60),
      user: sampleUser,
    } as never);

    renderAuth();

    await act(async () => {});

    expect(screen.getByTestId('auth').textContent).toBe('false');
  });
});
