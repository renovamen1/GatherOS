import React from 'react';
import App from './App.jsx';

const PAID_ENTITLEMENT = {
  mode: 'paid', paid: true,
  trial: { startedAt: 0, endsAt: 0, active: false, daysLeft: 0 },
  canCreateSave: true, proUnlocked: true, serverTrialing: false, loading: false,
};

export default function AppGate() {
  return <App entitlement={PAID_ENTITLEMENT} />;
}
