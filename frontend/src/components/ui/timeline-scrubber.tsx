'use client';

import React, {
  PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from 'react';
import { cn } from '@/lib/utils';

interface IncidentMarker {
  id: string;
  offsetSeconds: number;
  label: string;
  description: string;
}

export interface TimelineAvailableRange {
  id: string;
  startOffsetSeconds: number;
  endOffsetSeconds: number;
  label?: string;
}

interface TimelineScrubberProps {
  durationSeconds: number;
  currentSeconds?: number;
  startTime?: string;
  markers?: IncidentMarker[];
  availableRanges?: TimelineAvailableRange[];
  onTimeChange?: (seconds: number) => void;
  className?: string;
}

export function TimelineScrubber({
  durationSeconds,
  currentSeconds = 0,
  startTime,
  markers = [],
  availableRanges = [],
  onTimeChange,
  className,
}: TimelineScrubberProps) {
  const totalSeconds = Math.max(1, durationSeconds);
  const [dragSeconds, setDragSeconds] = useState<number | null>(null);
  const [activePointerId, setActivePointerId] = useState<number | null>(null);
  const [hoveredMarker, setHoveredMarker] = useState<IncidentMarker | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  const currentTimeSec =
    dragSeconds ?? clampSeconds(currentSeconds, totalSeconds);
  const progressPercent = (currentTimeSec / totalSeconds) * 100;
  const axisOffsets = [0, 0.25, 0.5, 0.75, 1].map(
    (ratio) => totalSeconds * ratio,
  );

  const handleInteract = (clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const nextSeconds = Math.round((x / rect.width) * totalSeconds);
    setDragSeconds(nextSeconds);
    onTimeChange?.(nextSeconds);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setActivePointerId(event.pointerId);
    handleInteract(event.clientX);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (activePointerId !== event.pointerId) return;
    handleInteract(event.clientX);
  };

  const finishPointerInteraction = (
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (activePointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setActivePointerId(null);
    setDragSeconds(null);
  };

  const handleMarkerClick = (
    marker: IncidentMarker,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => {
    event.stopPropagation();
    const seconds = clampSeconds(marker.offsetSeconds, totalSeconds);
    onTimeChange?.(seconds);
  };

  return (
    <div className={cn('w-full select-none', className)}>
      <div className='grid grid-cols-5 px-0.5 text-[9px] font-medium text-slate-400 pwa:text-[10px]'>
        {axisOffsets.map((seconds, index) => (
          <span
            key={seconds}
            className={cn(
              index === 0 && 'text-left',
              index > 0 && index < axisOffsets.length - 1 && 'text-center',
              index === axisOffsets.length - 1 && 'text-right',
            )}
          >
            {formatAxisTime(startTime, seconds)}
          </span>
        ))}
      </div>

      <div
        className='group relative flex h-9 touch-none cursor-pointer items-center'
        ref={trackRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
      >
        <div className='absolute h-1.5 w-full rounded-full bg-slate-200' />

        {availableRanges.map((range) => {
          const startSecond = clampSeconds(
            range.startOffsetSeconds,
            totalSeconds,
          );
          const endSecond = Math.max(
            startSecond,
            clampSeconds(range.endOffsetSeconds, totalSeconds),
          );
          const left = (startSecond / totalSeconds) * 100;
          const width = Math.max(
            0.25,
            ((endSecond - startSecond) / totalSeconds) * 100,
          );

          return (
            <div
              key={range.id}
              className='absolute h-2 rounded-full bg-blue-500/70 shadow-sm shadow-blue-500/20'
              style={{ left: left + '%', width: width + '%' }}
              title={range.label}
            />
          );
        })}

        <div className='pointer-events-none absolute flex h-full w-full justify-between'>
          {Array.from({ length: 25 }).map((_, index) => (
            <div
              key={index}
              className='h-1.5 w-px self-center bg-slate-300/60'
            />
          ))}
        </div>

        {markers.map((marker) => {
          const markerSeconds = clampSeconds(
            marker.offsetSeconds,
            totalSeconds,
          );
          const markerPercent = (markerSeconds / totalSeconds) * 100;
          return (
            <button
              type='button'
              key={marker.id}
              className='absolute top-1/2 z-10 -translate-x-1/2 -translate-y-1/2'
              style={{ left: markerPercent + '%' }}
              onPointerEnter={() => setHoveredMarker(marker)}
              onPointerLeave={() => setHoveredMarker(null)}
              onPointerDown={(event) => event.stopPropagation()}
              onPointerUp={(event) => handleMarkerClick(marker, event)}
              aria-label={'Buka indikasi pada ' + marker.label}
            >
              <span className='block h-3 w-3 rounded-full border-2 border-white bg-red-500 shadow transition-transform hover:scale-150 hover:bg-red-600' />

              {hoveredMarker?.id === marker.id && (
                <span className='absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[180px] -translate-x-1/2'>
                  <span className='block rounded-lg bg-slate-900 p-2 text-left text-[11px] text-white shadow-lg'>
                    <span className='mb-0.5 block font-bold text-red-400'>
                      {marker.label}
                    </span>
                    <span className='block whitespace-normal leading-snug'>
                      {marker.description}
                    </span>
                  </span>
                  <span className='mx-auto block h-0 w-0 border-l-[5px] border-r-[5px] border-t-[5px] border-l-transparent border-r-transparent border-t-slate-900' />
                </span>
              )}
            </button>
          );
        })}

        <div
          className='pointer-events-none absolute bottom-0 top-0 w-px bg-slate-600/40'
          style={{ left: progressPercent + '%' }}
        />

        <div
          className='pointer-events-none absolute top-1/2 z-20 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-400 bg-white shadow transition-all group-hover:scale-125 group-hover:border-slate-600'
          style={{ left: progressPercent + '%' }}
        />
      </div>

      <div className='mt-1 text-center'>
        <span className='inline-flex items-center justify-center rounded-md border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-[11px] font-semibold text-slate-600'>
          {formatSelectedTime(startTime, currentTimeSec)}
        </span>
      </div>
    </div>
  );
}

function clampSeconds(value: number, durationSeconds: number) {
  return Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), durationSeconds);
}

function formatAxisTime(startTime: string | undefined, offsetSeconds: number) {
  const date = getOffsetDate(startTime, offsetSeconds);
  if (!date) return formatElapsed(offsetSeconds);
  return (
    String(date.getDate()).padStart(2, '0')
    + '/'
    + String(date.getMonth() + 1).padStart(2, '0')
    + ' '
    + formatClock(date)
  );
}

function formatSelectedTime(
  startTime: string | undefined,
  offsetSeconds: number,
) {
  const date = getOffsetDate(startTime, offsetSeconds);
  if (!date) return formatElapsed(offsetSeconds);
  return (
    String(date.getDate()).padStart(2, '0')
    + '/'
    + String(date.getMonth() + 1).padStart(2, '0')
    + '/'
    + date.getFullYear()
    + ' '
    + formatClock(date, true)
  );
}

function getOffsetDate(startTime: string | undefined, offsetSeconds: number) {
  if (!startTime) return null;
  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + offsetSeconds * 1000);
}

function formatClock(date: Date, includeSeconds = false) {
  const value = [
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ];
  if (includeSeconds) value.push(String(date.getSeconds()).padStart(2, '0'));
  return value.join(':');
}

function formatElapsed(totalSeconds: number) {
  const safeSeconds = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, '0'))
    .join(':');
}
