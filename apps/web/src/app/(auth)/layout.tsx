import { Boxes } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold">
          <Boxes className="h-6 w-6" />
          AI Procurement Analyzer
        </div>
        <div className="space-y-4">
          <h1 className="text-4xl font-bold leading-tight">
            Compare quotations.
            <br />
            Cut costs. Reduce risk.
          </h1>
          <p className="max-w-md text-primary-foreground/80">
            Upload supplier quotations and let AI extract pricing, detect risks, and
            recommend the best supplier — with audit-ready reports in one click.
          </p>
        </div>
        <p className="text-sm text-primary-foreground/60">
          © {new Date().getFullYear()} AI Procurement Analyzer
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
