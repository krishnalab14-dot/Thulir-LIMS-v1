/**
 * Thulir LIMS — Stage 1 seed.
 *
 * Creates the demo organization (`org_demo`), an admin user, sample types,
 * a priced test catalog, two packages and a few referral parties so the
 * registration → order → billing flow can be exercised end to end.
 *
 * Uses its own plain PrismaClient (no tenant extension) and truncates + re-inserts,
 * so it is safe to re-run. Requires the schema to be migrated first:
 *   npm run db:migrate && npm run db:seed
 */
import { PrismaClient, Role, PartyType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ORG_ID = 'org_demo';
const ORG_NAME = 'Thulir Demo Lab';

async function main() {
  // Wipe and rebuild the demo org (TRUNCATE CASCADE handles FK order).
  await prisma.$executeRaw`TRUNCATE "Organization" CASCADE`;

  await prisma.organization.create({ data: { id: ORG_ID, name: ORG_NAME } });

  const sampleTypes = await prisma.sampleType.createMany({
    data: [
      { id: 'st_edta', organizationId: ORG_ID, name: 'EDTA Blood', code: 'EDTA' },
      { id: 'st_serum', organizationId: ORG_ID, name: 'Serum', code: 'SER' },
      { id: 'st_urine', organizationId: ORG_ID, name: 'Urine', code: 'URN' },
      { id: 'st_whole_blood', organizationId: ORG_ID, name: 'Whole Blood', code: 'WB' },
      { id: 'st_plasma', organizationId: ORG_ID, name: 'Plasma', code: 'PLA' },
    ],
  });
  console.log(`Seeded ${sampleTypes.count} sample types`);

  // Stage 2.5: every seeded test is resultType numeric (the default) and gets a
  // default reference range — §2 rule 4 rejects ORDERING a numeric test with no
  // range at all, so a usable seed catalog must define one. FBS is kept as a
  // numeric WITH only a default range so the seed itself exercises the
  // default-fallback path; Blood Group is an options-type test (the seeded
  // catalog now spans all three ResultType values).
  await prisma.masterTest.createMany({
    data: [
      // CBC sub-tests — individual components that form the CBC panel (package) below.
      { id: 't_cbc_wbc', organizationId: ORG_ID, testCode: 'WBC', testName: 'White Blood Cell Count', currentPrice: 50, requiredSampleTypeId: 'st_edta', defaultRefLow: 4000, defaultRefHigh: 11000, criticalLow: 1000, criticalHigh: 30000, unit: 'cells/mcL' },
      { id: 't_cbc_rbc', organizationId: ORG_ID, testCode: 'RBC', testName: 'Red Blood Cell Count', currentPrice: 40, requiredSampleTypeId: 'st_edta', defaultRefLow: 4.5, defaultRefHigh: 5.5, unit: 'million cells/mcL' },
      { id: 't_cbc_hgb', organizationId: ORG_ID, testCode: 'HGB', testName: 'Hemoglobin', currentPrice: 60, requiredSampleTypeId: 'st_edta', defaultRefLow: 12, defaultRefHigh: 16, unit: 'g/dL' },
      { id: 't_cbc_hct', organizationId: ORG_ID, testCode: 'HCT', testName: 'Hematocrit', currentPrice: 40, requiredSampleTypeId: 'st_edta', defaultRefLow: 36, defaultRefHigh: 46, unit: '%' },
      { id: 't_cbc_mcv', organizationId: ORG_ID, testCode: 'MCV', testName: 'Mean Corpuscular Volume', currentPrice: 30, requiredSampleTypeId: 'st_edta', defaultRefLow: 80, defaultRefHigh: 100, unit: 'fL' },
      { id: 't_cbc_mch', organizationId: ORG_ID, testCode: 'MCH', testName: 'Mean Corpuscular Hemoglobin', currentPrice: 30, requiredSampleTypeId: 'st_edta', defaultRefLow: 27, defaultRefHigh: 31, unit: 'pg' },
      { id: 't_cbc_mchc', organizationId: ORG_ID, testCode: 'MCHC', testName: 'Mean Corpuscular Hemoglobin Concentration', currentPrice: 30, requiredSampleTypeId: 'st_edta', defaultRefLow: 32, defaultRefHigh: 36, unit: 'g/dL' },
      { id: 't_cbc_rdw', organizationId: ORG_ID, testCode: 'RDW', testName: 'Red Cell Distribution Width', currentPrice: 25, requiredSampleTypeId: 'st_edta', defaultRefLow: 11.5, defaultRefHigh: 14.5, unit: '%' },
      { id: 't_cbc_plt', organizationId: ORG_ID, testCode: 'PLT', testName: 'Platelet Count', currentPrice: 50, requiredSampleTypeId: 'st_edta', defaultRefLow: 150000, defaultRefHigh: 400000, criticalLow: 50000, criticalHigh: 800000, unit: 'cells/mcL' },
      { id: 't_cbc_neut', organizationId: ORG_ID, testCode: 'NEUT', testName: 'Neutrophils', currentPrice: 20, requiredSampleTypeId: 'st_edta', defaultRefLow: 40, defaultRefHigh: 70, unit: '%' },
      { id: 't_cbc_lymph', organizationId: ORG_ID, testCode: 'LYMPH', testName: 'Lymphocytes', currentPrice: 20, requiredSampleTypeId: 'st_edta', defaultRefLow: 20, defaultRefHigh: 40, unit: '%' },
      { id: 't_cbc_mono', organizationId: ORG_ID, testCode: 'MONO', testName: 'Monocytes', currentPrice: 20, requiredSampleTypeId: 'st_edta', defaultRefLow: 2, defaultRefHigh: 10, unit: '%' },
      { id: 't_cbc_eo', organizationId: ORG_ID, testCode: 'EO', testName: 'Eosinophils', currentPrice: 20, requiredSampleTypeId: 'st_edta', defaultRefLow: 1, defaultRefHigh: 6, unit: '%' },
      { id: 't_cbc_baso', organizationId: ORG_ID, testCode: 'BASO', testName: 'Basophils', currentPrice: 15, requiredSampleTypeId: 'st_edta', defaultRefLow: 0, defaultRefHigh: 2, unit: '%' },
      { id: 't_esr', organizationId: ORG_ID, testCode: 'ESR', testName: 'Erythrocyte Sedimentation Rate', currentPrice: 250, requiredSampleTypeId: 'st_edta', defaultRefLow: 0, defaultRefHigh: 20, unit: 'mm/hr' },
      { id: 't_bloodgroup', organizationId: ORG_ID, testCode: 'BG', testName: 'Blood Group & Rh Typing', currentPrice: 150, requiredSampleTypeId: 'st_edta', resultType: 'options', resultOptions: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
      { id: 't_fbs', organizationId: ORG_ID, testCode: 'FBS', testName: 'Fasting Blood Sugar', currentPrice: 150, requiredSampleTypeId: 'st_serum', defaultRefLow: 70, defaultRefHigh: 99, criticalLow: 40, criticalHigh: 400, unit: 'mg/dL' },
      // Stage 2.1: HbA1c gets its own dedicated tube even when ordered alongside
      // other EDTA tests (contamination-sensitive assay).
      { id: 't_hba1c', organizationId: ORG_ID, testCode: 'HBA1C', testName: 'Glycated Haemoglobin (HbA1c)', currentPrice: 600, requiredSampleTypeId: 'st_edta', requiresDedicatedSample: true, defaultRefLow: 4, defaultRefHigh: 5.6, criticalLow: 3, criticalHigh: 15, unit: '%' },
      { id: 't_lipid', organizationId: ORG_ID, testCode: 'LIPID', testName: 'Lipid Profile', currentPrice: 800, requiredSampleTypeId: 'st_serum', defaultRefLow: 0, defaultRefHigh: 200, unit: 'mg/dL' },
      // Stage 2.1: TSH also demands a dedicated serum tube (lab protocol).
      { id: 't_tsh', organizationId: ORG_ID, testCode: 'TSH', testName: 'Thyroid Stimulating Hormone', currentPrice: 350, requiredSampleTypeId: 'st_serum', requiresDedicatedSample: true, defaultRefLow: 0.4, defaultRefHigh: 4.5, criticalLow: 0.1, criticalHigh: 50, unit: 'mIU/L' },
      { id: 't_lft', organizationId: ORG_ID, testCode: 'LFT', testName: 'Liver Function Test', currentPrice: 700, requiredSampleTypeId: 'st_serum', defaultRefLow: 0, defaultRefHigh: 40, unit: 'U/L' },
      { id: 't_kft', organizationId: ORG_ID, testCode: 'KFT', testName: 'Kidney Function Test', currentPrice: 650, requiredSampleTypeId: 'st_serum', defaultRefLow: 0, defaultRefHigh: 1.2, unit: 'mg/dL' },
      { id: 't_urine', organizationId: ORG_ID, testCode: 'URT', testName: 'Urine Routine & Microscopy', currentPrice: 200, requiredSampleTypeId: 'st_urine', resultType: 'text' },
      { id: 't_vitd', organizationId: ORG_ID, testCode: 'VITD', testName: 'Vitamin D (25-OH)', currentPrice: 1200, requiredSampleTypeId: 'st_serum', defaultRefLow: 30, defaultRefHigh: 100, criticalLow: 10, criticalHigh: 200, unit: 'ng/mL' },
      { id: 't_crp', organizationId: ORG_ID, testCode: 'CRP', testName: 'C-Reactive Protein', currentPrice: 450, requiredSampleTypeId: 'st_serum', defaultRefLow: 0, defaultRefHigh: 5, criticalLow: 10, criticalHigh: 200, unit: 'mg/L' },
    ],
  });
  console.log('Seeded 11 standalone tests + 14 CBC sub-tests (2 marked requiresDedicatedSample: HBA1C, TSH)');

  // Packages — a package bills at its OWN packagePrice (distributed across its
  // constituent OrderTest rows), never at the sum of the tests' standalone
  // prices. Both packages below are priced BELOW that sum (the typical bundled
  // panel discount), which the order billing logic must honor:
  //   pkg_basic:    CBC 400 + FBS 150 + LIPID 800 = 1350 standalone → 1150
  //   pkg_diabetes: FBS 150 + HBA1C 600        =  750 standalone →  650
  // CBC Panel — a complete blood count package containing all individual
  // sub-tests. When ordered, one OrderTest row is created per sub-test,
  // each getting its own result entry field, reference range, and snapshot.
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_cbc',
      organizationId: ORG_ID,
      packageCode: 'CBC-PANEL',
      packageName: 'CBC (Complete Blood Count)',
      packagePrice: 400,
      items: {
        create: [
          { testId: 't_cbc_wbc' }, { testId: 't_cbc_rbc' }, { testId: 't_cbc_hgb' },
          { testId: 't_cbc_hct' }, { testId: 't_cbc_mcv' }, { testId: 't_cbc_mch' },
          { testId: 't_cbc_mchc' }, { testId: 't_cbc_rdw' }, { testId: 't_cbc_plt' },
          { testId: 't_cbc_neut' }, { testId: 't_cbc_lymph' }, { testId: 't_cbc_mono' },
          { testId: 't_cbc_eo' }, { testId: 't_cbc_baso' },
        ],
      },
    },
  });
  console.log('Seeded CBC panel (14 sub-tests)');

  // Basic Health Check — uses the individual CBC sub-tests (not the panel,
  // since packages reference individual tests, not other packages).
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_basic',
      organizationId: ORG_ID,
      packageCode: 'PKG-BASIC',
      packageName: 'Basic Health Check',
      packagePrice: 1200,
      items: {
        create: [
          { testId: 't_cbc_wbc' }, { testId: 't_cbc_rbc' }, { testId: 't_cbc_hgb' },
          { testId: 't_cbc_hct' }, { testId: 't_cbc_plt' },
          { testId: 't_fbs' }, { testId: 't_lipid' },
        ],
      },
    },
  });
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_diabetes',
      organizationId: ORG_ID,
      packageCode: 'PKG-DIAB',
      packageName: 'Diabetes Panel',
      packagePrice: 650,
      items: { create: [{ testId: 't_fbs' }, { testId: 't_hba1c' }] },
    },
  });
  console.log('Seeded 3 packages (CBC panel, Basic Health Check, Diabetes Panel)');

  await prisma.party.createMany({
    data: [
      { id: 'party_dr_kavitha', organizationId: ORG_ID, name: 'Dr. Kavitha Rajan', type: PartyType.doctor },
      { id: 'party_dr_arun', organizationId: ORG_ID, name: 'Dr. Arun Prakash', type: PartyType.doctor },
      { id: 'party_apollo', organizationId: ORG_ID, name: 'Apollo Referral Network', type: PartyType.hospital },
      { id: 'party_corp', organizationId: ORG_ID, name: 'Chennai Steelworks Corp', type: PartyType.corporate },
      { id: 'party_tpa', organizationId: ORG_ID, name: 'Thulir Health Insurance (TPA)', type: PartyType.insurance_tpa },
    ],
  });
  console.log('Seeded 5 parties');

  // Admin user — the seeded org's login (Stage 7 real auth: bcrypt-hashed,
  // logs in through POST /api/auth/login like any other staff account).
  const passwordHash = await bcrypt.hash('Thulir@123', 10);
  await prisma.user.create({
    data: {
      id: 'user_admin',
      organizationId: ORG_ID,
      username: 'admin',
      passwordHash,
      role: Role.admin,
    },
  });
  console.log('Seeded admin user (username: admin / password: Thulir@123)');

  // Seed configurable Title list
  const defaultTitles = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Baby', 'Sister', 'Mx'];
  for (let i = 0; i < defaultTitles.length; i++) {
    await prisma.lookupItem.upsert({
      where: {
        organizationId_category_value: {
          organizationId: ORG_ID,
          category: 'title',
          value: defaultTitles[i],
        },
      },
      update: {},
      create: {
        organizationId: ORG_ID,
        category: 'title',
        value: defaultTitles[i],
        sortOrder: i,
      },
    });
  }
  console.log(`Seeded ${defaultTitles.length} title options`);

  console.log(`Seed complete. Organization "${ORG_NAME}" (${ORG_ID}) is ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
