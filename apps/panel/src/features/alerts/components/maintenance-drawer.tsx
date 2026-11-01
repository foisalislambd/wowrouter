'use client';

import { useEffect } from 'react';

import { Drawer } from '@/components/ui/overlay';
import { MAINTENANCE_DESCRIPTION, MaintenanceWindows } from '@/features/settings/components/maintenance-card';
import { useDanger } from '@/features/settings/danger-store';

/** The maintenance windows over Alerts: the same list and editor as the danger zone's card. */
export function MaintenanceDrawer({ onClose }: { onClose: () => void }) {
  const loadMaintenance = useDanger((s) => s.loadMaintenance);
  useEffect(() => {
    void loadMaintenance();
  }, [loadMaintenance]);
  return (
    <MaintenanceWindows>
      {({ actions, body }) => (
        <Drawer
          open
          onClose={onClose}
          width="lg"
          title="Maintenance windows"
          subtitle={MAINTENANCE_DESCRIPTION}
          headerActions={actions}
        >
          {body}
        </Drawer>
      )}
    </MaintenanceWindows>
  );
}
