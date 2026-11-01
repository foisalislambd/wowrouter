import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';

import { useProviderModels } from '@/features/providers/models';
import { emptySlot } from '@/lib/slot';
import { server } from '@/mocks/node';
import { pickOption, signInAs } from '@/test/utils';

import { AddModelDrawer } from '../components/add-model-drawer';
import { useCatalog, useModels } from '../store';

const meta = {
  etag: '"1"',
  generation: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  managed_by: 'api',
};

function setup(
  deployments: { name: string; spec: { provider: string; model: string }; metadata: typeof meta }[] = [],
  models: { name: string; spec: { target: string }; metadata: typeof meta }[] = [],
) {
  signInAs(['models:read', 'models:write', 'providers:read', 'deployments:write']);
  useProviderModels.setState({ byProvider: {}, resolved: {} });
  useCatalog.setState({
    providers: {
      data: [{ name: 'openai', spec: { type: 'openai' }, metadata: meta }],
      status: 'ready',
      error: null,
      at: Date.now(),
    },
    deployments: { data: deployments, status: 'ready', error: null, at: Date.now() },
    routes: { data: [], status: 'ready', error: null, at: Date.now() },
    tiers: emptySlot(),
  });
  useModels.setState({ items: models, status: 'ready', error: null, loadedAt: Date.now() });
  render(<AddModelDrawer open onClose={() => undefined} onAdded={() => undefined} />);
  return screen.getByRole('dialog', { name: 'Add model' });
}

async function chooseProvider(drawer: HTMLElement) {
  await pickOption(within(drawer).getByRole('combobox', { name: /^Provider$|^Provider \*/ }), /^openai/);
}

const idField = (drawer: HTMLElement) =>
  within(drawer).getByRole('combobox', { name: /Provider’s model ID/ });
const inputPrice = (drawer: HTMLElement) => within(drawer).getByLabelText(/^Input price/);
const outputPrice = (drawer: HTMLElement) => within(drawer).getByLabelText(/^Output price/);

