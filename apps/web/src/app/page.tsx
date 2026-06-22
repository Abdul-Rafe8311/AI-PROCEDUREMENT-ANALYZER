import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Clock,
  CreditCard,
  FileText,
  LayoutDashboard,
  MessageSquare,
  ScanText,
  ShieldAlert,
  Sparkles,
  Table2,
  TrendingUp,
  Trophy,
  Truck,
  Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { MacbookScroll } from '@/components/landing/macbook-scroll';
import { Reveal } from '@/components/landing/reveal';

/* ─────────────────────────────────────────────
   Shared button styles (no auth UI on this page)
   ───────────────────────────────────────────── */
const btnPrimary =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
const btnSecondary =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-6 py-3 text-sm font-semibold text-foreground shadow-sm transition hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

/* ─────────────────────────────────────────────
   Data
   ───────────────────────────────────────────── */
const steps = [
  {
    n: '01',
    icon: Upload,
    title: 'Upload Supplier Quotations',
    desc: 'Drag and drop PDF, DOCX, PNG, or JPG files from every supplier — no formatting required.',
  },
  {
    n: '02',
    icon: ScanText,
    title: 'AI Extracts Data',
    desc: 'Automatically pull supplier name, price, delivery time, payment terms, warranty, and currency.',
  },
  {
    n: '03',
    icon: Table2,
    title: 'Compare Suppliers',
    desc: 'See every quotation side by side in a sortable, filterable comparison table.',
  },
  {
    n: '04',
    icon: Sparkles,
    title: 'AI Recommendation',
    desc: 'Decision-ready insights the moment extraction finishes:',
    items: ['Lowest Cost Supplier', 'Fastest Delivery', 'Best Overall Value', 'Risk Warnings'],
  },
] as const;

const features = [
  {
    icon: ScanText,
    title: 'AI Quotation Extraction',
    desc: 'Turn messy PDFs, scans, and Word docs into clean structured data — prices, terms, and dates parsed automatically.',
  },
  {
    icon: LayoutDashboard,
    title: 'Supplier Comparison Dashboard',
    desc: 'A single source of truth comparing every supplier across cost, delivery, payment terms, and warranty.',
  },
  {
    icon: ShieldAlert,
    title: 'Risk Detection',
    desc: 'Flags hidden risks — long lead times, unfavorable payment terms, missing warranties, and price outliers.',
  },
  {
    icon: FileText,
    title: 'Procurement Report Generation',
    desc: 'One-click, decision-ready reports to share with stakeholders and attach to your audit trail.',
  },
  {
    icon: MessageSquare,
    title: 'Chat With Quotations',
    desc: 'Ask in plain language — "Which supplier has the best warranty?" — and get sourced, instant answers.',
  },
  {
    icon: TrendingUp,
    title: 'Executive Procurement Insights',
    desc: 'Spend trends, supplier performance, and savings opportunities surfaced for leadership at a glance.',
  },
] as const;

type Tone = 'primary' | 'success' | 'warning';

const toneStyles: Record<Tone, { badge: string; bar: string; text: string }> = {
  primary: { badge: 'bg-primary/10 text-primary', bar: 'bg-primary', text: 'text-primary' },
  success: { badge: 'bg-green-100 text-green-700', bar: 'bg-green-500', text: 'text-green-700' },
  warning: { badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', text: 'text-amber-700' },
};

const suppliers = [
  {
    label: 'Supplier A',
    name: 'ABC Trading',
    cost: 128500,
    delivery: 21,
    terms: 'Net 30',
    score: 92,
    tag: 'Best Overall Value',
    tone: 'primary' as Tone,
  },
  {
    label: 'Supplier B',
    name: 'XYZ Suppliers',
    cost: 119200,
    delivery: 34,
    terms: 'Net 45',
    score: 85,
    tag: 'Lowest Cost',
    tone: 'success' as Tone,
  },
  {
    label: 'Supplier C',
    name: 'FastBuild Materials',
    cost: 134900,
    delivery: 12,
    terms: 'Net 15',
    score: 81,
    tag: 'Fastest Delivery',
    tone: 'warning' as Tone,
  },
];

const maxCost = Math.max(...suppliers.map((s) => s.cost));
const maxDelivery = Math.max(...suppliers.map((s) => s.delivery));
const fmtUsd = (n: number) => `$${n.toLocaleString('en-US')}`;

/* ─────────────────────────────────────────────
   Page
   ───────────────────────────────────────────── */
export default function Home() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <SiteNav />
      <Hero />
      <Reveal>
        <Workflow />
      </Reveal>
      <Reveal>
        <Features />
      </Reveal>
      <Reveal>
        <Demo />
      </Reveal>
      <Reveal>
        <FinalCta />
      </Reveal>
      <SiteFooter />
    </div>
  );
}

