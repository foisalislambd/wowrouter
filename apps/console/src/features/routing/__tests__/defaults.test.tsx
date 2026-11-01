import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { signInAs } from '@/test/utils';

import { DefaultsPanel } from '../components/health-defaults';
import { useRouting } from '../store';

const meta = { etag: '"s"', generation: 1, created_at: '', updated_at: '', managed_by: 'api' as const };
const ready = <T,>(data: T) => ({ data, status: 'ready' as const, error: null, at: Date.now() });

describe('routing defaults', () => {
  it('shows the built-in admission limits when none are set', () => {
    signInAs(['policies:read', 'settings:read']);
    useRouting.setState({
      policies: ready({ spec: {}, metadata: meta }),
      resilience: ready({ spec: {}, metadata: meta }),
      server: ready({ spec: {}, metadata: meta }),
    } as never);
    render(<DefaultsPanel />);
    const row = (label: string) => screen.getAllByText(label).at(-1)?.nextElementSibling;
    expect(row('In flight at most')).toHaveTextContent('16384default');
    expect(row('Waiting at most')).toHaveTextContent('4096default');
    expect(row('Longest wait')).toHaveTextContent('2sdefault');
    expect(row('Pause above')).toHaveTextContent('50%default');
  });
});
