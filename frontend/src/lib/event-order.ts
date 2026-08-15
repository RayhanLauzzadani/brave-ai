type TimestampedEvent = {
  id: string;
  timestamp: string;
};

function toEpoch(timestamp: string) {
  const value = Date.parse(timestamp);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

export function compareEventsNewestFirst(
  left: TimestampedEvent,
  right: TimestampedEvent,
) {
  const leftTime = toEpoch(left.timestamp);
  const rightTime = toEpoch(right.timestamp);

  if (leftTime !== rightTime) {
    return rightTime > leftTime ? 1 : -1;
  }

  return right.id.localeCompare(left.id);
}

export function sortEventsNewestFirst<T extends TimestampedEvent>(
  events: readonly T[],
) {
  return [...events].sort(compareEventsNewestFirst);
}
