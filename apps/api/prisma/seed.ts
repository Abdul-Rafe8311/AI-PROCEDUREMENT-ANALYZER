import { PrismaClient, Role, QuotationStatus, RequestStatus, Supplier } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // ── Users ──
  const password = await bcrypt.hash('Password123!', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@procurement.ai' },
    update: {},
    create: {
      email: 'admin@procurement.ai',
      passwordHash: password,
      firstName: 'Aisha',
      lastName: 'Admin',
      role: Role.ADMIN,
    },
  });
  const manager = await prisma.user.upsert({
    where: { email: 'manager@procurement.ai' },
    update: {},
    create: {
      email: 'manager@procurement.ai',
      passwordHash: password,
      firstName: 'Marco',
      lastName: 'Manager',
      role: Role.PROCUREMENT_MANAGER,
    },
  });
  console.log(`👤 Users: ${admin.email}, ${manager.email}  (password: Password123!)`);

  // ── Suppliers ──
  const supplierSeed = [
    { companyName: 'Acme Steel Co.', contactPerson: 'John Carter', email: 'sales@acmesteel.com', phone: '+1-555-0100', country: 'USA', reliabilityScore: 88 },
    { companyName: 'NipponMetals Ltd.', contactPerson: 'Yuki Tanaka', email: 'quotes@nipponmetals.jp', phone: '+81-3-1234', country: 'Japan', reliabilityScore: 92 },
    { companyName: 'EuroForge GmbH', contactPerson: 'Klaus Becker', email: 'info@euroforge.de', phone: '+49-30-9000', country: 'Germany', reliabilityScore: 79 },
    { companyName: 'Gulf Industrial Supplies', contactPerson: 'Omar Farouk', email: 'sales@gulfind.ae', phone: '+971-4-5000', country: 'UAE', reliabilityScore: 71 },
    { companyName: 'Shenzhen Fab Works', contactPerson: 'Li Wei', email: 'export@szfab.cn', phone: '+86-755-8888', country: 'China', reliabilityScore: 65 },
  ];

  const suppliers: Supplier[] = [];
  for (const s of supplierSeed) {
    const supplier = await prisma.supplier.create({
      data: { ...s, createdById: admin.id, notes: 'Seeded supplier.' },
    });
    suppliers.push(supplier);
  }
  console.log(`🏭 Suppliers: ${suppliers.length}`);

  // ── Procurement Request 1 (with quotations) ──
  const request = await prisma.procurementRequest.create({
    data: {
      title: 'Structural Steel Beams — Q3 Tower Project',
      description: 'Supply of grade A36 structural steel I-beams for the downtown tower build.',
      requiredItems: 'I-Beam W12x26\nI-Beam W14x30\nSteel plate 10mm',
      quantity: 500,
      requiredDeliveryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      budget: 280000,
      currency: 'USD',
      status: RequestStatus.COMPARING,
      ownerId: manager.id,
    },
  });

  const quoteSeed = [
    { supplier: suppliers[0], total: 252000, days: 21, terms: 'Net 30', items: [['I-Beam W12x26', 200, 480], ['I-Beam W14x30', 200, 560], ['Steel plate 10mm', 100, 320]] },
    { supplier: suppliers[1], total: 268500, days: 14, terms: 'Net 45', items: [['I-Beam W12x26', 200, 500], ['I-Beam W14x30', 200, 590], ['Steel plate 10mm', 100, 350]] },
    { supplier: suppliers[2], total: 241000, days: 35, terms: '50% advance, 50% on delivery', items: [['I-Beam W12x26', 200, 455], ['I-Beam W14x30', 200, 540], ['Steel plate 10mm', 100, 300]] },
    { supplier: suppliers[4], total: 198000, days: 60, terms: 'T/T in advance', items: [['I-Beam W12x26', 200, 370], ['I-Beam W14x30', 200, 450]] }, // missing item + low price -> risk
  ];

  for (const q of quoteSeed) {
    const items = q.items.map(([name, qty, unit]) => ({
      productName: name as string,
      quantity: qty as number,
      unitPrice: unit as number,
      totalPrice: (qty as number) * (unit as number),
      currency: 'USD',
    }));
    const extractedText = `Quotation from ${q.supplier.companyName}. Total ${q.total} USD. Delivery ${q.days} days. Payment terms: ${q.terms}. Items: ${items.map((i) => `${i.productName} x${i.quantity} @ ${i.unitPrice}`).join('; ')}.`;
    const seededQuote = await prisma.quotation.create({
      data: {
        requestId: request.id,
        supplierId: q.supplier.id,
        supplierName: q.supplier.companyName,
        fileName: `${q.supplier.companyName.replace(/\W+/g, '_')}_quote.pdf`,
        fileKey: `quotations/seed-${q.supplier.id}.pdf`,
        fileMimeType: 'application/pdf',
        fileSize: 102400,
        status: QuotationStatus.EXTRACTED,
        currency: 'USD',
        totalPrice: q.total,
        deliveryTime: `${q.days} days`,
        deliveryDays: q.days,
        paymentTerms: q.terms,
        extractedText,
        items: { create: items },
      },
    });
    // Index for RAG chat (empty vector → keyword fallback works without OpenAI).
    await prisma.quotationEmbedding.create({
      data: {
        quotationId: seededQuote.id,
        requestId: request.id,
        chunkIndex: 0,
        content: extractedText,
        embedding: [],
      },
    });
  }
  console.log(`📄 Request "${request.title}" with ${quoteSeed.length} quotations`);

  // ── Procurement Request 2 (awarded — drives analytics savings) ──
  const request2 = await prisma.procurementRequest.create({
    data: {
      title: 'Office Laptops — Annual Refresh',
      description: '120 business laptops, 16GB RAM, 512GB SSD.',
      requiredItems: 'Business laptop 16GB/512GB',
      quantity: 120,
      budget: 150000,
      currency: 'USD',
      status: RequestStatus.AWARDED,
      ownerId: manager.id,
    },
  });
  const winner = await prisma.quotation.create({
    data: {
      requestId: request2.id,
      supplierId: suppliers[3].id,
      supplierName: suppliers[3].companyName,
      fileName: 'gulf_laptops_quote.pdf',
      fileKey: 'quotations/seed-laptops.pdf',
      fileMimeType: 'application/pdf',
      fileSize: 88000,
      status: QuotationStatus.AWARDED,
      currency: 'USD',
      totalPrice: 121000,
      deliveryTime: '10 days',
      deliveryDays: 10,
      paymentTerms: 'Net 30',
      extractedText: 'Gulf Industrial Supplies — 120 business laptops at 1008 USD each. Total 121000 USD. Delivery 10 days.',
      items: { create: [{ productName: 'Business laptop 16GB/512GB', quantity: 120, unitPrice: 1008, totalPrice: 120960, currency: 'USD' }] },
    },
  });
  await prisma.procurementRequest.update({
    where: { id: request2.id },
    data: { awardedQuotationId: winner.id },
  });
  console.log(`🏆 Awarded request "${request2.title}"`);

  // ── A supplier rating ──
  await prisma.supplierRating.create({
    data: { supplierId: suppliers[1].id, score: 5, comment: 'On-time, excellent quality.', createdById: manager.id },
  });

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
