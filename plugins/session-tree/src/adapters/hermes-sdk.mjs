import { hermesScope } from './hermes.mjs';

/** Bind only the published SDK. Explicit route ownership outranks ambient window/profile state. */
export function createHermesSdkSource(sdk) {
  function readContext() {
    const owner = sdk.state.focusedSessionOwner.get();
    if (!owner) throw new Error('Hermes has not resolved the focused session owner. Please reconnect or refresh.');
    return { ...hermesScope(owner), sessionId: sdk.state.focusedStoredSessionId.get() };
  }
  async function routeFor(scope) {
    const routes = await sdk.profileRoutes();
    const route = routes.find(item => item.connectionId === scope.connectionId && item.profile === scope.profile);
    if (!route) throw new Error('Hermes no longer has this session connection/profile.');
    return route;
  }
  return {
    readContext,
    async readSessions(scope) {
      const route = await routeFor(scope);
      const page = await sdk.listPersistedSessions(route, { profile: route.targetProfile, limit: 500 });
      if (!Array.isArray(page?.sessions)) throw new Error('Hermes returned an invalid session list.');
      return {
        ...page, sessions: page.sessions.map(row => {
          if (row.profile && row.profile !== route.targetProfile && row.profile !== scope.profile) {
            throw new Error('Hermes returned sessions belonging to another profile.');
          }
          // Registry ids are Desktop-local. Qualify backend rows by the exact SDK read route.
          return { ...row, profile: scope.profile, connection_id: scope.connectionId };
        }),
      };
    },
    async openSession(target) {
      const before = readContext(), route = await routeFor(target), after = readContext();
      if (before.connectionId !== after.connectionId || before.profile !== after.profile || before.sessionId !== after.sessionId) {
        throw new Error('Hermes session changed while resolving navigation.');
      }
      await sdk.openSession(target.sessionId, {
        route, intent: 'in-place', keepAllProfilesScope: true,
      });
    },
  };
}
