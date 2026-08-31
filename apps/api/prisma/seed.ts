/**
 * Thulir LIMS — Idempotent Seed.
 *
 * Creates the demo organization (`org_demo`), an admin user, sample types,
 * a priced test catalog with standard panels, and a few referral parties so
 * the registration → order → billing flow can be exercised end to end.
 *
 * IDEMPOTENT: Uses `upsert` and `createMany({ skipDuplicates: true })` keyed
 * by stable business identifiers (testCode, packageCode, etc.) instead of
 * truncating and re-inserting. This means:
 *   - Missing seed rows are created on every boot (picking up new content)
 *   - Existing rows (whether from earlier seeds or manual Masters UI edits)
 *     are never touched or overwritten
 *   - Safe to run on every dev-api startup — new test panels added to the
 *     seed in future passes are automatically picked up
 *
 * Requires the schema to be migrated first:
 *   npm run db:migrate && npm run db:seed
 *
 * Clinical ranges below are search-verified against current lab references but
 * should be reviewed and confirmed by the founder's pathologist before going
 * live — especially critical/panic thresholds.
 *
 * Calculated parameters (Indirect Bilirubin, Globulin, A:G Ratio, eGFR, VLDL)
 * are entered manually for now; auto-calculation is deferred to a future
 * calculation/formula support feature (identified in Stage 2.5 scope notes).
 */
import { PrismaClient, Role, PartyType } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ORG_ID = 'org_demo';
const ORG_NAME = 'Thulir Demo Lab';

