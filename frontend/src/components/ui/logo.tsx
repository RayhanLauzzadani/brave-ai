import React from "react";

export function BraveLogo({ className, size = 40 }: { className?: string; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 512 512"
      fill="none"
      className={className}
    >
      <defs>
        <linearGradient id="shieldGrad" x1="64" y1="32" x2="448" y2="501.3" gradientUnits="userSpaceOnUse">
          <stop stopColor="#064eb7" />
          <stop offset="1" stopColor="#1b64f2" />
        </linearGradient>
        <linearGradient id="eyeGrad" x1="161" y1="150" x2="351" y2="340" gradientUnits="userSpaceOnUse">
          <stop stopColor="#3b82f6" />
          <stop offset="1" stopColor="#93c5fd" />
        </linearGradient>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="8" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      {/* Main Shield Background */}
      <path
        d="M256 32L64 96V224C64 353.6 145.4 472.5 256 501.3C366.6 472.5 448 353.6 448 224V96L256 32Z"
        fill="url(#shieldGrad)"
      />

      {/* Shield Inner Cutout (White) */}
      <path
        d="M256 75L106 125V224C106 321 166 410 256 432C346 410 406 321 406 224V125L256 75Z"
        fill="white"
      />

      {/* Camera Outer Ring (AI Tech Vibe) */}
      <circle cx="256" cy="245" r="95" stroke="#064eb7" strokeWidth="20" strokeLinecap="round" strokeDasharray="90 30" />

      {/* Inner Camera Eye */}
      <circle cx="256" cy="245" r="55" fill="url(#eyeGrad)" />

      {/* Glowing AI Core Node */}
      <circle cx="256" cy="245" r="25" fill="white" filter="url(#glow)" />

      {/* Circuit Nodes (Bottom left & Top right) */}
      <circle cx="165" cy="335" r="14" fill="#064eb7" />
      <path d="M165 335 L200 300" stroke="#064eb7" strokeWidth="8" strokeLinecap="round" />

      <circle cx="347" cy="155" r="14" fill="#064eb7" />
      <path d="M347 155 L312 190" stroke="#064eb7" strokeWidth="8" strokeLinecap="round" />
    </svg>
  );
}
