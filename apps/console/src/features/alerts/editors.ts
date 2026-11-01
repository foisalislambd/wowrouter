import { create } from 'zustand';

import type { DeliveryResult } from '@/features/settings/api';

import type { RuleSpec } from './api';

/**
 * What the Alerts screen has open over it: a rule, channel or webhook editor, the rule manager,
 * the delivery log (of one target or all), the maintenance windows or the key-activity flags.
 */
export type Editor =
  | { kind: 'rule'; name: string | null; draft?: { name?: string; spec: Partial<RuleSpec> } }
  | { kind: 'channel'; name: string | null; webhook?: string }
  | { kind: 'webhook'; name: string | null; events?: string[] }
  | { kind: 'manage' }
  | {
      kind: 'deliveries';
      target?: string;
      targetKind?: 'webhook' | 'channel';
      result?: DeliveryResult | '';
    }
  | { kind: 'maintenance' }
  | { kind: 'anomalies'; key?: string };

interface EditorsState {
  /** Open editors, bottom first; each stays mounted under the one opened over it. */
  stack: Editor[];
  /** Opens an editor; `over` keeps the current ones open under it (a channel made from a rule). */
  show: (editor: Editor, options?: { over?: boolean }) => void;
  close: () => void;
}

export const useAlertEditors = create<EditorsState>()((set, get) => ({
  stack: [],
  show: (editor, options) => {
    const stack = get().stack;
    const top = stack[stack.length - 1];
    const over = options?.over || top?.kind === 'manage';
    set({ stack: over ? [...stack, editor] : [editor] });
  },
  close: () => set({ stack: get().stack.slice(0, -1) }),
}));