async function main() {
  // ──────────────────────────────────────────────────────────────────────
  // Organization — upsert by stable ID (never touches existing)
  // ──────────────────────────────────────────────────────────────────────

  await prisma.organization.upsert({
    where: { id: ORG_ID },
    update: {},
    create: { id: ORG_ID, name: ORG_NAME },
  });
  console.log(`Organization "${ORG_NAME}" (${ORG_ID}) ensured`);

  // ──────────────────────────────────────────────────────────────────────
  // Sample Types — upsert by stable IDs
  // ──────────────────────────────────────────────────────────────────────

  const sampleTypes = [
    { id: 'st_edta', name: 'EDTA Blood', code: 'EDTA' },
    { id: 'st_serum', name: 'Serum', code: 'SER' },
    { id: 'st_urine', name: 'Urine', code: 'URN' },
    { id: 'st_whole_blood', name: 'Whole Blood', code: 'WB' },
    { id: 'st_plasma', name: 'Plasma', code: 'PLA' },
  ];

  for (const st of sampleTypes) {
    await prisma.sampleType.upsert({
      where: { id: st.id },
      update: {},
      create: { id: st.id, organizationId: ORG_ID, name: st.name, code: st.code },
    });
  }
  console.log(`Ensured ${sampleTypes.length} sample types`);

  // ──────────────────────────────────────────────────────────────────────
  // Standalone tests + panel sub-tests — createMany with skipDuplicates
  // keyed by @@unique([organizationId, testCode])
  // ──────────────────────────────────────────────────────────────────────

  const tests = [
    // ── CBC sub-tests (package pkg_cbc) ────────────────────────────────
    { id: 't_cbc_wbc', testCode: 'WBC', testName: 'White Blood Cell Count', currentPrice: 50, requiredSampleTypeId: 'st_edta', defaultRefLow: 4000, defaultRefHigh: 11000, criticalLow: 1000, criticalHigh: 30000, unit: 'cells/mcL' },
    { id: 't_cbc_rbc', testCode: 'RBC', testName: 'Red Blood Cell Count', currentPrice: 40, requiredSampleTypeId: 'st_edta', defaultRefLow: 4.5, defaultRefHigh: 5.5, unit: 'million cells/mcL' },
    { id: 't_cbc_hgb', testCode: 'HGB', testName: 'Hemoglobin', currentPrice: 60, requiredSampleTypeId: 'st_edta', defaultRefLow: 12, defaultRefHigh: 16, unit: 'g/dL' },
    { id: 't_cbc_hct', testCode: 'HCT', testName: 'Hematocrit', currentPrice: 40, requiredSampleTypeId: 'st_edta', defaultRefLow: 36, defaultRefHigh: 46, unit: '%' },
    { id: 't_cbc_mcv', testCode: 'MCV', testName: 'Mean Corpuscular Volume', currentPrice: 30, requiredSampleTypeId: 'st_edta', defaultRefLow: 80, defaultRefHigh: 100, unit: 'fL' },
    { id: 't_cbc_mch', testCode: 'MCH', testName: 'Mean Corpuscular Hemoglobin', currentPrice: 30, requiredSampleTypeId: 'st_edta', defaultRefLow: 27, defaultRefHigh: 31, unit: 'pg' },
    { id: 't_cbc_mchc', testCode: 'MCHC', testName: 'Mean Corpuscular Hemoglobin Concentration', currentPrice: 30, requiredSampleTypeId: 'st_edta', defaultRefLow: 32, defaultRefHigh: 36, unit: 'g/dL' },
    { id: 't_cbc_rdw', testCode: 'RDW', testName: 'Red Cell Distribution Width', currentPrice: 25, requiredSampleTypeId: 'st_edta', defaultRefLow: 11.5, defaultRefHigh: 14.5, unit: '%' },
    { id: 't_cbc_plt', testCode: 'PLT', testName: 'Platelet Count', currentPrice: 50, requiredSampleTypeId: 'st_edta', defaultRefLow: 150000, defaultRefHigh: 400000, criticalLow: 50000, criticalHigh: 800000, unit: 'cells/mcL' },
    { id: 't_cbc_neut', testCode: 'NEUT', testName: 'Neutrophils', currentPrice: 20, requiredSampleTypeId: 'st_edta', defaultRefLow: 40, defaultRefHigh: 70, unit: '%' },
    { id: 't_cbc_lymph', testCode: 'LYMPH', testName: 'Lymphocytes', currentPrice: 20, requiredSampleTypeId: 'st_edta', defaultRefLow: 20, defaultRefHigh: 40, unit: '%' },
    { id: 't_cbc_mono', testCode: 'MONO', testName: 'Monocytes', currentPrice: 20, requiredSampleTypeId: 'st_edta', defaultRefLow: 2, defaultRefHigh: 10, unit: '%' },
    { id: 't_cbc_eo', testCode: 'EO', testName: 'Eosinophils', currentPrice: 20, requiredSampleTypeId: 'st_edta', defaultRefLow: 1, defaultRefHigh: 6, unit: '%' },
    { id: 't_cbc_baso', testCode: 'BASO', testName: 'Basophils', currentPrice: 15, requiredSampleTypeId: 'st_edta', defaultRefLow: 0, defaultRefHigh: 2, unit: '%' },

    // ── Standalone tests (not in any panel) ────────────────────────────
    { id: 't_esr', testCode: 'ESR', testName: 'Erythrocyte Sedimentation Rate', currentPrice: 250, requiredSampleTypeId: 'st_edta', defaultRefLow: 0, defaultRefHigh: 20, unit: 'mm/hr' },
    { id: 't_bloodgroup', testCode: 'BG', testName: 'Blood Group & Rh Typing', currentPrice: 150, requiredSampleTypeId: 'st_edta', resultType: 'options' as const, resultOptions: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
    { id: 't_urine', testCode: 'URT', testName: 'Urine Routine & Microscopy', currentPrice: 200, requiredSampleTypeId: 'st_urine', resultType: 'text' as const },
    { id: 't_vitd', testCode: 'VITD', testName: 'Vitamin D (25-OH)', currentPrice: 1200, requiredSampleTypeId: 'st_serum', defaultRefLow: 30, defaultRefHigh: 100, criticalLow: 10, criticalHigh: 200, unit: 'ng/mL' },
    { id: 't_crp', testCode: 'CRP', testName: 'C-Reactive Protein', currentPrice: 450, requiredSampleTypeId: 'st_serum', defaultRefLow: 0, defaultRefHigh: 5, criticalLow: 10, criticalHigh: 200, unit: 'mg/L' },

    // ── Diabetes individual tests ──────────────────────────────────────
    { id: 't_fbs', testCode: 'FBS', testName: 'Fasting Blood Sugar', currentPrice: 150, requiredSampleTypeId: 'st_serum', defaultRefLow: 70, defaultRefHigh: 100, criticalLow: 40, criticalHigh: 400, unit: 'mg/dL' },
    { id: 't_ppbs', testCode: 'PPBS', testName: 'Post-Prandial Blood Sugar (2-hr)', currentPrice: 150, requiredSampleTypeId: 'st_serum', defaultRefLow: 70, defaultRefHigh: 140, unit: 'mg/dL' },
    { id: 't_hba1c', testCode: 'HBA1C', testName: 'Glycated Haemoglobin (HbA1c)', currentPrice: 600, requiredSampleTypeId: 'st_edta', requiresDedicatedSample: true, defaultRefLow: 4, defaultRefHigh: 5.6, criticalLow: 3, criticalHigh: 15, unit: '%' },

    // ── LFT sub-tests (package pkg_lft) ────────────────────────────────
    { id: 't_lft_bili_total', testCode: 'TBIL', testName: 'Total Bilirubin', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.1, defaultRefHigh: 1.2, unit: 'mg/dL' },
    { id: 't_lft_bili_direct', testCode: 'DBIL', testName: 'Direct (Conjugated) Bilirubin', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.0, defaultRefHigh: 0.3, unit: 'mg/dL' },
    { id: 't_lft_bili_indirect', testCode: 'IBIL', testName: 'Indirect (Unconjugated) Bilirubin', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.2, defaultRefHigh: 0.9, unit: 'mg/dL' },
    { id: 't_lft_sgot', testCode: 'AST', testName: 'SGOT / AST', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 8, defaultRefHigh: 40, unit: 'U/L' },
    { id: 't_lft_sgpt', testCode: 'ALT', testName: 'SGPT / ALT', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 7, defaultRefHigh: 56, unit: 'U/L' },
    { id: 't_lft_alp', testCode: 'ALP', testName: 'Alkaline Phosphatase (ALP)', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 44, defaultRefHigh: 147, unit: 'U/L' },
    { id: 't_lft_tp', testCode: 'TP', testName: 'Total Protein', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 6.0, defaultRefHigh: 8.3, unit: 'g/dL' },
    { id: 't_lft_albumin', testCode: 'ALB', testName: 'Albumin', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 3.5, defaultRefHigh: 5.0, unit: 'g/dL' },
    { id: 't_lft_globulin', testCode: 'GLOB', testName: 'Globulin', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 2.0, defaultRefHigh: 3.5, unit: 'g/dL' },
    { id: 't_lft_ag_ratio', testCode: 'AGR', testName: 'A:G Ratio', currentPrice: 40, requiredSampleTypeId: 'st_serum', defaultRefLow: 1.1, defaultRefHigh: 2.2, unit: '' },

    // ── RFT core sub-tests (package pkg_rft) ───────────────────────────
    { id: 't_rft_urea', testCode: 'UREA', testName: 'Blood Urea', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 15, defaultRefHigh: 40, unit: 'mg/dL' },
    { id: 't_rft_creat', testCode: 'CREAT', testName: 'Serum Creatinine', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.6, defaultRefHigh: 1.3, unit: 'mg/dL' },
    { id: 't_rft_uric', testCode: 'URIC', testName: 'Uric Acid', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 2.4, defaultRefHigh: 7.0, unit: 'mg/dL' },
    { id: 't_rft_egfr', testCode: 'EGFR', testName: 'eGFR', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 90, defaultRefHigh: 999, unit: 'mL/min/1.73m²' },

    // ── RFT comprehensive add-on: electrolytes ─────────────────────────
    { id: 't_rft_sodium', testCode: 'NA', testName: 'Sodium', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 136, defaultRefHigh: 145, criticalLow: 120, criticalHigh: 160, unit: 'mEq/L' },
    { id: 't_rft_potassium', testCode: 'K', testName: 'Potassium', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 3.5, defaultRefHigh: 5.0, criticalLow: 2.5, criticalHigh: 6.5, unit: 'mEq/L' },
    { id: 't_rft_chloride', testCode: 'CL', testName: 'Chloride', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 98, defaultRefHigh: 106, unit: 'mEq/L' },
    { id: 't_rft_calcium', testCode: 'CA', testName: 'Calcium', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 8.5, defaultRefHigh: 10.5, unit: 'mg/dL' },

    // ── Lipid Profile sub-tests (package pkg_lipid) ─────────────────────
    { id: 't_lip_total', testCode: 'TCHOL', testName: 'Total Cholesterol', currentPrice: 80, requiredSampleTypeId: 'st_serum', defaultRefLow: 125, defaultRefHigh: 200, unit: 'mg/dL' },
    { id: 't_lip_trig', testCode: 'TRIG', testName: 'Triglycerides', currentPrice: 80, requiredSampleTypeId: 'st_serum', defaultRefLow: 25, defaultRefHigh: 150, unit: 'mg/dL' },
    { id: 't_lip_hdl', testCode: 'HDL', testName: 'HDL Cholesterol', currentPrice: 80, requiredSampleTypeId: 'st_serum', defaultRefLow: 40, defaultRefHigh: 120, unit: 'mg/dL' },
    { id: 't_lip_ldl', testCode: 'LDL', testName: 'LDL Cholesterol', currentPrice: 80, requiredSampleTypeId: 'st_serum', defaultRefLow: 0, defaultRefHigh: 100, unit: 'mg/dL' },
    { id: 't_lip_vldl', testCode: 'VLDL', testName: 'VLDL', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 5, defaultRefHigh: 40, unit: 'mg/dL' },

    // ── Thyroid Profile sub-tests (package pkg_thyroid) ─────────────────
    { id: 't_thy_tsh', testCode: 'TSH', testName: 'Thyroid Stimulating Hormone (TSH)', currentPrice: 150, requiredSampleTypeId: 'st_serum', requiresDedicatedSample: true, defaultRefLow: 0.4, defaultRefHigh: 4.0, criticalLow: 0.1, criticalHigh: 50, unit: 'mIU/L' },
    { id: 't_thy_ft3', testCode: 'FT3', testName: 'Free T3', currentPrice: 150, requiredSampleTypeId: 'st_serum', defaultRefLow: 2.3, defaultRefHigh: 4.2, unit: 'pg/mL' },
    { id: 't_thy_ft4', testCode: 'FT4', testName: 'Free T4', currentPrice: 150, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.8, defaultRefHigh: 1.8, unit: 'ng/dL' },
  ];

  await prisma.masterTest.createMany({
    data: tests.map((t) => ({
      id: t.id,
      organizationId: ORG_ID,
      testCode: t.testCode,
      testName: t.testName,
      currentPrice: t.currentPrice,
      requiredSampleTypeId: t.requiredSampleTypeId,
      ...(t.requiresDedicatedSample ? { requiresDedicatedSample: true } : {}),
      ...(t.resultType ? { resultType: t.resultType } : {}),
      ...(t.resultOptions ? { resultOptions: t.resultOptions } : {}),
      ...(t.defaultRefLow !== undefined ? { defaultRefLow: t.defaultRefLow } : {}),
      ...(t.defaultRefHigh !== undefined ? { defaultRefHigh: t.defaultRefHigh } : {}),
      ...(t.criticalLow !== undefined ? { criticalLow: t.criticalLow } : {}),
      ...(t.criticalHigh !== undefined ? { criticalHigh: t.criticalHigh } : {}),
      ...(t.unit !== undefined ? { unit: t.unit } : {}),
    })),
    skipDuplicates: true,
  });
  console.log(`Ensured ${tests.length} tests (skipDuplicates: existing tests untouched)`);

  // ──────────────────────────────────────────────────────────────────────
  // TestSpecifications — sex-specific reference ranges
  // Keyed by @@unique([organizationId, testId, ageMinYears, ageMaxYears, sex])
  // ──────────────────────────────────────────────────────────────────────

  const specs = [
    { id: 'spec_uric_m', testId: 't_rft_uric', ageMinYears: 0, ageMaxYears: 120, sex: 'male' as const, refLow: 3.4, refHigh: 7.0 },
    { id: 'spec_uric_f', testId: 't_rft_uric', ageMinYears: 0, ageMaxYears: 120, sex: 'female' as const, refLow: 2.4, refHigh: 6.0 },
    { id: 'spec_hdl_m', testId: 't_lip_hdl', ageMinYears: 0, ageMaxYears: 120, sex: 'male' as const, refLow: 40, refHigh: 120 },
    { id: 'spec_hdl_f', testId: 't_lip_hdl', ageMinYears: 0, ageMaxYears: 120, sex: 'female' as const, refLow: 50, refHigh: 120 },
  ];

  await prisma.testSpecification.createMany({
    data: specs.map((s) => ({
      id: s.id,
      organizationId: ORG_ID,
      testId: s.testId,
      ageMinYears: s.ageMinYears,
      ageMaxYears: s.ageMaxYears,
      sex: s.sex,
      refLow: s.refLow,
      refHigh: s.refHigh,
    })),
    skipDuplicates: true,
  });
  console.log(`Ensured ${specs.length} TestSpecifications (skipDuplicates: existing specs untouched)`);

  // ──────────────────────────────────────────────────────────────────────
  // Packages — upsert by @@unique([organizationId, packageCode])
  // Items are created separately after (can't use nested create + skipDuplicates).
  // ──────────────────────────────────────────────────────────────────────

  type PackageSeed = {
    id: string;
    packageCode: string;
    packageName: string;
    packagePrice: number;
    itemTestIds: string[];
  };

  const packages: PackageSeed[] = [
    { id: 'pkg_cbc', packageCode: 'CBC-PANEL', packageName: 'CBC (Complete Blood Count)', packagePrice: 400,
      itemTestIds: ['t_cbc_wbc', 't_cbc_rbc', 't_cbc_hgb', 't_cbc_hct', 't_cbc_mcv', 't_cbc_mch', 't_cbc_mchc', 't_cbc_rdw', 't_cbc_plt', 't_cbc_neut', 't_cbc_lymph', 't_cbc_mono', 't_cbc_eo', 't_cbc_baso'] },
    { id: 'pkg_lft', packageCode: 'LFT-PANEL', packageName: 'LFT (Liver Function Test)', packagePrice: 550,
      itemTestIds: ['t_lft_bili_total', 't_lft_bili_direct', 't_lft_bili_indirect', 't_lft_sgot', 't_lft_sgpt', 't_lft_alp', 't_lft_tp', 't_lft_albumin', 't_lft_globulin', 't_lft_ag_ratio'] },
    { id: 'pkg_rft', packageCode: 'RFT-PANEL', packageName: 'RFT (Kidney Function Test)', packagePrice: 250,
      itemTestIds: ['t_rft_urea', 't_rft_creat', 't_rft_uric', 't_rft_egfr'] },
    { id: 'pkg_rft_comp', packageCode: 'RFT-COMP', packageName: 'RFT Comprehensive (Kidney + Electrolytes)', packagePrice: 500,
      itemTestIds: ['t_rft_urea', 't_rft_creat', 't_rft_uric', 't_rft_egfr', 't_rft_sodium', 't_rft_potassium', 't_rft_chloride', 't_rft_calcium'] },
    { id: 'pkg_lipid', packageCode: 'LIPID-PANEL', packageName: 'Lipid Profile', packagePrice: 400,
      itemTestIds: ['t_lip_total', 't_lip_trig', 't_lip_hdl', 't_lip_ldl', 't_lip_vldl'] },
    { id: 'pkg_thyroid', packageCode: 'THY-PANEL', packageName: 'Thyroid Profile', packagePrice: 450,
      itemTestIds: ['t_thy_tsh', 't_thy_ft3', 't_thy_ft4'] },
    { id: 'pkg_basic', packageCode: 'PKG-BASIC', packageName: 'Basic Health Check', packagePrice: 500,
      itemTestIds: ['t_cbc_wbc', 't_cbc_rbc', 't_cbc_hgb', 't_cbc_hct', 't_cbc_plt', 't_fbs', 't_lip_total'] },
    { id: 'pkg_diabetes', packageCode: 'PKG-DIAB', packageName: 'Diabetes Panel', packagePrice: 800,
      itemTestIds: ['t_fbs', 't_ppbs', 't_hba1c'] },
  ];

  for (const pkg of packages) {
    await prisma.masterTestPackage.upsert({
      where: { organizationId_packageCode: { organizationId: ORG_ID, packageCode: pkg.packageCode } },
      update: {},
      create: {
        id: pkg.id,
        organizationId: ORG_ID,
        packageCode: pkg.packageCode,
        packageName: pkg.packageName,
        packagePrice: pkg.packagePrice,
      },
    });
  }
  console.log(`Ensured ${packages.length} packages (upsert: existing packages untouched)`);

  // Package items — keyed by @@unique([packageId, testId]).
  // Creates missing items, silently skips existing ones.
  // Does NOT remove items a user may have added through the API.
  //
  // Robustness: if the DB already has a test with the same testCode
  // but a different ID (from an older seed that used a different ID
  // scheme), resolve the actual DB ID by code. This prevents FK
  // violations when the seed's hardcoded ID doesn't match what's in
  // the DB.
  const dbTests = await prisma.masterTest.findMany({
    where: { organizationId: ORG_ID },
    select: { id: true, testCode: true },
  });
  const codeToId = new Map<string, string>();
  for (const t of dbTests) codeToId.set(t.testCode, t.id);

  const allItems: { packageId: string; testId: string }[] = [];
  for (const pkg of packages) {
    for (const seedTestId of pkg.itemTestIds) {
      const seedTest = tests.find((t) => t.id === seedTestId);
      const actualId = codeToId.get(seedTest?.testCode ?? '') ?? seedTestId;
      allItems.push({ packageId: pkg.id, testId: actualId });
    }
  }
  await prisma.masterTestPackageItem.createMany({
    data: allItems,
    skipDuplicates: true,
  });
  console.log(`Ensured ${allItems.length} package items (skipDuplicates: existing items untouched)`);

  // ──────────────────────────────────────────────────────────────────────
  // Parties — upsert by stable IDs
  // ──────────────────────────────────────────────────────────────────────

  const parties = [
    { id: 'party_dr_kavitha', name: 'Dr. Kavitha Rajan', type: PartyType.doctor },
    { id: 'party_dr_arun', name: 'Dr. Arun Prakash', type: PartyType.doctor },
    { id: 'party_apollo', name: 'Apollo Referral Network', type: PartyType.hospital },
    { id: 'party_corp', name: 'Chennai Steelworks Corp', type: PartyType.corporate },
    { id: 'party_tpa', name: 'Thulir Health Insurance (TPA)', type: PartyType.insurance_tpa },
  ];

  for (const p of parties) {
    await prisma.party.upsert({
      where: { id: p.id },
      update: {},
      create: { id: p.id, organizationId: ORG_ID, name: p.name, type: p.type },
    });
  }
  console.log(`Ensured ${parties.length} parties`);

  // ──────────────────────────────────────────────────────────────────────
  // Admin user — upsert by username (globally unique)
  // ──────────────────────────────────────────────────────────────────────

  const passwordHash = await bcrypt.hash('Thulir@123', 10);
  await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      id: 'user_admin',
      organizationId: ORG_ID,
      username: 'admin',
      passwordHash,
      role: Role.admin,
    },
  });
  console.log('Ensured admin user (username: admin / password: Thulir@123)');

  // ──────────────────────────────────────────────────────────────────────
  // Configurable Title list — upsert by @@unique([organizationId, category, value])
  // ──────────────────────────────────────────────────────────────────────

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
  console.log(`Ensured ${defaultTitles.length} title options`);

  console.log(`Seed complete. Organization "${ORG_NAME}" (${ORG_ID}) is ready.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