/* ─────────────────────────────────────────────
   Nav
   ───────────────────────────────────────────── */
function SiteNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-background/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-base font-semibold tracking-tight">Procurement Copilot</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm font-medium text-muted-foreground md:flex">
          <a href="#workflow" className="transition hover:text-foreground">How it works</a>
          <a href="#features" className="transition hover:text-foreground">Features</a>
          <a href="#demo" className="transition hover:text-foreground">Live demo</a>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <Link href="/workspace" className={cn(btnPrimary, 'px-4 py-2')}>
            <Upload className="h-4 w-4" />
            Upload Quotations
          </Link>
        </div>
      </nav>
    </header>
  );
}

/* ─────────────────────────────────────────────
   Hero
   ───────────────────────────────────────────── */
function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* decorative spotlight + faded grid */}
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute left-1/2 top-[-12rem] h-[32rem] w-[64rem] -translate-x-1/2 rounded-full bg-primary/15 blur-3xl" />
        <div
          className="absolute inset-0 opacity-[0.05]"
          style={{
            backgroundImage:
              'linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
            maskImage: 'radial-gradient(ellipse 60% 50% at 50% 0%, black, transparent 75%)',
            WebkitMaskImage: 'radial-gradient(ellipse 60% 50% at 50% 0%, black, transparent 75%)',
          }}
        />
      </div>

      <div className="mx-auto max-w-6xl px-6 pb-16 pt-20 text-center sm:pt-24">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI-powered supplier quotation analysis
        </span>

        <h1 className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
          Compare Supplier Quotations in Minutes
        </h1>

        <p className="mx-auto mt-5 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground sm:text-lg">
          Upload quotations from multiple suppliers and let AI identify the best option based on
          price, delivery time, payment terms, and risk factors.
        </p>

        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link href="/workspace" className={btnPrimary}>
            <Upload className="h-4 w-4" />
            Upload Quotations
          </Link>
          <a href="#demo" className={btnSecondary}>
            View Demo Analysis
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          No account required · Start analyzing in seconds
        </p>

        <div className="mt-16">
          <MacbookScroll>
            <HeroDashboard />
          </MacbookScroll>
        </div>
      </div>
    </section>
  );
}

