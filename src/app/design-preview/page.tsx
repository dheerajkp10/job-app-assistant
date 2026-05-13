'use client';

import {
  Sparkles, Target, Briefcase, MapPin, DollarSign, Download, Loader2,
  Check, X, AlertTriangle, CheckCircle2, ExternalLink, FileText, Calendar,
  ChevronRight, Users, Filter, Search, Tag,
} from 'lucide-react';

/**
 * Design preview — a live sandbox of the proposed light-shade-first
 * design system. Not linked from the app nav; navigate manually to
 * /design-preview to compare against the current UI.
 *
 * Three accent options are rendered side-by-side near the top so you
 * can pick the one you like. Everything else (cards / buttons /
 * chips / inputs / modal / score rings) uses the Indigo→Violet
 * accent by default — swap the `accent` constant below to see the
 * page rendered in another option.
 */

type AccentName = 'indigo-violet' | 'teal-cyan' | 'emerald-lime' | 'rose-peach';

const ACCENT_TOKENS: Record<AccentName, {
  // Tailwind gradient classes for primary buttons
  gradient: string;
  gradientHover: string;
  shadow: string;
  shadowHover: string;
  // Solid + soft variants
  solid: string;
  soft: string;
  softText: string;
  softBorder: string;
  softHover: string;
  // Ring (focus)
  ring: string;
}> = {
  'indigo-violet': {
    gradient: 'from-indigo-500 to-violet-500',
    gradientHover: 'from-indigo-600 to-violet-600',
    shadow: 'shadow-indigo-500/20',
    shadowHover: 'shadow-indigo-500/30',
    solid: 'bg-indigo-500',
    soft: 'bg-indigo-50',
    softText: 'text-indigo-700',
    softBorder: 'border-indigo-100',
    softHover: 'hover:bg-indigo-100',
    ring: 'ring-indigo-200',
  },
  'teal-cyan': {
    gradient: 'from-teal-500 to-cyan-500',
    gradientHover: 'from-teal-600 to-cyan-600',
    shadow: 'shadow-teal-500/20',
    shadowHover: 'shadow-teal-500/30',
    solid: 'bg-teal-500',
    soft: 'bg-teal-50',
    softText: 'text-teal-700',
    softBorder: 'border-teal-100',
    softHover: 'hover:bg-teal-100',
    ring: 'ring-teal-200',
  },
  'emerald-lime': {
    gradient: 'from-emerald-500 to-lime-500',
    gradientHover: 'from-emerald-600 to-lime-600',
    shadow: 'shadow-emerald-500/20',
    shadowHover: 'shadow-emerald-500/30',
    solid: 'bg-emerald-500',
    soft: 'bg-emerald-50',
    softText: 'text-emerald-700',
    softBorder: 'border-emerald-100',
    softHover: 'hover:bg-emerald-100',
    ring: 'ring-emerald-200',
  },
  'rose-peach': {
    gradient: 'from-rose-400 to-orange-400',
    gradientHover: 'from-rose-500 to-orange-500',
    shadow: 'shadow-rose-400/20',
    shadowHover: 'shadow-rose-400/30',
    solid: 'bg-rose-400',
    soft: 'bg-rose-50',
    softText: 'text-rose-700',
    softBorder: 'border-rose-100',
    softHover: 'hover:bg-rose-100',
    ring: 'ring-rose-200',
  },
};

// ─── Top-level page ──────────────────────────────────────────────────

