// Entitlement = "what is this user allowed to do right now".
// Paywall removed — all users get full paid access.

function getEntitlement() {
  return {
    mode: 'paid',
    paid: true,
    trial: { startedAt: 0, endsAt: 0, active: false, daysLeft: 0 },
    canCreateSave: true,
    proUnlocked: true,
    serverTrialing: false,
  };
}

function canCreateSave() {
  return true;
}

module.exports = { TRIAL_DAYS: 14, ensureTrialDecided() {}, localTrial: getEntitlement().trial, getEntitlement, canCreateSave };
