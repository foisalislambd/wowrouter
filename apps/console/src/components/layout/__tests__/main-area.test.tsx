import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KeyboardHints } from '@/components/ui/keyboard-hints';
import { usePreferences } from '@/stores/preferences';

import { MainArea } from '../app-shell';

/** A list screen with a short list: the strip deep in its tree, right under four rows. */
function ShortList() {
  return (
    <div className="flex">
      <div className="min-w-0 flex-1">
        <table aria-label="Requests">
          <tbody>
            {[1, 2, 3, 4].map((n) => (
              <tr key={n}>
                <td>Row {n}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <KeyboardHints />
      </div>
    </div>
  );
}

describe('Keyboard-hints strip', () => {
  it('lands at the bottom of the main area, after a page that grows to fill the view', () => {
    usePreferences.setState({ keyboardHints: true });
    render(
      <MainArea>
        <ShortList />
      </MainArea>,
    );
    const main = screen.getByRole('main');
    const strip = screen.getByRole('note', { name: 'Keyboard shortcuts on this page' });
    // Not under the table inside the page, but in the slot that closes the main area.
    expect(screen.getByRole('table', { name: 'Requests' }).parentElement).not.toContainElement(strip);
    const slot = main.lastElementChild as HTMLElement;
    expect(slot).toHaveAttribute('data-keyboard-hints-slot');
    expect(slot).toContainElement(strip);
    expect(slot).toHaveClass('sticky', 'bottom-0', 'shrink-0');
    // The page fills the view above the strip, so a short list leaves the strip at the bottom; only
    // `main` scrolls.
    const page = main.firstElementChild as HTMLElement;
    expect(page).toHaveAttribute('data-page');
    expect(page).toHaveClass('grow', 'shrink-0', 'flex-col');
    expect(page).not.toHaveClass('overflow-auto');
    expect(main).toHaveClass('overflow-auto', 'flex-col');
  });

  it('leaves the slot empty when the page shows no strip or hints are off', () => {
    usePreferences.setState({ keyboardHints: false });
    render(
      <MainArea>
        <ShortList />
      </MainArea>,
    );
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
    expect(screen.getByRole('main').lastElementChild).toBeEmptyDOMElement();
  });

  it('stays where it is when a screen is rendered without the shell', () => {
    usePreferences.setState({ keyboardHints: true });
    render(<ShortList />);
    expect(screen.getByRole('note').previousElementSibling).toBe(screen.getByRole('table'));
  });
});
