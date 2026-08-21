import type { NearbyOperatingMode } from './types';

/** Event Mode always opens the radar. Create Event is a separate control on that screen. */
export const EVENT_MODE_RADAR_ROUTE = '/(tabs)/nearby' as const;
export const CREATE_EVENT_ROUTE = '/events/create' as const;
export const EVENTS_LIST_ROUTE = '/events' as const;

export type EventModeTapPlan = {
  /** First screen after Event Mode. Always the radar — never create or the list. */
  navigateTo: null;
  stayOnRadar: true;
  /** Yellow Event Mode chrome when no gathering is live yet. */
  showEventShell: boolean;
  /** Invisible must pick an audience first. Still does not leave the radar. */
  openBlockedSheet: boolean;
};

export function planEventModeTap(input: {
  operatingMode: NearbyOperatingMode;
  eventEnabled: boolean;
}): EventModeTapPlan {
  if (input.operatingMode === 'invisible' && !input.eventEnabled) {
    return {
      navigateTo: null,
      stayOnRadar: true,
      showEventShell: false,
      openBlockedSheet: true,
    };
  }
  return {
    navigateTo: null,
    stayOnRadar: true,
    showEventShell: !input.eventEnabled,
    openBlockedSheet: false,
  };
}

export function eventModeEntryDestination(): typeof EVENT_MODE_RADAR_ROUTE {
  return EVENT_MODE_RADAR_ROUTE;
}

export function createEventFromRadarDestination(): typeof CREATE_EVENT_ROUTE {
  return CREATE_EVENT_ROUTE;
}

export function eventsListFromRadarDestination(): typeof EVENTS_LIST_ROUTE {
  return EVENTS_LIST_ROUTE;
}
