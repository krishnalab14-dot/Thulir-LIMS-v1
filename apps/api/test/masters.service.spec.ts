import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { MastersService } from '../src/masters/masters.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { TenantContextService } from '../src/prisma/tenant-context.service';

describe('MastersService — package from selection', () => {
  const findMany = jest.fn();
  const createPackage = jest.fn();
  const prismaMock = {
    prisma: {
      masterTest: { findMany },
      masterTestPackage: { create: createPackage },
      sampleType: { findFirst: jest.fn() },
      sampleTypes: undefined,
    },
  };

  let service: MastersService;
  let tenant: TenantContextService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [MastersService, TenantContextService, { provide: PrismaService, useValue: prismaMock }],
    }).compile();
    service = moduleRef.get(MastersService);
    tenant = moduleRef.get(TenantContextService);
  });

  it('creates a real, reusable package from 2+ selected tests', async () => {
    findMany.mockResolvedValue([{ id: 't_cbc' }, { id: 't_fbs' }]);
    createPackage.mockResolvedValue({
      id: 'pkg_new',
      packageCode: 'PKG-2F3A',
      packageName: 'CBC + Sugar',
      packagePrice: new Prisma.Decimal(500),
      items: [
        { testId: 't_cbc', test: { id: 't_cbc', testName: 'CBC', currentPrice: new Prisma.Decimal(400) } },
        { testId: 't_fbs', test: { id: 't_fbs', testName: 'FBS', currentPrice: new Prisma.Decimal(150) } },
      ],
    });

    const out = await tenant.run('org_demo', () =>
      service.createPackage({ packageName: 'CBC + Sugar', packagePrice: 500, testIds: ['t_cbc', 't_fbs'] }),
    );

    expect(out.packageCode).toMatch(/^PKG-/);
    expect(createPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          organizationId: 'org_demo',
          packageName: 'CBC + Sugar',
          items: { create: [{ testId: 't_cbc' }, { testId: 't_fbs' }] },
        }),
      }),
    );
  });

  it('rejects when a selected test does not exist or is inactive', async () => {
    findMany.mockResolvedValue([{ id: 't_cbc' }]); // only 1 of 2 found
    await expect(
      tenant.run('org_demo', () =>
        service.createPackage({ packageName: 'Bad', packagePrice: 100, testIds: ['t_cbc', 't_missing'] }),
      ),
    ).rejects.toThrow('do not exist or are inactive');
    expect(createPackage).not.toHaveBeenCalled();
  });

  it('deduplicates repeated test ids', async () => {
    findMany.mockResolvedValue([{ id: 't_cbc' }, { id: 't_fbs' }]);
    createPackage.mockResolvedValue({ id: 'p', packageCode: 'PKG-1', packageName: 'P', packagePrice: new Prisma.Decimal(1), items: [] });
    await tenant.run('org_demo', () =>
      service.createPackage({ packageName: 'P', packagePrice: 1, testIds: ['t_cbc', 't_cbc', 't_fbs'] }),
    );
    const data = createPackage.mock.calls[0][0].data;
    expect(data.items.create).toEqual([{ testId: 't_cbc' }, { testId: 't_fbs' }]);
  });
});
