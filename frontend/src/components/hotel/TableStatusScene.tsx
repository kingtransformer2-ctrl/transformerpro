import { UserRound } from "lucide-react";
import type { HotelTableStatus } from "@/types/hotel";
import { cn } from "@/lib/utils";

function getScenePalette(status: HotelTableStatus) {
  if (status === "occupied") {
    return {
      bg: "#fff1f2",
      stroke: "#1f2937",
      accent: "#fb7185",
      accentSoft: "#fecdd3",
    };
  }

  if (status === "reserved") {
    return {
      bg: "#fffbeb",
      stroke: "#1f2937",
      accent: "#f59e0b",
      accentSoft: "#fde68a",
    };
  }

  if (status === "cleaning") {
    return {
      bg: "#f8fafc",
      stroke: "#334155",
      accent: "#94a3b8",
      accentSoft: "#e2e8f0",
    };
  }

  return {
    bg: "#f0fdf4",
    stroke: "#1f2937",
    accent: "#22c55e",
    accentSoft: "#bbf7d0",
  };
}

type TableStatusSceneProps = {
  capacity: number;
  status: HotelTableStatus;
  hasWaiter: boolean;
  className?: string;
  svgClassName?: string;
};

export function TableStatusScene({
  capacity,
  status,
  hasWaiter,
  className,
  svgClassName,
}: TableStatusSceneProps) {
  const palette = getScenePalette(status);
  const placeSettings = Math.min(Math.max(Math.ceil(capacity / 2), 1), 4);

  return (
    <div className={cn("relative mx-auto w-full max-w-[260px]", className)}>
      <svg viewBox="0 0 260 180" className={cn("h-[180px] w-full", svgClassName)}>
        <rect x="34" y="18" width="192" height="126" rx="32" fill={palette.bg} />
        <ellipse cx="130" cy="146" rx="66" ry="10" fill={palette.accentSoft} opacity="0.9" />

        <g stroke={palette.stroke} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" fill="none">
          <path d="M54 112 L48 74" />
          <path d="M72 112 L78 74" />
          <path d="M44 72 H82" />
          <path d="M58 92 H68" />

          <path d="M206 112 L200 74" />
          <path d="M188 112 L194 74" />
          <path d="M178 72 H216" />
          <path d="M192 92 H202" />

          <path d="M88 70 H172" />
          <path d="M96 70 L92 112" />
          <path d="M164 70 L168 112" />
          <path d="M108 112 H152" />

          <path d="M126 48 H134" />
          <path d="M130 48 V62" />
          <path d="M116 64 H144" />

          <path d="M112 62 C116 54, 124 50, 130 50 C136 50, 144 54, 148 62" />
          <path d="M114 62 H146" />
          <path d="M130 62 V70" />
        </g>

        <rect x="98" y="70" width="64" height="10" rx="5" fill={palette.accent} />
        <rect x="104" y="80" width="52" height="8" rx="4" fill={palette.accentSoft} />

        {Array.from({ length: placeSettings }).map((_, index) => {
          const x = 104 + index * 18;
          return (
            <g key={index}>
              <circle cx={x} cy={62} r="3" fill={palette.stroke} opacity="0.9" />
              <rect x={x - 5} y={58} width="10" height="2.5" rx="1.25" fill={palette.stroke} opacity="0.9" />
            </g>
          );
        })}
      </svg>

      {hasWaiter && (
        <div className="absolute bottom-3 right-3 flex h-10 w-10 items-center justify-center rounded-full border border-white/80 bg-white/90 text-primary shadow-[0_16px_30px_rgba(15,23,42,0.18)]">
          <UserRound className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}
