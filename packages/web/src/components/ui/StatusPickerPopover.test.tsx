import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import type { User } from '@backspace/shared';
import { StatusPickerPopover, useStatusRevertBootstrap } from './StatusPickerPopover';
import { useAuthStore } from '../../stores/authStore';

vi.mock('../../audio/AudioManager', () => ({
  AudioManager: { getInstance: () => ({}) },
}));

const REVERT_STORAGE_KEY = 'backspace_status_revert';

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    username: 'ada',
    displayName: 'Ada',
    avatar: null,
    banner: null,
    avatarColor: null,
    bio: null,
    status: 'online',
    customStatus: null,
    isAdmin: false,
    createdAt: 0,
    ...overrides,
  };
}

function Harness({
  user,
  open = true,
  onClose = vi.fn(),
}: {
  user: User;
  open?: boolean;
  onClose?: () => void;
}) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  return (
    <div>
      <button ref={anchorRef} type="button">
        Anchor
      </button>
      <StatusPickerPopover
        user={user}
        anchorRef={anchorRef}
        open={open}
        onClose={onClose}
      />
    </div>
  );
}

describe('StatusPickerPopover', () => {
  const updateProfile = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    updateProfile.mockReset();
    updateProfile.mockResolvedValue(undefined);
    useAuthStore.setState({
      user: makeUser({ status: 'online' }),
      updateProfile,
    });
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('updates status without scheduling a revert timer when Keep forever is selected', async () => {
    const onClose = vi.fn();
    render(<Harness user={makeUser({ status: 'online' })} onClose={onClose} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /do not disturb/i }));
    });

    expect(updateProfile).toHaveBeenCalledWith({ status: 'dnd' });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(REVERT_STORAGE_KEY)).toBeNull();
  });

  it('schedules an auto-revert timer when a duration is chosen and reverts on expiry', async () => {
    const onClose = vi.fn();
    render(<Harness user={makeUser({ status: 'online' })} onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: /15 min/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /idle/i }));
    });

    expect(updateProfile).toHaveBeenCalledWith({ status: 'idle' });
    expect(localStorage.getItem(REVERT_STORAGE_KEY)).not.toBeNull();

    updateProfile.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(15 * 60_000);
    });

    expect(updateProfile).toHaveBeenCalledWith({ status: 'online' });
    expect(localStorage.getItem(REVERT_STORAGE_KEY)).toBeNull();
  });

  it('allows cancelling an active revert timer', async () => {
    const future = Date.now() + 60 * 60_000;
    localStorage.setItem(
      REVERT_STORAGE_KEY,
      JSON.stringify({ userId: 'user-1', previousStatus: 'online', revertAt: future }),
    );

    render(<Harness user={makeUser({ status: 'dnd' })} />);
    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    fireEvent.click(cancelBtn);

    expect(localStorage.getItem(REVERT_STORAGE_KEY)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(60 * 60_000);
    });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it('useStatusRevertBootstrap reverts expired records for the active user and ignores other users', async () => {
    localStorage.setItem(
      REVERT_STORAGE_KEY,
      JSON.stringify({ userId: 'other-user', previousStatus: 'online', revertAt: Date.now() - 1000 }),
    );
    const { unmount } = renderHook(() => useStatusRevertBootstrap());
    expect(updateProfile).not.toHaveBeenCalled();
    unmount();

    localStorage.setItem(
      REVERT_STORAGE_KEY,
      JSON.stringify({ userId: 'user-1', previousStatus: 'online', revertAt: Date.now() - 1000 }),
    );
    renderHook(() => useStatusRevertBootstrap());
    expect(updateProfile).toHaveBeenCalledWith({ status: 'online' });
    expect(localStorage.getItem(REVERT_STORAGE_KEY)).toBeNull();
  });
});
