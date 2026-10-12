import Link from "next/link";

/** Kinpot monogram. */
export function LogoMark({ className = "size-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="6.5" className="fill-accent" />
      <g className="stroke-on-accent" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" fill="none">
        <path d="M8.5 6.7v10.6" />
        <path d="M16.3 6.9 8.5 12.5l7.8 4.9" />
      </g>
    </svg>
  );
}

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2" aria-label="Kinpot home">
      <LogoMark />
      <span className="font-display text-[17px] font-semibold tracking-[-0.02em]">kinpot</span>
    </Link>
  );
}