function HeroDashboard() {
  return (
    <div className="mx-auto max-w-5xl rounded-2xl border border-border bg-card p-2 shadow-2xl shadow-primary/5">
      {/* window chrome */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        <span className="ml-3 text-xs font-medium text-muted-foreground">
          Procurement Copilot — Request #PRQ-2041
        </span>
      </div>

      <div className="grid gap-3 rounded-xl bg-muted/40 p-3 lg:grid-cols-3">
        {/* comparison table */}
        <div className="rounded-xl border border-border bg-card p-4 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <Table2 className="h-4 w-4 text-primary" />
            Supplier Comparison
          </div>
          <div className="space-y-2">
            {suppliers.map((s) => (
              <div
                key={s.name}
                className="flex items-center justify-between rounded-lg border border-border/70 bg-background px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{s.name}</div>
                  <div className="text-xs text-muted-foreground">{s.terms} · {s.delivery} days</div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{fmtUsd(s.cost)}</span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs font-semibold',
                      toneStyles[s.tone].badge,
                    )}
                  >
                    {s.score}
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* mini price chart */}
          <div className="mt-4 border-t border-border pt-3">
            <div className="mb-2 flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              Total cost comparison
            </div>
            <div className="space-y-1.5">
              {suppliers.map((s) => (
                <div key={s.name} className="flex items-center gap-2">
                  <span className="w-24 shrink-0 truncate text-xs text-muted-foreground">{s.name}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className={cn('h-full rounded-full', toneStyles[s.tone].bar)}
                      style={{ width: `${Math.round((s.cost / maxCost) * 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* AI recommendation + risk */}
        <div className="flex flex-col gap-3">
          <div className="rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-primary">
              <Sparkles className="h-4 w-4" />
              AI Recommendation
            </div>
            <p className="text-sm text-foreground">
              <span className="font-semibold">ABC Trading</span> offers the best balance of cost and
              delivery.
            </p>
            <div className="mt-3 flex items-center gap-2 text-xs font-medium text-primary">
              <Trophy className="h-3.5 w-3.5" />
              Best Overall Value
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              Risk Alerts
            </div>
            <ul className="space-y-1 text-xs text-amber-800">
              <li>XYZ Suppliers — 34-day lead time</li>
              <li>FastBuild — Net 15 payment terms</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Workflow
   ───────────────────────────────────────────── */
function Workflow() {
  return (
    <section id="workflow" className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <SectionHeading
        eyebrow="How it works"
        title="From scattered quotations to a clear decision"
        subtitle="Four steps. No spreadsheets, no manual data entry."
      />
      <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {steps.map((step) => (
          <div
            key={step.n}
            className="relative rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:shadow-md"
          >
            <span className="text-sm font-semibold text-primary/60">{step.n}</span>
            <span className="mt-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <step.icon className="h-5 w-5" />
            </span>
            <h3 className="mt-4 text-base font-semibold">{step.title}</h3>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{step.desc}</p>
            {'items' in step && step.items ? (
              <ul className="mt-3 space-y-1.5">
                {step.items.map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm font-medium">
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Features
   ───────────────────────────────────────────── */
function Features() {
  return (
    <section id="features" className="border-y border-border bg-muted/30">
      <div className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
        <SectionHeading
          eyebrow="Features"
          title="Everything procurement teams need to decide with confidence"
          subtitle="Built to replace the spreadsheet-and-email scramble with one intelligent workspace."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                <f.icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-base font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Demo
   ───────────────────────────────────────────── */
function Demo() {
  return (
    <section id="demo" className="mx-auto max-w-6xl px-6 py-20 sm:py-24">
      <SectionHeading
        eyebrow="Live demo"
        title="See a real procurement comparison"
        subtitle="Three suppliers, analyzed and scored automatically — exactly what you get after uploading."
      />

      <div className="mt-12 grid gap-6 lg:grid-cols-3">
        {/* comparison table */}
        <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:col-span-2">
          <div className="flex items-center gap-2 border-b border-border px-5 py-4 text-sm font-semibold">
            <Table2 className="h-4 w-4 text-primary" />
            Supplier Comparison
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-5 py-3 font-medium">Supplier</th>
                  <th className="px-5 py-3 font-medium">Total Cost</th>
                  <th className="px-5 py-3 font-medium">Delivery</th>
                  <th className="px-5 py-3 font-medium">Payment Terms</th>
                  <th className="px-5 py-3 text-right font-medium">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {suppliers.map((s) => (
                  <tr key={s.name} className="transition hover:bg-muted/40">
                    <td className="px-5 py-4">
                      <div className="font-semibold">{s.name}</div>
                      <span
                        className={cn(
                          'mt-1 inline-flex rounded-full px-2 py-0.5 text-xs font-semibold',
                          toneStyles[s.tone].badge,
                        )}
                      >
                        {s.tag}
                      </span>
                    </td>
                    <td className="px-5 py-4 font-semibold tabular-nums">{fmtUsd(s.cost)}</td>
                    <td className="px-5 py-4 tabular-nums text-muted-foreground">{s.delivery} days</td>
                    <td className="px-5 py-4 text-muted-foreground">{s.terms}</td>
                    <td className="px-5 py-4 text-right">
                      <span className={cn('text-base font-bold tabular-nums', toneStyles[s.tone].text)}>
                        {s.score}
                      </span>
                      <span className="text-xs text-muted-foreground">/100</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* charts */}
          <div className="grid gap-6 border-t border-border p-5 sm:grid-cols-2">
            <ChartBlock icon={BarChart3} title="Total cost" suffix="usd" metric={(s) => s.cost} max={maxCost} />
            <ChartBlock icon={Truck} title="Delivery time" suffix="days" metric={(s) => s.delivery} max={maxDelivery} />
          </div>
        </div>

        {/* AI recommendation panel */}
        <div className="flex flex-col gap-6">
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-primary">
              <Sparkles className="h-4 w-4" />
              AI Recommendation
            </div>
            <ul className="mt-4 space-y-4">
              <RecItem icon={CreditCard} tone="success" title="Lowest total cost"
                body="Supplier B (XYZ Suppliers) offers the lowest total cost at $119,200." />
              <RecItem icon={Clock} tone="warning" title="Fastest delivery"
                body="Supplier C (FastBuild Materials) offers the fastest delivery in 12 days." />
              <RecItem icon={Trophy} tone="primary" title="Best overall value" highlight
                body="Supplier A (ABC Trading) provides the best balance between cost and delivery." />
            </ul>
          </div>

          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-700">
              <ShieldAlert className="h-4 w-4" />
              Risk Warnings
            </div>
            <ul className="mt-3 space-y-2 text-sm text-amber-800">
              <li className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                XYZ Suppliers: 34-day lead time may delay project milestones.
              </li>
              <li className="flex gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                FastBuild Materials: Net 15 terms reduce cash-flow flexibility.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChartBlock({
  icon: Icon,
  title,
  suffix,
  metric,
  max,
}: {
  icon: typeof BarChart3;
  title: string;
  suffix: 'usd' | 'days';
  metric: (s: (typeof suppliers)[number]) => number;
  max: number;
}) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      <div className="space-y-2.5">
        {suppliers.map((s) => {
          const value = metric(s);
          return (
            <div key={s.name} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-xs text-muted-foreground">{s.name}</span>
              <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn('h-full rounded-full', toneStyles[s.tone].bar)}
                  style={{ width: `${Math.round((value / max) * 100)}%` }}
                />
              </div>
              <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums">
                {suffix === 'usd' ? fmtUsd(value) : `${value} days`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RecItem({
  icon: Icon,
  tone,
  title,
  body,
  highlight,
}: {
  icon: typeof Trophy;
  tone: Tone;
  title: string;
  body: string;
  highlight?: boolean;
}) {
  return (
    <li
      className={cn(
        'flex gap-3 rounded-xl border p-3',
        highlight ? 'border-primary/30 bg-card' : 'border-transparent',
      )}
    >
      <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', toneStyles[tone].badge)}>
        <Icon className="h-4 w-4" />
      </span>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-0.5 text-sm text-muted-foreground">{body}</p>
      </div>
    </li>
  );
}

/* ─────────────────────────────────────────────
   Final CTA
   ───────────────────────────────────────────── */
function FinalCta() {
  return (
    <section className="mx-auto max-w-6xl px-6 pb-20 sm:pb-24">
      <div className="relative overflow-hidden rounded-3xl bg-primary px-8 py-14 text-center shadow-xl sm:px-16">
        <div className="pointer-events-none absolute inset-0 opacity-20">
          <div className="absolute -right-10 -top-10 h-48 w-48 rounded-full bg-white blur-3xl" />
          <div className="absolute -bottom-10 -left-10 h-48 w-48 rounded-full bg-white blur-3xl" />
        </div>
        <h2 className="text-balance text-3xl font-bold text-primary-foreground sm:text-4xl">
          Stop comparing quotations by hand
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-pretty text-primary-foreground/80">
          Upload your supplier quotations and get an AI-backed recommendation in minutes — no account
          needed.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Link
            href="/workspace"
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-card px-6 py-3 text-sm font-semibold text-primary shadow-sm transition hover:bg-card/90"
          >
            <Upload className="h-4 w-4" />
            Upload Quotations
          </Link>
          <a
            href="#demo"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary-foreground/30 px-6 py-3 text-sm font-semibold text-primary-foreground transition hover:bg-primary-foreground/10"
          >
            View Demo Analysis
            <ArrowRight className="h-4 w-4" />
          </a>
        </div>
      </div>
    </section>
  );
}

/* ─────────────────────────────────────────────
   Footer
   ───────────────────────────────────────────── */
function SiteFooter() {
  return (
    <footer className="border-t border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col items-center gap-4 text-center">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="text-base font-semibold tracking-tight">Procurement Copilot</span>
          </Link>
          <p className="max-w-2xl text-pretty text-sm text-muted-foreground">
            Built for Procurement Teams, Construction Companies, Manufacturers, and Trading
            Businesses.
          </p>
        </div>
        <div className="mt-8 border-t border-border pt-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Procurement Copilot. All rights reserved.
        </div>
      </div>
    </footer>
  );
}

/* ─────────────────────────────────────────────
   Shared
   ───────────────────────────────────────────── */
function SectionHeading({
  eyebrow,
  title,
  subtitle,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-sm font-semibold uppercase tracking-wide text-primary">{eyebrow}</span>
      <h2 className="mt-2 text-balance text-3xl font-bold tracking-tight sm:text-4xl">{title}</h2>
      <p className="mt-3 text-pretty text-base text-muted-foreground">{subtitle}</p>
    </div>
  );
}