export default function DesignPreviewPage() {
  return (
    <div
      className="min-h-screen text-slate-700"
      style={{ backgroundColor: '#F8FAFC' }} /* cool off-white */
    >
      {/* Top nav preview */}
      <PreviewNav />

      <main className="max-w-6xl mx-auto px-8 py-10 space-y-12">
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100">
            <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-xs font-medium text-indigo-700">Design system preview</span>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-800">
            Light-shade design refresh
          </h1>
          <p className="text-sm text-slate-500 max-w-2xl">
            Mock-up of the proposed look. Use this to compare against the live UI before approving. The accent rows below show every primary color option side-by-side; the rest of the page is rendered in <strong className="text-slate-700">Indigo→Violet</strong> (my default suggestion).
          </p>
        </header>

        <Section title="Pick a primary accent" subtitle="Same button, rendered in each candidate accent. Tell me which to roll forward.">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {(Object.keys(ACCENT_TOKENS) as AccentName[]).map((name) => (
              <AccentSwatch key={name} name={name} />
            ))}
          </div>
        </Section>

        <Section title="Buttons" subtitle="Three tiers: primary (gradient pill), secondary (soft tint), ghost (text + hover bg). Add danger as a 4th for destructive actions.">
          <div className="flex flex-wrap items-center gap-3">
            <PrimaryButton>Generate Master Resume</PrimaryButton>
            <PrimaryButton loading>Generating…</PrimaryButton>
            <SecondaryButton>Download DOCX</SecondaryButton>
            <GhostButton>Cancel</GhostButton>
            <DangerButton>Clear all</DangerButton>
          </div>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <PrimaryButton icon={<Download className="w-4 h-4" />}>Download Tailored Resume</PrimaryButton>
            <SecondaryButton icon={<FileText className="w-4 h-4" />}>Tailor My Resume</SecondaryButton>
            <GhostButton icon={<ChevronRight className="w-4 h-4" />}>View all</GhostButton>
          </div>
        </Section>

        <Section title="Cards" subtitle="Lighter borders (slate-100), subtle resting shadow, lifts on hover with a tinted glow.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCardPreview icon={Target} label="Avg ATS Score" value="68%" sub="Across 142 listings" accent="indigo" />
            <StatCardPreview icon={Briefcase} label="Strong matches" value="34" sub="≥ 70% match" accent="emerald" />
            <StatCardPreview icon={Users} label="Network reach" value="289" sub="LinkedIn connections" accent="violet" />
          </div>
        </Section>

        <Section title="Score rings" subtitle="Per-tier gradient instead of flat fill. Background trail is slate-100 (no harsh gray).">
          <div className="flex items-center gap-10 flex-wrap">
            <GradientScoreRing score={82} label="Strong" tier="high" />
            <GradientScoreRing score={58} label="Moderate" tier="mid" />
            <GradientScoreRing score={34} label="Weak" tier="low" />
          </div>
        </Section>

        <Section title="Chips / badges" subtitle="Soft pastel pills. Used for tags, statuses, score deltas.">
          <div className="flex flex-wrap items-center gap-2">
            <Chip color="indigo">Engineering Manager</Chip>
            <Chip color="emerald" icon={<CheckCircle2 className="w-3 h-3" />}>Applied</Chip>
            <Chip color="amber" icon={<Calendar className="w-3 h-3" />}>Posted today</Chip>
            <Chip color="violet" icon={<Sparkles className="w-3 h-3" />}>New</Chip>
            <Chip color="rose" icon={<X className="w-3 h-3" />}>Rejected</Chip>
            <Chip color="slate">Remote</Chip>
            <Chip color="cyan" icon={<DollarSign className="w-3 h-3" />}>$210k – $290k</Chip>
            <Chip color="indigo" icon={<Users className="w-3 h-3" />}>3 you know</Chip>
          </div>
        </Section>

        <Section title="Listing card" subtitle="Refreshed example of a job card from the listings page.">
          <ListingCardPreview />
        </Section>

        <Section title="Form inputs" subtitle="Lighter borders, soft focus ring, no harsh shadows.">
          <div className="grid md:grid-cols-2 gap-3 max-w-2xl">
            <InputPreview placeholder="Search listings…" icon={<Search className="w-4 h-4" />} />
            <InputPreview placeholder="Filter by company…" icon={<Filter className="w-4 h-4" />} />
            <SelectPreview />
            <ToggleRow />
          </div>
        </Section>

        <Section title="Status callouts" subtitle="Three semantic tones with light backgrounds. No alarm-red.">
          <div className="space-y-3 max-w-2xl">
            <Callout tone="success">
              <strong>Fit applied:</strong> margins 0.4&quot;, line height 1.05, body 10pt.
            </Callout>
            <Callout tone="warn">
              <strong>Couldn&apos;t fit on 1 page.</strong> Applied max compression but the result is still &gt; 1 page. Best-effort download served.
            </Callout>
            <Callout tone="error">
              <strong>Couldn&apos;t generate.</strong> No resume uploaded. Add a .docx in Settings first.
            </Callout>
          </div>
        </Section>

        <Section title="Modal preview" subtitle="Glass effect on the overlay, white card body, soft shadow.">
          <FakeModal />
        </Section>

        <Section title="Score-tier legend" subtitle="What gradient fires at what score band — applies to score rings, score chips, the dashboard donut.">
          <div className="grid grid-cols-3 gap-3 max-w-3xl">
            <TierLegend color="emerald" label="Strong" range="≥ 70%" />
            <TierLegend color="amber" label="Moderate" range="50–69%" />
            <TierLegend color="rose" label="Weak" range="&lt; 50%" />
          </div>
        </Section>

        <footer className="pt-8 mt-12 border-t border-slate-100 text-xs text-slate-400">
          Once you pick an accent + page background + scope, I&apos;ll start swapping these classes into the real components. No structure changes — just the look.
        </footer>
      </main>
    </div>
  );
}

