import PDFDocument from 'pdfkit';
import { ComparisonRow } from '../comparison/comparison.service';

export interface ReportData {
  request: {
    title: string;
    description?: string | null;
    budget: number | null;
    currency: string;
    requiredDeliveryDate?: Date | null;
    quantity?: number | null;
    requiredItems?: string | null;
  };
  rows: ComparisonRow[];
  recommendation: { summary: string; bullets: string[] };
  generatedBy?: string;
}

const COLORS = {
  primary: '#1e3a8a',
  text: '#1f2937',
  muted: '#6b7280',
  danger: '#b91c1c',
  warn: '#b45309',
  ok: '#15803d',
  line: '#e5e7eb',
};

/** Renders a procurement report PDF and resolves to a Buffer. */
export function buildReportPdf(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const money = (v: number | null, cur?: string | null) =>
      v === null ? 'N/A' : `${cur ?? data.request.currency} ${v.toLocaleString()}`;

    // ── Header ──
    doc
      .fillColor(COLORS.primary)
      .fontSize(22)
      .text('AI Procurement Analysis Report', { align: 'left' });
    doc
      .moveDown(0.2)
      .fontSize(10)
      .fillColor(COLORS.muted)
      .text(`Generated ${new Date().toLocaleString()}`);
    if (data.generatedBy) doc.text(`By: ${data.generatedBy}`);
    doc.moveDown(1);

    // ── 1. Request summary ──
    section(doc, '1. Procurement Request Summary');
    keyVal(doc, 'Title', data.request.title);
    if (data.request.description) keyVal(doc, 'Description', data.request.description);
    if (data.request.requiredItems)
      keyVal(doc, 'Required Items', data.request.requiredItems);
    if (data.request.quantity != null)
      keyVal(doc, 'Quantity', String(data.request.quantity));
    keyVal(doc, 'Budget', money(data.request.budget));
    if (data.request.requiredDeliveryDate)
      keyVal(
        doc,
        'Required Delivery',
        new Date(data.request.requiredDeliveryDate).toLocaleDateString(),
      );
    doc.moveDown(0.8);

    // ── 2. Supplier comparison table ──
    section(doc, '2. Supplier Comparison');
    const headers = ['Supplier', 'Total', 'Delivery', 'Reliability', 'Risk'];
    const widths = [150, 90, 75, 75, 60];
    tableRow(doc, headers, widths, true);
    for (const r of data.rows) {
      tableRow(
        doc,
        [
          r.supplierName,
          money(r.totalPrice, r.currency),
          r.deliveryDays ? `${r.deliveryDays} d` : r.deliveryTime ?? 'N/A',
          `${r.reliabilityScore}/100`,
          r.riskLevel ?? '-',
        ],
        widths,
        false,
        r.isRecommended,
      );
    }
    doc.moveDown(0.8);

    // ── 3. Cost analysis ──
    section(doc, '3. Cost Analysis');
    const prices = data.rows
      .map((r) => r.totalPrice)
      .filter((p): p is number => p !== null);
    if (prices.length) {
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
      keyVal(doc, 'Lowest quotation', money(min));
      keyVal(doc, 'Highest quotation', money(max));
      keyVal(doc, 'Average quotation', money(Math.round(avg)));
      keyVal(doc, 'Potential saving (high vs low)', money(max - min));
      if (data.request.budget)
        keyVal(
          doc,
          'Lowest vs budget',
          `${money(min)} of ${money(data.request.budget)} (${Math.round((min / data.request.budget) * 100)}%)`,
        );
    } else {
      doc.fontSize(10).fillColor(COLORS.muted).text('No pricing data extracted.');
    }
    doc.moveDown(0.8);

    // ── 4. Risk analysis ──
    section(doc, '4. Risk Analysis');
    const risky = data.rows.filter((r) => r.warnings.length > 0);
    if (risky.length === 0) {
      doc.fontSize(10).fillColor(COLORS.ok).text('No significant risks detected.');
    } else {
      for (const r of risky) {
        doc
          .fontSize(10)
          .fillColor(COLORS.text)
          .text(`${r.supplierName} (${r.riskLevel} risk):`, { continued: false });
        for (const w of r.warnings) {
          doc.fillColor(COLORS.warn).fontSize(9).text(`   • ${w}`);
        }
        doc.moveDown(0.3);
      }
    }
    doc.moveDown(0.8);

    // ── 5. Recommendation ──
    section(doc, '5. Recommended Supplier');
    const recommended = data.rows.find((r) => r.isRecommended);
    if (recommended) {
      doc
        .fontSize(12)
        .fillColor(COLORS.primary)
        .text(`Recommended: ${recommended.supplierName}`);
      doc.moveDown(0.3);
    }
    doc.fontSize(10).fillColor(COLORS.text).text(data.recommendation.summary, {
      align: 'left',
    });
    doc.moveDown(0.3);
    for (const b of data.recommendation.bullets) {
      doc.fillColor(COLORS.muted).fontSize(9).text(`• ${b}`);
    }

    // ── Footer ──
    doc
      .moveDown(2)
      .fontSize(8)
      .fillColor(COLORS.muted)
      .text(
        'Generated by AI Procurement Analyzer. Figures are AI-assisted estimates — verify before contracting.',
        { align: 'center' },
      );

    doc.end();
  });
}

function section(doc: PDFKit.PDFDocument, title: string) {
  doc.fontSize(14).fillColor(COLORS.primary).text(title);
  doc
    .moveTo(doc.x, doc.y + 2)
    .lineTo(547, doc.y + 2)
    .strokeColor(COLORS.line)
    .stroke();
  doc.moveDown(0.5);
}

function keyVal(doc: PDFKit.PDFDocument, key: string, value: string) {
  doc.fontSize(10).fillColor(COLORS.muted).text(`${key}: `, { continued: true });
  doc.fillColor(COLORS.text).text(value);
}

function tableRow(
  doc: PDFKit.PDFDocument,
  cells: string[],
  widths: number[],
  header: boolean,
  highlight = false,
) {
  const y = doc.y;
  let x = doc.x;
  doc.fontSize(header ? 10 : 9);
  cells.forEach((cell, i) => {
    doc
      .fillColor(header ? COLORS.primary : highlight ? COLORS.ok : COLORS.text)
      .text(cell, x + 2, y + 2, { width: widths[i] - 4, ellipsis: true });
    x += widths[i];
  });
  doc.moveDown(0.4);
  doc
    .moveTo(doc.page.margins.left, doc.y)
    .lineTo(547, doc.y)
    .strokeColor(COLORS.line)
    .stroke();
  doc.moveDown(0.2);
}
