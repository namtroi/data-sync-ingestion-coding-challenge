export interface RawEvent {
  id?: string;
  type?: string;
  timestamp?: string | number;
  [key: string]: any;
}

export interface TransformedRow {
  id: string;
  event_type: string | null;
  timestamp: Date | null;
  data: any;
}

export function normalizeTimestamp(input: string | number): Date {
  if (input === null || input === undefined) {
    throw new Error('Invalid timestamp: missing value');
  }

  let date: Date;
  if (typeof input === 'number') {
    date = new Date(input);
  } else if (typeof input === 'string') {
    const parsed = Date.parse(input);
    if (isNaN(parsed)) {
      throw new Error(`Invalid timestamp string: ${input}`);
    }
    date = new Date(parsed);
  } else {
    throw new Error(`Invalid timestamp format: ${typeof input}`);
  }

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${input}`);
  }

  return date;
}

export function transformEvent(raw: RawEvent): TransformedRow {
  if (!raw.id) {
    throw new Error('Missing id field in event');
  }

  let timestamp: Date | null = null;
  if (raw.timestamp) {
    timestamp = normalizeTimestamp(raw.timestamp);
  }

  return {
    id: String(raw.id),
    event_type: raw.type ? String(raw.type) : null,
    timestamp,
    data: raw
  };
}

export function transformEvents(rawEvents: RawEvent[]): TransformedRow[] {
  return rawEvents.map(transformEvent);
}
