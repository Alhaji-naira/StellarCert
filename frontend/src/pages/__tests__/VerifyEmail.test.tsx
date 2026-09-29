import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import VerifyEmail from '../VerifyEmail';
import { authApi } from '../../api/endpoints';
import { ApiError } from '../../api/types';

// Mock the authApi
vi.mock('../../api/endpoints', () => ({
  authApi: {
    verifyEmail: vi.fn(),
  },
}));

const renderVerifyEmail = (token = 'valid-token') => {
  return render(
    <MemoryRouter initialEntries={[`/verify-email?token=${token}`]}>
      <VerifyEmail />
    </MemoryRouter>,
  );
};

describe('VerifyEmail error handling (#996)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('displays server error message when verification fails', async () => {
    const serverError = new ApiError('Invalid verification token', 400, 'Bad Request');
    vi.mocked(authApi.verifyEmail).mockRejectedValue(serverError);

    renderVerifyEmail();

    await waitFor(() => {
      expect(screen.getByText('Invalid verification token')).toBeInTheDocument();
    });
  });

  it('displays generic error for non-ApiError exceptions', async () => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue(new Error('Network error'));

    renderVerifyEmail();

    await waitFor(() => {
      expect(screen.getByText('Network error')).toBeInTheDocument();
    });
  });

  it('displays fallback for unknown error types', async () => {
    vi.mocked(authApi.verifyEmail).mockRejectedValue('string error');

    renderVerifyEmail();

    await waitFor(() => {
      expect(screen.getByText('An unexpected error occurred')).toBeInTheDocument();
    });
  });

  it('shows loading state initially', () => {
    vi.mocked(authApi.verifyEmail).mockImplementation(() => new Promise(() => {}));

    renderVerifyEmail();

    expect(screen.getByText('Verifying your email address...')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});