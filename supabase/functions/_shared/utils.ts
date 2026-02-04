export async function sha256Hex(input: string) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalizePhone(phone: string) {
  return phone.replace(/[^\d]/g, '').replace(/^974/, '');
}

export function normalizeMinute(ts: Date) {
  const copy = new Date(ts);
  copy.setSeconds(0, 0);
  return copy.toISOString().slice(0, 16); // yyyy-mm-ddTHH:MM
}

export function buildIdempotencyKey(sms: string, timestamp: Date) {
  const content = sms.replace(/\s+/g, '').toLowerCase().slice(0, 100);
  return `${content}|${normalizeMinute(timestamp)}`;
}

export function extractTimeContext(ts: Date) {
  const day = ts.getDay(); // 0=Sun
  const hour = ts.getHours();
  const isWeekend = day === 5 || day === 6; // Qatar Fri/Sat
  const isStartOfMonth = ts.getDate() <= 5;
  const isEndOfMonth = ts.getDate() >= 25;

  let timeOfDay = 'midday';
  if (hour < 6) timeOfDay = 'late night';
  else if (hour < 10) timeOfDay = 'morning';
  else if (hour < 16) timeOfDay = 'afternoon';
  else if (hour < 20) timeOfDay = 'evening';
  else timeOfDay = 'night';

  return {
    hour,
    dayOfWeek: ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][day],
    isWeekend,
    isStartOfMonth,
    isEndOfMonth,
    timeOfDay,
  };
}
