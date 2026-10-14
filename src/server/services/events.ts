// Tells open dashboards that something changed, so the live board refreshes straight away.
import { EventEmitter } from 'node:events';

export interface LiveEvent {
  type: 'attendance' | 'alert' | 'rollcall' | 'timesheet' | 'bookings' | 'clients' | 'reset';
  siteId?: number | null;
}

export const live = new EventEmitter();
live.setMaxListeners(0);

export function notify(ev: LiveEvent) {
  live.emit('change', ev);
}
