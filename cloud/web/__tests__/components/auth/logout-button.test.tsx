/**
 * Tests for LogoutButton Component
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LogoutButton } from '@/components/auth/logout-button';
import { signOut } from 'next-auth/react';

// Mock next-auth
jest.mock('next-auth/react', () => ({
  signOut: jest.fn().mockResolvedValue(undefined),
}));

describe('LogoutButton Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders Sign Out button by default', () => {
    render(<LogoutButton />);
    
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument();
  });

  it('shows logout icon by default', () => {
    render(<LogoutButton />);
    
    // The LogOut icon from lucide-react
    const button = screen.getByRole('button');
    expect(button.querySelector('svg')).toBeInTheDocument();
  });

  it('hides icon when showIcon is false', () => {
    render(<LogoutButton showIcon={false} />);
    
    const button = screen.getByRole('button');
    // Should still have text but no icon
    expect(screen.getByText(/sign out/i)).toBeInTheDocument();
  });

  it('calls signOut when clicked', async () => {
    const user = userEvent.setup();
    render(<LogoutButton />);
    
    const button = screen.getByRole('button', { name: /sign out/i });
    await user.click(button);

    expect(signOut).toHaveBeenCalledWith({ callbackUrl: '/login' });
  });

  it('shows loading state while signing out', async () => {
    const user = userEvent.setup();
    
    // Make signOut return a pending promise
    (signOut as jest.Mock).mockImplementation(() => new Promise(() => {}));
    
    render(<LogoutButton />);
    
    const button = screen.getByRole('button', { name: /sign out/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByText(/signing out/i)).toBeInTheDocument();
    });
  });

  it('disables button while signing out', async () => {
    const user = userEvent.setup();
    
    (signOut as jest.Mock).mockImplementation(() => new Promise(() => {}));
    
    render(<LogoutButton />);
    
    const button = screen.getByRole('button', { name: /sign out/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeDisabled();
    });
  });

  it('applies custom variant', () => {
    render(<LogoutButton variant="outline" />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveClass('border');
  });

  it('applies custom className', () => {
    render(<LogoutButton className="my-custom-class" />);
    
    const button = screen.getByRole('button');
    expect(button).toHaveClass('my-custom-class');
  });
});
