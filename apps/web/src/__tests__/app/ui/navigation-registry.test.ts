import { NavigationRegistry } from '@/app/lib/navigation/navigation-registry';

describe('NavigationRegistry', () => {
  it('keeps production routes unique and aligned with existing permission semantics', () => {
    const byId = new Map(NavigationRegistry.map((entry) => [entry.id, entry]));

    expect(new Set(NavigationRegistry.map((entry) => entry.id)).size).toBe(NavigationRegistry.length);
    expect(new Set(NavigationRegistry.map((entry) => entry.route)).size).toBe(NavigationRegistry.length);

    expect(byId.get('dashboard')).toMatchObject({ route: '/dashboard', permission: 'workspace:read' });
    expect(byId.get('leads')).toMatchObject({ route: '/leads', permission: 'leads:read' });
    expect(byId.get('opportunities')).toMatchObject({ route: '/opportunities', permission: 'opportunities:read' });
    expect(byId.get('review')).toMatchObject({ route: '/review', permission: 'leads:read' });
    expect(byId.get('profile')).toMatchObject({ route: '/profile', permission: 'profiles:read' });
    expect(byId.get('settings')).toMatchObject({ route: '/settings', permission: 'workspace:read' });
    expect(byId.get('diagnostics')).toMatchObject({
      route: '/settings/diagnostics/sources',
      permission: 'opportunities:read',
    });
  });

  it('requires analytics and visibility metadata for every registered route', () => {
    for (const entry of NavigationRegistry) {
      expect(entry.visibility).toBeTruthy();
      expect(entry.analyticsKey).toBeTruthy();
    }
  });
});