describe('Add model › provider’s model ID', () => {
  it('lists the provider’s models first, marks catalog-only ones, and takes any typed id', async () => {
    const drawer = setup();
    await chooseProvider(drawer);
    const field = idField(drawer);
    await userEvent.click(field);
    const list = await screen.findByRole('listbox');
    const options = await within(list).findAllByRole('option');
    expect(options).toHaveLength(11);
    // Listed first (by id), the catalog's last and marked as such.
    const byId = (id: string) => options.find((o) => o.querySelector('.mono')?.textContent === id);
    expect(byId('gpt-4o-mini')).toHaveTextContent('GPT-4o mini · 128K context');
    expect(byId('gpt-4o-mini')).toHaveTextContent('$0.15 in · $0.60 out');
    // The name only when it says more than the id.
    expect(byId('gpt-4.1')).toHaveTextContent(/^gpt-4\.11M context/);
    expect(options[0]).not.toHaveTextContent('from catalog');
    expect(options.at(-1)).toHaveTextContent('gpt-4-turbo');
    expect(options.at(-1)).toHaveTextContent('from catalog');

    // Typing filters; arrow keys and Enter pick.
    await userEvent.type(field, 'gpt-4o-m');
    const narrowed = within(screen.getByRole('listbox')).getAllByRole('option');
    // Those that start with the text first.
    expect(narrowed.map((o) => o.querySelector('.mono')?.textContent)).toEqual([
      'gpt-4o-mini',
      'ft:gpt-4o-mini-2024-07-18:acme::support-v3',
    ]);
    await userEvent.keyboard('{ArrowDown}{Enter}');
    expect(field).toHaveValue('gpt-4o-mini');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(within(drawer).getByLabelText(/^Name/)).toHaveValue('gpt-4o-mini');

    // Any id the list doesn't have is fine.
    await userEvent.clear(field);
    await userEvent.type(field, 'my-finetune-7');
    expect(within(screen.getByRole('listbox')).queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Not in the list. You can still use this ID.')).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(field).toHaveValue('my-finetune-7');
    expect(screen.getByRole('dialog', { name: 'Add model' })).toBeInTheDocument();
  });

  it('says when the list comes from the catalog, and refreshes it', async () => {
    const reads: string[] = [];
    server.use(
      http.get('*/admin/v1/providers/openai/models', ({ request }) => {
        reads.push(new URL(request.url).search);
        return HttpResponse.json({
          items: [],
          source: 'catalog',
          fetched_at: null,
          error: 'connection refused',
        });
      }),
    );
    const drawer = setup();
    await chooseProvider(drawer);
    expect(
      await within(drawer).findByText(
        /The provider didn’t list its models, so this list comes from the catalog/,
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('button', { name: 'Refresh list' }));
    await waitFor(() => expect(reads).toEqual(['', '?refresh=true']));
  });
});

describe('Add model › prices', () => {
  it('prefills the catalog’s prices without overwriting what was typed, and restores them', async () => {
    const drawer = setup();
    await chooseProvider(drawer);
    expect(within(drawer).getByText('Leave both blank to use list prices.')).toBeInTheDocument();

    // A listed model fills both prices.
    await userEvent.click(idField(drawer));
    await userEvent.click(
      await within(screen.getByRole('listbox')).findByRole('option', { name: /^gpt-4o-mini/ }),
    );
    expect(inputPrice(drawer)).toHaveValue('0.15');
    expect(outputPrice(drawer)).toHaveValue('0.6');
    expect(within(drawer).getByText('Prices from the catalog · edit to override')).toBeInTheDocument();

    // A typed price stays when the model changes; the untouched one follows the model.
    await userEvent.clear(inputPrice(drawer));
    await userEvent.type(inputPrice(drawer), '0.12');
    expect(within(drawer).getByRole('button', { name: 'Use catalog price' })).toBeInTheDocument();
    await userEvent.clear(idField(drawer));
    await userEvent.type(idField(drawer), 'gpt-4o');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(outputPrice(drawer)).toHaveValue('10'));
    expect(inputPrice(drawer)).toHaveValue('0.12');

    // "Use catalog price" restores both.
    await userEvent.click(within(drawer).getByRole('button', { name: 'Use catalog price' }));
    expect(inputPrice(drawer)).toHaveValue('2.5');
    expect(outputPrice(drawer)).toHaveValue('10');
  });

  it('looks up a typed id the list doesn’t have, after typing pauses', async () => {
    const lookups: string[] = [];
    server.use(
      http.get('*/admin/v1/providers/openai/models', ({ request }) => {
        const id = new URL(request.url).searchParams.get('id');
        if (id) lookups.push(id);
        return HttpResponse.json({
          items:
            id === 'gpt-5-preview'
              ? [
                  {
                    id,
                    name: 'GPT-5 preview',
                    listed_by_provider: false,
                    context_window: 400_000,
                    max_output_tokens: null,
                    modalities: null,
                    price: { input: '1.25', output: '10', cache_read: null, cache_write: null },
                    price_source: 'catalog',
                    release_date: null,
                  },
                ]
              : [],
          source: 'provider',
          fetched_at: new Date().toISOString(),
          error: null,
        });
      }),
    );
    const drawer = setup();
    await chooseProvider(drawer);
    await userEvent.type(idField(drawer), 'gpt-5-preview');
    await waitFor(() => expect(inputPrice(drawer)).toHaveValue('1.25'));
    expect(outputPrice(drawer)).toHaveValue('10');
    // One lookup, for the id as typed once typing paused.
    expect(lookups).toEqual(['gpt-5-preview']);
  });
});

describe('Add model › source', () => {
  const dep = (name: string) => ({ name, spec: { provider: 'openai', model: name }, metadata: meta });
  const model = (name: string, target: string) => ({ name, spec: { target }, metadata: meta });

  it('hides the deployment source when every deployment serves a Model', () => {
    const drawer = setup([dep('gpt-4o')], [model('gpt-4o', 'gpt-4o')]);
    expect(within(drawer).queryByRole('radiogroup', { name: 'Source' })).not.toBeInTheDocument();
    expect(within(drawer).getByRole('combobox', { name: /Provider’s model ID/ })).toBeInTheDocument();
    expect(within(drawer).getByText(/add an alias on that Model instead/)).toBeInTheDocument();
  });

  it('offers only the unused deployments, and says what they are', async () => {
    const drawer = setup([dep('gpt-4o'), dep('legacy-davinci')], [model('gpt-4o', 'gpt-4o')]);
    const source = within(drawer).getByRole('radiogroup', { name: 'Source' });
    expect(within(source).getByRole('radio', { name: 'New from a provider' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await userEvent.click(within(source).getByRole('radio', { name: 'Unused deployment (1)' }));
    expect(
      within(drawer).getByText(
        'A deployment set up in the configuration or left after its Model was deleted.',
      ),
    ).toBeInTheDocument();
    await userEvent.click(within(drawer).getByRole('combobox', { name: /^Deployment/ }));
    const options = within(screen.getByRole('listbox')).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual(['legacy-davinci · openai/legacy-davinci']);
  });
});
