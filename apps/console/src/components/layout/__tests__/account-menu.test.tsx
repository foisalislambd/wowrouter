import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { signInAs } from '@/test/utils';

import { AccountMenu } from '../account-menu';

describe('Account menu', () => {
  it('links to the Admin API reference in a new tab', async () => {
    signInAs([]);
    render(<AccountMenu />);
    await userEvent.click(screen.getByRole('button', { name: /Account menu for/ }));
    const link = screen.getByRole('menuitem', { name: 'Admin API reference' });
    expect(link).toHaveAttribute('href', '/admin/v1/openapi.json');
    expect(link).toHaveAttribute('target', '_blank');
  });
});
