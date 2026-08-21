import { describe, expect, it } from 'vitest';

import {
  CREATE_EVENT_ROUTE,
  EVENT_MODE_RADAR_ROUTE,
  createEventFromRadarDestination,
  eventModeEntryDestination,
  eventsListFromRadarDestination,
  planEventModeTap,
} from './eventModeEntry';

describe('Event Mode first-screen navigation', () => {
  it('opens the radar instead of Create Event or the Events list', () => {
    expect(eventModeEntryDestination()).toBe(EVENT_MODE_RADAR_ROUTE);
    expect(eventModeEntryDestination()).not.toBe(CREATE_EVENT_ROUTE);
    expect(eventModeEntryDestination()).not.toBe('/events');

    for (const operatingMode of ['around_us', 'event', 'invisible'] as const) {
      const plan = planEventModeTap({ operatingMode, eventEnabled: operatingMode === 'event' });
      expect(plan.stayOnRadar).toBe(true);
      expect(plan.navigateTo).toBeNull();
    }
  });

  it('keeps a live Event Mode session on the yellow radar', () => {
    const plan = planEventModeTap({ operatingMode: 'event', eventEnabled: true });
    expect(plan.stayOnRadar).toBe(true);
    expect(plan.navigateTo).toBeNull();
    expect(plan.showEventShell).toBe(false);
    expect(plan.openBlockedSheet).toBe(false);
  });

  it('shows the Event Mode radar shell when no gathering is live yet', () => {
    const plan = planEventModeTap({ operatingMode: 'around_us', eventEnabled: false });
    expect(plan.stayOnRadar).toBe(true);
    expect(plan.navigateTo).toBeNull();
    expect(plan.showEventShell).toBe(true);
    expect(plan.openBlockedSheet).toBe(false);
  });

  it('does not leave the radar when Invisible blocks Event Mode', () => {
    const plan = planEventModeTap({ operatingMode: 'invisible', eventEnabled: false });
    expect(plan.stayOnRadar).toBe(true);
    expect(plan.navigateTo).toBeNull();
    expect(plan.showEventShell).toBe(false);
    expect(plan.openBlockedSheet).toBe(true);
  });

  it('opens Create Event only from the radar Create Event button', () => {
    expect(createEventFromRadarDestination()).toBe('/events/create');
    expect(createEventFromRadarDestination()).not.toBe(eventModeEntryDestination());
    expect(eventsListFromRadarDestination()).toBe('/events');
  });
});
