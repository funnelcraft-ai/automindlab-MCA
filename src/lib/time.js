'use strict';
const { DateTime, Interval } = require('luxon');

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']; // luxon weekday 1..7
const DAY_NAMES = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };

function nowIn(tz) {
  return DateTime.now().setZone(tz);
}

function hoursFor(tenant, dt) {
  const hours = tenant.business_hours || {};
  const h = hours[DAY_KEYS[dt.weekday - 1]];
  if (!h || !Array.isArray(h) || h.length !== 2) return null;
  const [oh, om] = h[0].split(':').map(Number);
  const [ch, cm] = h[1].split(':').map(Number);
  return {
    open: dt.set({ hour: oh, minute: om, second: 0, millisecond: 0 }),
    close: dt.set({ hour: ch, minute: cm, second: 0, millisecond: 0 }),
  };
}

function isOpenNow(tenant) {
  const now = nowIn(tenant.timezone);
  const h = hoursFor(tenant, now);
  return !!h && now >= h.open && now < h.close;
}

function fmt12(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ap = h >= 12 ? 'pm' : 'am';
  const hr = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hr}:${String(m).padStart(2, '0')}${ap}` : `${hr}${ap}`;
}

function businessHoursText(tenant) {
  const hours = tenant.business_hours || {};
  return DAY_KEYS.map((k) => {
    const h = hours[k];
    return `${DAY_NAMES[k]}: ${h ? `${fmt12(h[0])}-${fmt12(h[1])}` : 'closed'}`;
  }).join(', ');
}

// Candidate appointment windows inside business hours, starting on the hour/half hour.
function candidateSlots(tenant, { fromISO, days } = {}) {
  const tz = tenant.timezone;
  const now = nowIn(tz);
  const earliest = now.plus({ minutes: tenant.min_lead_minutes || 0 });
  let day = fromISO ? DateTime.fromISO(fromISO, { zone: tz }).startOf('day') : now.startOf('day');
  if (!day.isValid || day < now.startOf('day')) day = now.startOf('day');
  const horizon = now.plus({ days: tenant.booking_days_ahead || 7 }).endOf('day');
  const span = Math.max(1, Math.min(days || 3, 14));
  const slotLen = tenant.slot_minutes || 120;
  const out = [];
  let openDays = 0; // count only days that actually have bookable windows
  for (; openDays < span && day <= horizon; day = day.plus({ days: 1 })) {
    const h = hoursFor(tenant, day);
    if (!h) continue;
    let found = false;
    for (let s = h.open; s.plus({ minutes: slotLen }) <= h.close; s = s.plus({ minutes: slotLen })) {
      if (s >= earliest) {
        out.push({ start: s, end: s.plus({ minutes: slotLen }) });
        found = true;
      }
    }
    if (found) openDays++;
  }
  return out;
}

function removeBusy(slots, busy /* [{start,end}] ISO */) {
  const busyIv = busy.map((b) => Interval.fromDateTimes(DateTime.fromISO(b.start), DateTime.fromISO(b.end)));
  return slots.filter((s) => {
    const iv = Interval.fromDateTimes(s.start, s.end);
    return !busyIv.some((b) => b.overlaps(iv));
  });
}

function speakable(dt, tz) {
  const d = (DateTime.isDateTime(dt) ? dt : DateTime.fromISO(dt)).setZone(tz);
  return d.toFormat("cccc, LLLL d 'at' h:mm a");
}

function slotsForAgent(slots, tz, limit = 6) {
  return slots.slice(0, limit).map((s) => ({
    start_iso: s.start.toUTC().toISO(),
    label: speakable(s.start, tz) + ' to ' + s.end.setZone(tz).toFormat('h:mm a'),
  }));
}

module.exports = { nowIn, isOpenNow, businessHoursText, candidateSlots, removeBusy, speakable, slotsForAgent };
