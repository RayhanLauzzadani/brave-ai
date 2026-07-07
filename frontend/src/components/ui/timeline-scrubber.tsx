"use client";

import React, { useState, useRef, useEffect, MouseEvent as ReactMouseEvent } from 'react';
import { cn } from "@/lib/utils";

interface IncidentMarker {
  id: string;
  time: string; // e.g. "10:15"
  description: string;
}

interface TimelineScrubberProps {
  markers?: IncidentMarker[];
  initialTime?: string; // e.g. "08:00"
  onTimeChange?: (time: string) => void;
  className?: string;
}

export function TimelineScrubber({ markers = [], initialTime = "00:00", onTimeChange, className }: TimelineScrubberProps) {
  const [currentTimeSec, setCurrentTimeSec] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [hoveredMarker, setHoveredMarker] = useState<IncidentMarker | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Convert HH:MM to seconds
  const timeToSeconds = (timeStr: string) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return (hours * 3600) + (minutes * 60);
  };

  // Convert seconds to HH:MM
  const secondsToTime = (seconds: number) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setCurrentTimeSec(timeToSeconds(initialTime));
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [initialTime]);

  const totalSeconds = 24 * 3600;
  const progressPercent = (currentTimeSec / totalSeconds) * 100;

  const handleInteract = (clientX: number) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = x / rect.width;
    const newSeconds = Math.round(percent * totalSeconds);
    setCurrentTimeSec(newSeconds);
    if (onTimeChange) {
      onTimeChange(secondsToTime(newSeconds));
    }
  };

  const onMouseDown = (e: ReactMouseEvent) => {
    setIsDragging(true);
    handleInteract(e.clientX);
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        handleInteract(e.clientX);
      }
    };
    const onMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging]);

  const handleMarkerClick = (marker: IncidentMarker, e: ReactMouseEvent) => {
    e.stopPropagation();
    const sec = timeToSeconds(marker.time);
    setCurrentTimeSec(sec);
    if (onTimeChange) {
      onTimeChange(marker.time);
    }
  };

  return (
    <div className={cn("w-full select-none", className)}>
      {/* Time labels */}
      <div className="flex justify-between text-[10px] text-slate-400 font-medium mb-1 px-0.5">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
      
      {/* Track area */}
      <div 
        className="relative h-8 flex items-center group cursor-pointer"
        ref={trackRef}
        onMouseDown={onMouseDown}
      >
        {/* Background Track — neutral gray, no blue fill */}
        <div className="absolute w-full h-1.5 bg-slate-200 rounded-full" />

        {/* Hour tick marks */}
        <div className="absolute w-full h-full pointer-events-none flex justify-between">
          {Array.from({ length: 25 }).map((_, i) => (
            <div key={i} className="h-1.5 w-px bg-slate-300/60 self-center" />
          ))}
        </div>

        {/* Incident Markers (red dots) */}
        {markers.map((marker) => {
          const markerPercent = (timeToSeconds(marker.time) / totalSeconds) * 100;
          return (
            <div
              key={marker.id}
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10"
              style={{ left: `${markerPercent}%` }}
              onMouseEnter={() => setHoveredMarker(marker)}
              onMouseLeave={() => setHoveredMarker(null)}
              onClick={(e) => handleMarkerClick(marker, e)}
            >
              <div className="w-3 h-3 bg-red-500 border-2 border-white rounded-full shadow hover:scale-150 hover:bg-red-600 transition-transform cursor-pointer animate-pulse" />
              
              {/* Tooltip */}
              {hoveredMarker?.id === marker.id && (
                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-max max-w-[180px] z-50">
                  <div className="bg-slate-900 text-white text-[11px] p-2 rounded-lg shadow-lg">
                    <div className="font-bold text-red-400 mb-0.5">{marker.time}</div>
                    <div className="whitespace-normal leading-snug">{marker.description}</div>
                  </div>
                  <div className="w-0 h-0 border-l-[5px] border-l-transparent border-r-[5px] border-r-transparent border-t-[5px] border-t-slate-900 mx-auto" />
                </div>
              )}
            </div>
          );
        })}

        {/* Current position indicator — thin vertical line */}
        <div 
          className="absolute top-0 bottom-0 w-px bg-slate-600/40 pointer-events-none"
          style={{ left: `${progressPercent}%` }}
        />

        {/* Draggable Thumb — small white circle */}
        <div 
          className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3.5 h-3.5 bg-white border-2 border-slate-400 rounded-full shadow z-20 group-hover:scale-125 group-hover:border-slate-600 transition-all"
          style={{ left: `${progressPercent}%` }}
        />
      </div>

      {/* Current time badge */}
      <div className="text-center mt-1.5">
        <span className="inline-flex items-center justify-center px-2.5 py-0.5 bg-slate-100 text-slate-600 font-semibold text-[11px] rounded-md border border-slate-200">
          {secondsToTime(currentTimeSec)}
        </span>
      </div>
    </div>
  );
}
