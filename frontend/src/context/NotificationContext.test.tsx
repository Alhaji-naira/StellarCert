import React from 'react';
import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider, useNotifications } from './NotificationContext';
import { useAuth } from './AuthContext';
import { apiClient } from '../api';
import { tokenStorage } from '../api/tokens';

const socket = {
    on: vi.fn(),
    disconnect: vi.fn(),
};

vi.mock('./AuthContext', () => ({
    useAuth: vi.fn(),
}));

vi.mock('../api', () => ({
    API_URL: 'http://localhost:3000',
    apiClient: vi.fn(),
}));

vi.mock('socket.io-client', () => ({
    io: vi.fn(() => socket),
}));

const Consumer = () => {
    const { unreadCount } = useNotifications();
    return <span data-testid="unread-count">{unreadCount}</span>;
};

describe('NotificationProvider authentication lifecycle', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.clearAllMocks();
        vi.mocked(useAuth).mockReturnValue({ isAuthenticated: false } as ReturnType<typeof useAuth>);
        vi.mocked(apiClient).mockResolvedValue([]);
    });

    it('starts fetching and connecting after an in-app login', async () => {
        const view = render(
            <NotificationProvider>
                <Consumer />
            </NotificationProvider>,
        );

        expect(apiClient).not.toHaveBeenCalled();

        tokenStorage.setAccessToken('fresh-token');
        vi.mocked(useAuth).mockReturnValue({ isAuthenticated: true } as ReturnType<typeof useAuth>);
        await act(async () => {
            view.rerender(
                <NotificationProvider>
                    <Consumer />
                </NotificationProvider>,
            );
        });

        expect(apiClient).toHaveBeenCalledWith('/notifications');
        expect(socket.on).toHaveBeenCalledWith('newNotification', expect.any(Function));
    });
});