// ─── Building blocks ─────────────────────────────────────────────────

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-800">{title}</h2>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function PreviewNav() {
  const links = ['Dashboard', 'Listings', 'Pipeline', 'Compare', 'Add Job', 'Settings'];
  const active = 'Dashboard';
  return (
    <nav className="sticky top-0 z-30 backdrop-blur-md bg-white/70 border-b border-slate-100">
      <div className="max-w-6xl mx-auto px-8 h-14 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-500 flex items-center justify-center shadow-md shadow-indigo-500/20">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <span className="text-sm font-semibold text-slate-800">Job App Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          {links.map((l) => (
            <button
              key={l}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                l === active
                  ? 'bg-indigo-50 text-indigo-700'
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button className="px-3 py-1.5 rounded-full text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100">
            Refresh
          </button>
        </div>
      </div>
    </nav>
  );
}

function AccentSwatch({ name }: { name: AccentName }) {
  const tokens = ACCENT_TOKENS[name];
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className="text-[11px] uppercase tracking-wide text-slate-400 mb-3">{name}</div>
      <button
        className={`w-full bg-gradient-to-r ${tokens.gradient} text-white font-semibold px-4 py-2 rounded-xl shadow-md ${tokens.shadow} transition-all duration-200 hover:shadow-lg hover:${tokens.shadowHover} hover:-translate-y-0.5 active:translate-y-0`}
      >
        Primary CTA
      </button>
      <div className="flex items-center gap-1.5 mt-2 flex-wrap">
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${tokens.soft} ${tokens.softText} border ${tokens.softBorder}`}>
          chip
        </span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${tokens.solid} text-white`}>
          solid
        </span>
        <span className={`text-[10px] font-medium ${tokens.softText}`}>link</span>
      </div>
    </div>
  );
}

// ─── Buttons ─────────────────────────────────────────────────────────

