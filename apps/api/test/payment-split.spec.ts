import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { deriveInvoiceStatus, normalizeAndValidateSplits, sumSplits } from '../src/billing/payment.util';
import { InvoicesService } from '../src/invoices/invoices.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/prisma/tenant-context.service';

describe('payment split validation', () => {
  describe('pure utilities', () => {
    it('sums splits exactly', () => {
      const splits = normalizeAndValidateSplits([
        { mode: 'cash', amount: 800 },
        { mode: 'upi', amount: 200 },
      ]);
      expect(sumSplits(splits).toString()).toBe('1000');
    });

    it('rejects negative, zero and non-numeric amounts', () => {
      expect(() => normalizeAndValidateSplits([{ mode: 'cash', amount: -5 }])).toThrow('positive number');
      expect(() => normalizeAndValidateSplits([{ mode: 'cash', amount: 0 }])).toThrow('positive number');
      expect(() => normalizeAndValidateSplits([{ mode: 'cash', amount: Number.NaN }])).toThrow('positive number');
    });

    it('rejects unknown payment modes', () => {
      expect(() => normalizeAndValidateSplits([{ mode: 'bitcoin' as never, amount: 100 }])).toThrow(
        'Invalid payment mode',
      );
    });

    it('rejects an empty split list', () => {
      expect(() => normalizeAndValidateSplits([])).toThrow('At least one payment split');
    });

    it('derives invoice status from cumulative paid vs total', () => {
      const total = new Prisma.Decimal(1000);
      expect(deriveInvoiceStatus(new Prisma.Decimal(1000), total)).toBe('paid');
      expect(deriveInvoiceStatus(new Prisma.Decimal(800), total)).toBe('partial');
      expect(deriveInvoiceStatus(new Prisma.Decimal(0), total)).toBe('due');
    });
  });

  describe('POST /invoices/:id/payments', () => {
    const $transaction = jest.fn();
    const prismaMock = { prisma: { $transaction } };

    let service: InvoicesService;
    let tenant: TenantContextService;

    beforeEach(async () => {
      jest.clearAllMocks();
      const moduleRef = await Test.createTestingModule({
        providers: [InvoicesService, TenantContextService, { provide: PrismaService, useValue: prismaMock }],
      }).compile();
      service = moduleRef.get(InvoicesService);
      tenant = moduleRef.get(TenantContextService);
    });

    function mockTx() {
      return {
        invoice: { findFirst: jest.fn(), update: jest.fn() },
        payment: { create: jest.fn(), findMany: jest.fn() },
      };
    }

    it('rejects splits that do not sum to the amount being paid', async () => {
      const tx = mockTx();
      tx.invoice.findFirst.mockResolvedValue({ id: 'inv1', organizationId: 'org_demo', totalAmount: new Prisma.Decimal(1000) });
      $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));

      await expect(
        tenant.run('org_demo', () =>
          service.addPayment('inv1', {
            amount: 900,
            splits: [
              { mode: 'cash', amount: 800 },
              { mode: 'upi', amount: 200 },
            ],
          }),
        ),
      ).rejects.toThrow('do not sum exactly to the amount being paid');
      expect(tx.payment.create).not.toHaveBeenCalled();
    });

    it('records both splits and marks the invoice paid when they match the total', async () => {
      const tx = mockTx();
      tx.invoice.findFirst.mockResolvedValue({ id: 'inv1', organizationId: 'org_demo', totalAmount: new Prisma.Decimal(1000) });
      tx.payment.findMany.mockResolvedValue([
        { splits: [{ amount: new Prisma.Decimal(800) }, { amount: new Prisma.Decimal(200) }] },
      ]);
      tx.invoice.update.mockResolvedValue({});
      $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));

      const out = await tenant.run('org_demo', () =>
        service.addPayment('inv1', {
          splits: [
            { mode: 'cash', amount: 800 },
            { mode: 'upi', amount: 200 },
          ],
        }),
      );

      expect(tx.payment.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            organizationId: 'org_demo',
            invoiceId: 'inv1',
            splits: { create: [{ mode: 'cash', amount: expect.anything() }, { mode: 'upi', amount: expect.anything() }] },
          }),
        }),
      );
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { status: 'paid' } });
      expect(out).toEqual(expect.objectContaining({ status: 'paid' }));
    });

    it('marks the invoice partial when a later payment does not clear the balance', async () => {
      const tx = mockTx();
      tx.invoice.findFirst.mockResolvedValue({ id: 'inv1', organizationId: 'org_demo', totalAmount: new Prisma.Decimal(1000) });
      tx.payment.findMany.mockResolvedValue([{ splits: [{ amount: new Prisma.Decimal(300) }] }]);
      tx.invoice.update.mockResolvedValue({});
      $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));

      const out = await tenant.run('org_demo', () =>
        service.addPayment('inv1', { splits: [{ mode: 'cash', amount: 300 }] }),
      );
      expect(out.status).toBe('partial');
      expect(tx.invoice.update).toHaveBeenCalledWith({ where: { id: 'inv1' }, data: { status: 'partial' } });
    });

    it('throws NotFound for an invoice that does not exist in the tenant', async () => {
      const tx = mockTx();
      tx.invoice.findFirst.mockResolvedValue(null);
      $transaction.mockImplementation((cb: (t: never) => unknown) => cb(tx as never));
      await expect(
        tenant.run('org_demo', () => service.addPayment('nope', { splits: [{ mode: 'cash', amount: 10 }] })),
      ).rejects.toThrow('Invoice not found');
    });
  });
});
