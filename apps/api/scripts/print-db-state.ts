/**
 * Prints a row-level summary of the Stage 1 tables after verification runs.
 * Uses a PLAIN PrismaClient (no tenant extension) so it can read everything
 * the integration suite left behind — read-only.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const counts = {
    Organization: await prisma.organization.count(),
    Patient: await prisma.patient.count(),
    MasterTest: await prisma.masterTest.count(),
    MasterTestPackage: await prisma.masterTestPackage.count(),
    Order: await prisma.order.count(),
    OrderTest: await prisma.orderTest.count(),
    Invoice: await prisma.invoice.count(),
    Payment: await prisma.payment.count(),
    PaymentSplit: await prisma.paymentSplit.count(),
  };
  console.table(counts);

  const orders = await prisma.order.findMany({
    include: { patient: true, orderTests: true, invoice: { include: { payments: { include: { splits: true } } } } },
  });
  for (const o of orders) {
    console.log(`\nOrder ${o.id.slice(0, 8)}… patient=${o.patient.patientUid} subtotal=${o.subtotal} discount=${o.discountPercent}% total=${o.totalAmount} status=${o.status}`);
    for (const ot of o.orderTests) {
      console.log(`  OrderTest ${ot.id.slice(0, 8)}… ${ot.testNameSnapshot} @ ${ot.snapshottedPrice} status=${ot.status}`);
    }
    const inv = o.invoice;
    if (inv) {
      console.log(`  Invoice ${inv.id.slice(0, 8)}… status=${inv.status} total=${inv.totalAmount}`);
      for (const p of inv.payments) {
        console.log(`    Payment ${p.id.slice(0, 8)}… collectedBy=${p.collectedBy} splits=[${p.splits.map((s) => `${s.mode}:${s.amount}`).join(', ')}]`);
      }
    }
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