function PrimaryButton({ children, loading, icon }: { children: React.ReactNode; loading?: boolean; icon?: React.ReactNode }) {
  return (
    <button
      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-indigo-500 to-violet-500 shadow-md shadow-indigo-500/20 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/30 hover:-translate-y-0.5 active:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2 disabled:opacity-60"
      disabled={loading}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

function SecondaryButton({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-indigo-700 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 hover:border-indigo-200 transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-200 focus-visible:ring-offset-2">
      {icon}
      {children}
    </button>
  );
}

function GhostButton({ children, icon }: { children: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl font-medium text-sm text-slate-600 hover:bg-slate-100 hover:text-slate-800 transition-all duration-200">
      {icon}
      {children}
    </button>
  );
}

function DangerButton({ children }: { children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-sm text-rose-700 bg-rose-50 border border-rose-100 hover:bg-rose-100 hover:border-rose-200 transition-all duration-200">
      {children}
    </button>
  );
}

// ─── Cards ───────────────────────────────────────────────────────────

const STAT_ACCENT: Record<string, { bg: string; text: string; ring: string }> = {
  indigo:  { bg: 'bg-indigo-50',  text: 'text-indigo-600',  ring: 'ring-indigo-100/80' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', ring: 'ring-emerald-100/80' },
  violet:  { bg: 'bg-violet-50',  text: 'text-violet-600',  ring: 'ring-violet-100/80' },
  amber:   { bg: 'bg-amber-50',   text: 'text-amber-600',   ring: 'ring-amber-100/80' },
};

function StatCardPreview({
  icon: Icon, label, value, sub, accent,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  accent: keyof typeof STAT_ACCENT;
}) {
  const a = STAT_ACCENT[accent];
  return (
    <div className="group bg-white border border-slate-100 rounded-2xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_24px_rgba(99,102,241,0.08)] hover:-translate-y-0.5 transition-all duration-200">
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-9 h-9 rounded-xl ${a.bg} ring-4 ${a.ring} flex items-center justify-center`}>
          <Icon className={`w-4.5 h-4.5 ${a.text}`} />
        </div>
        <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      </div>
      <div className="text-3xl font-bold text-slate-800 tracking-tight">{value}</div>
      <div className="text-xs text-slate-400 mt-1">{sub}</div>
    </div>
  );
}

// ─── Score ring with gradient ────────────────────────────────────────

function GradientScoreRing({ score, label, tier }: { score: number; label: string; tier: 'high' | 'mid' | 'low' }) {
  const size = 110;
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const gradientId = `g-${tier}`;
  const colorPair =
    tier === 'high' ? ['#10B981', '#14B8A6'] :
    tier === 'mid'  ? ['#FBBF24', '#FB923C'] :
                      ['#FB7185', '#F472B6'];
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <defs>
            <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={colorPair[0]} />
              <stop offset="100%" stopColor={colorPair[1]} />
            </linearGradient>
          </defs>
          <circle cx={size / 2} cy={size / 2} r={radius} stroke="#F1F5F9" strokeWidth="8" fill="none" />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            stroke={`url(#${gradientId})`} strokeWidth="8" fill="none"
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-bold text-slate-800">{score}%</span>
        </div>
      </div>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  );
}

// ─── Chips ───────────────────────────────────────────────────────────

const CHIP_COLORS: Record<string, string> = {
  indigo:  'bg-indigo-50 text-indigo-700 border-indigo-100',
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  amber:   'bg-amber-50 text-amber-700 border-amber-100',
  violet:  'bg-violet-50 text-violet-700 border-violet-100',
  rose:    'bg-rose-50 text-rose-700 border-rose-100',
  cyan:    'bg-cyan-50 text-cyan-700 border-cyan-100',
  slate:   'bg-slate-50 text-slate-600 border-slate-200',
};

function Chip({ children, color, icon }: { children: React.ReactNode; color: keyof typeof CHIP_COLORS; icon?: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium border ${CHIP_COLORS[color]}`}>
      {icon}
      {children}
    </span>
  );
}

// ─── Listing card ────────────────────────────────────────────────────

function ListingCardPreview() {
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-5 shadow-[0_1px_3px_rgba(15,23,42,0.04)] hover:shadow-[0_8px_24px_rgba(99,102,241,0.08)] hover:-translate-y-0.5 transition-all duration-200 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-slate-800 text-base">Senior Engineering Manager, Platform</h3>
            <Chip color="violet" icon={<Sparkles className="w-3 h-3" />}>New</Chip>
          </div>
          <div className="flex items-center gap-2 mb-2 flex-wrap text-sm">
            <span className="font-medium text-slate-700">Stripe</span>
            <span className="text-xs text-slate-400">· Infrastructure</span>
            <Chip color="indigo" icon={<Users className="w-3 h-3" />}>3 you know</Chip>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> Seattle, WA · Remote</span>
            <span className="flex items-center gap-1 text-emerald-600 font-medium"><DollarSign className="w-3 h-3" /> $260k – $340k</span>
            <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> Posted 2 days ago</span>
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-3">
          <span className="inline-flex items-center px-3 py-1.5 rounded-xl text-sm font-bold border border-emerald-100 bg-emerald-50 text-emerald-700">
            82%
          </span>
          <button className="p-2 rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
            <Tag className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inputs ──────────────────────────────────────────────────────────

function InputPreview({ placeholder, icon }: { placeholder: string; icon?: React.ReactNode }) {
  return (
    <div className="relative">
      {icon && (
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
          {icon}
        </div>
      )}
      <input
        type="text"
        placeholder={placeholder}
        className={`w-full ${icon ? 'pl-10' : 'pl-4'} pr-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 transition-all`}
      />
    </div>
  );
}

function SelectPreview() {
  return (
    <select className="w-full px-4 py-2.5 rounded-xl bg-white border border-slate-200 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300">
      <option>Engineering Manager</option>
      <option>Staff Engineer</option>
      <option>Director of Engineering</option>
    </select>
  );
}

function ToggleRow() {
  return (
    <label className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-white border border-slate-200 cursor-pointer hover:border-slate-300 transition-colors">
      <span className="text-sm text-slate-700">Remote OK</span>
      <span className="relative w-10 h-6 rounded-full bg-indigo-500 transition-colors">
        <span className="absolute top-0.5 left-[18px] w-5 h-5 rounded-full bg-white shadow-sm transition-all" />
      </span>
    </label>
  );
}

// ─── Callouts ────────────────────────────────────────────────────────

function Callout({ tone, children }: { tone: 'success' | 'warn' | 'error'; children: React.ReactNode }) {
  const styles = {
    success: { bg: 'bg-emerald-50', border: 'border-emerald-100', text: 'text-emerald-800', Icon: CheckCircle2, iconColor: 'text-emerald-500' },
    warn:    { bg: 'bg-amber-50',   border: 'border-amber-100',   text: 'text-amber-800',   Icon: AlertTriangle, iconColor: 'text-amber-500' },
    error:   { bg: 'bg-rose-50',    border: 'border-rose-100',    text: 'text-rose-800',    Icon: AlertTriangle, iconColor: 'text-rose-500' },
  }[tone];
  const Icon = styles.Icon;
  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl ${styles.bg} border ${styles.border}`}>
      <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${styles.iconColor}`} />
      <p className={`text-sm ${styles.text}`}>{children}</p>
    </div>
  );
}

// ─── Modal preview ───────────────────────────────────────────────────

function FakeModal() {
  return (
    <div className="relative h-[420px] rounded-2xl overflow-hidden bg-slate-100/60">
      {/* Glass overlay */}
      <div className="absolute inset-0 backdrop-blur-md bg-white/40" />
      {/* Card */}
      <div className="absolute inset-0 flex items-center justify-center p-6">
        <div className="bg-white border border-slate-100 rounded-2xl shadow-[0_24px_60px_rgba(15,23,42,0.12)] w-full max-w-md overflow-hidden">
          <div className="p-5 border-b border-slate-100">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-indigo-500" />
              <h3 className="text-lg font-semibold text-slate-800">Generate Master Resume</h3>
            </div>
            <p className="text-xs text-slate-500 mt-1">Analyzes every listing matching your preferences and picks the best keywords.</p>
          </div>
          <div className="p-5 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Listings analyzed</span>
              <span className="font-semibold text-slate-700">47</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Auto-picked keywords</span>
              <span className="font-semibold text-indigo-700">30</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500">Avg ATS uplift</span>
              <span className="font-semibold text-emerald-600">+18%</span>
            </div>
          </div>
          <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex justify-end gap-2">
            <GhostButton>Cancel</GhostButton>
            <PrimaryButton icon={<Download className="w-4 h-4" />}>Download</PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tier legend ─────────────────────────────────────────────────────

const TIER_LEGEND_COLOR: Record<string, { gradient: string; ring: string; text: string }> = {
  emerald: { gradient: 'from-emerald-400 to-teal-400', ring: 'ring-emerald-100', text: 'text-emerald-700' },
  amber:   { gradient: 'from-amber-400 to-orange-400', ring: 'ring-amber-100',   text: 'text-amber-700' },
  rose:    { gradient: 'from-rose-400 to-pink-400',    ring: 'ring-rose-100',    text: 'text-rose-700' },
};

function TierLegend({ color, label, range }: { color: keyof typeof TIER_LEGEND_COLOR; label: string; range: string }) {
  const c = TIER_LEGEND_COLOR[color];
  return (
    <div className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center gap-3 shadow-[0_1px_3px_rgba(15,23,42,0.04)]">
      <div className={`w-10 h-10 rounded-full bg-gradient-to-br ${c.gradient} ring-4 ${c.ring}`} />
      <div>
        <div className={`text-sm font-semibold ${c.text}`}>{label}</div>
        <div className="text-xs text-slate-500" dangerouslySetInnerHTML={{ __html: range }} />
      </div>
    </div>
  );
}
