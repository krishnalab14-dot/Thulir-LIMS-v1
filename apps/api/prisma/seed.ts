/**
 * Thulir LIMS — Seed.
 *
 * Creates the demo organization (`org_demo`), an admin user, sample types,
 * a priced test catalog with standard panels, and a few referral parties so
 * the registration → order → billing flow can be exercised end to end.
 *
 * Uses its own plain PrismaClient (no tenant extension) and truncates + re-inserts,
 * so it is safe to re-run. Requires the schema to be migrated first:
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

  // ──────────────────────────────────────────────────────────────────────
  // Standalone tests + panel sub-tests
  // ──────────────────────────────────────────────────────────────────────

  await prisma.masterTest.createMany({
    data: [
      // ── CBC sub-tests (package pkg_cbc) ────────────────────────────────
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

      // ── Standalone tests (not in any panel) ────────────────────────────
      { id: 't_esr', organizationId: ORG_ID, testCode: 'ESR', testName: 'Erythrocyte Sedimentation Rate', currentPrice: 250, requiredSampleTypeId: 'st_edta', defaultRefLow: 0, defaultRefHigh: 20, unit: 'mm/hr' },
      { id: 't_bloodgroup', organizationId: ORG_ID, testCode: 'BG', testName: 'Blood Group & Rh Typing', currentPrice: 150, requiredSampleTypeId: 'st_edta', resultType: 'options', resultOptions: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] },
      { id: 't_urine', organizationId: ORG_ID, testCode: 'URT', testName: 'Urine Routine & Microscopy', currentPrice: 200, requiredSampleTypeId: 'st_urine', resultType: 'text' },
      { id: 't_vitd', organizationId: ORG_ID, testCode: 'VITD', testName: 'Vitamin D (25-OH)', currentPrice: 1200, requiredSampleTypeId: 'st_serum', defaultRefLow: 30, defaultRefHigh: 100, criticalLow: 10, criticalHigh: 200, unit: 'ng/mL' },
      { id: 't_crp', organizationId: ORG_ID, testCode: 'CRP', testName: 'C-Reactive Protein', currentPrice: 450, requiredSampleTypeId: 'st_serum', defaultRefLow: 0, defaultRefHigh: 5, criticalLow: 10, criticalHigh: 200, unit: 'mg/L' },

      // ── Diabetes individual tests ──────────────────────────────────────
      // FBS: criticalLow/High are well-established/uncontroversial defaults.
      { id: 't_fbs', organizationId: ORG_ID, testCode: 'FBS', testName: 'Fasting Blood Sugar', currentPrice: 150, requiredSampleTypeId: 'st_serum', defaultRefLow: 70, defaultRefHigh: 100, criticalLow: 40, criticalHigh: 400, unit: 'mg/dL' },
      // PPBS (2-hour post-prandial)
      { id: 't_ppbs', organizationId: ORG_ID, testCode: 'PPBS', testName: 'Post-Prandial Blood Sugar (2-hr)', currentPrice: 150, requiredSampleTypeId: 'st_serum', defaultRefLow: 70, defaultRefHigh: 140, unit: 'mg/dL' },
      // HbA1c — demands a dedicated EDTA tube (contamination-sensitive assay)
      { id: 't_hba1c', organizationId: ORG_ID, testCode: 'HBA1C', testName: 'Glycated Haemoglobin (HbA1c)', currentPrice: 600, requiredSampleTypeId: 'st_edta', requiresDedicatedSample: true, defaultRefLow: 4, defaultRefHigh: 5.6, criticalLow: 3, criticalHigh: 15, unit: '%' },

      // ── LFT sub-tests (package pkg_lft) ────────────────────────────────
      // Pathologist should review all ranges before going live.
      { id: 't_lft_bili_total', organizationId: ORG_ID, testCode: 'TBIL', testName: 'Total Bilirubin', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.1, defaultRefHigh: 1.2, unit: 'mg/dL' },
      { id: 't_lft_bili_direct', organizationId: ORG_ID, testCode: 'DBIL', testName: 'Direct (Conjugated) Bilirubin', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.0, defaultRefHigh: 0.3, unit: 'mg/dL' },
      // Indirect Bilirubin: calculated = Total − Direct in real practice; manual entry for now.
      { id: 't_lft_bili_indirect', organizationId: ORG_ID, testCode: 'IBIL', testName: 'Indirect (Unconjugated) Bilirubin', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.2, defaultRefHigh: 0.9, unit: 'mg/dL' },
      { id: 't_lft_sgot', organizationId: ORG_ID, testCode: 'AST', testName: 'SGOT / AST', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 8, defaultRefHigh: 40, unit: 'U/L' },
      { id: 't_lft_sgpt', organizationId: ORG_ID, testCode: 'ALT', testName: 'SGPT / ALT', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 7, defaultRefHigh: 56, unit: 'U/L' },
      { id: 't_lft_alp', organizationId: ORG_ID, testCode: 'ALP', testName: 'Alkaline Phosphatase (ALP)', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 44, defaultRefHigh: 147, unit: 'U/L' },
      { id: 't_lft_tp', organizationId: ORG_ID, testCode: 'TP', testName: 'Total Protein', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 6.0, defaultRefHigh: 8.3, unit: 'g/dL' },
      { id: 't_lft_albumin', organizationId: ORG_ID, testCode: 'ALB', testName: 'Albumin', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 3.5, defaultRefHigh: 5.0, unit: 'g/dL' },
      // Globulin: calculated = Total Protein − Albumin in real practice; manual entry for now.
      { id: 't_lft_globulin', organizationId: ORG_ID, testCode: 'GLOB', testName: 'Globulin', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 2.0, defaultRefHigh: 3.5, unit: 'g/dL' },
      // A:G Ratio: calculated = Albumin ÷ Globulin in real practice; manual entry for now.
      { id: 't_lft_ag_ratio', organizationId: ORG_ID, testCode: 'AGR', testName: 'A:G Ratio', currentPrice: 40, requiredSampleTypeId: 'st_serum', defaultRefLow: 1.1, defaultRefHigh: 2.2, unit: '' },

      // ── RFT core sub-tests (package pkg_rft) ───────────────────────────
      { id: 't_rft_urea', organizationId: ORG_ID, testCode: 'UREA', testName: 'Blood Urea', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 15, defaultRefHigh: 40, unit: 'mg/dL' },
      { id: 't_rft_creat', organizationId: ORG_ID, testCode: 'CREAT', testName: 'Serum Creatinine', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.6, defaultRefHigh: 1.3, unit: 'mg/dL' },
      // Uric Acid: sex-specific via TestSpecification (seeded below).
      // Default is the combined adult range; spec overrides resolve at order time.
      { id: 't_rft_uric', organizationId: ORG_ID, testCode: 'URIC', testName: 'Uric Acid', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 2.4, defaultRefHigh: 7.0, unit: 'mg/dL' },
      // eGFR: calculated (CKD-EPI, needs age+sex+creatinine) — manual entry for now.
      { id: 't_rft_egfr', organizationId: ORG_ID, testCode: 'EGFR', testName: 'eGFR', currentPrice: 50, requiredSampleTypeId: 'st_serum', defaultRefLow: 90, defaultRefHigh: 999, unit: 'mL/min/1.73m²' },

      // ── RFT comprehensive add-on: electrolytes ─────────────────────────
      // Potassium critical range: well-established/uncontroversial.
      { id: 't_rft_sodium', organizationId: ORG_ID, testCode: 'NA', testName: 'Sodium', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 136, defaultRefHigh: 145, criticalLow: 120, criticalHigh: 160, unit: 'mEq/L' },
      { id: 't_rft_potassium', organizationId: ORG_ID, testCode: 'K', testName: 'Potassium', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 3.5, defaultRefHigh: 5.0, criticalLow: 2.5, criticalHigh: 6.5, unit: 'mEq/L' },
      { id: 't_rft_chloride', organizationId: ORG_ID, testCode: 'CL', testName: 'Chloride', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 98, defaultRefHigh: 106, unit: 'mEq/L' },
      { id: 't_rft_calcium', organizationId: ORG_ID, testCode: 'CA', testName: 'Calcium', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 8.5, defaultRefHigh: 10.5, unit: 'mg/dL' },

      // ── Lipid Profile sub-tests (package pkg_lipid) ─────────────────────
      { id: 't_lip_total', organizationId: ORG_ID, testCode: 'TCHOL', testName: 'Total Cholesterol', currentPrice: 80, requiredSampleTypeId: 'st_serum', defaultRefLow: 125, defaultRefHigh: 200, unit: 'mg/dL' },
      { id: 't_lip_trig', organizationId: ORG_ID, testCode: 'TRIG', testName: 'Triglycerides', currentPrice: 80, requiredSampleTypeId: 'st_serum', defaultRefLow: 25, defaultRefHigh: 150, unit: 'mg/dL' },
      // HDL: sex-specific via TestSpecification (seeded below).
      { id: 't_lip_hdl', organizationId: ORG_ID, testCode: 'HDL', testName: 'HDL Cholesterol', currentPrice: 80, requiredSampleTypeId: 'st_serum', defaultRefLow: 40, defaultRefHigh: 120, unit: 'mg/dL' },
      { id: 't_lip_ldl', organizationId: ORG_ID, testCode: 'LDL', testName: 'LDL Cholesterol', currentPrice: 80, requiredSampleTypeId: 'st_serum', defaultRefLow: 0, defaultRefHigh: 100, unit: 'mg/dL' },
      // VLDL: calculated = Triglycerides ÷ 5 in real practice; manual entry for now.
      { id: 't_lip_vldl', organizationId: ORG_ID, testCode: 'VLDL', testName: 'VLDL', currentPrice: 60, requiredSampleTypeId: 'st_serum', defaultRefLow: 5, defaultRefHigh: 40, unit: 'mg/dL' },

      // ── Thyroid Profile sub-tests (package pkg_thyroid) ─────────────────
      // TSH: critical thresholds are well-established.
      { id: 't_thy_tsh', organizationId: ORG_ID, testCode: 'TSH', testName: 'Thyroid Stimulating Hormone (TSH)', currentPrice: 150, requiredSampleTypeId: 'st_serum', requiresDedicatedSample: true, defaultRefLow: 0.4, defaultRefHigh: 4.0, criticalLow: 0.1, criticalHigh: 50, unit: 'mIU/L' },
      { id: 't_thy_ft3', organizationId: ORG_ID, testCode: 'FT3', testName: 'Free T3', currentPrice: 150, requiredSampleTypeId: 'st_serum', defaultRefLow: 2.3, defaultRefHigh: 4.2, unit: 'pg/mL' },
      { id: 't_thy_ft4', organizationId: ORG_ID, testCode: 'FT4', testName: 'Free T4', currentPrice: 150, requiredSampleTypeId: 'st_serum', defaultRefLow: 0.8, defaultRefHigh: 1.8, unit: 'ng/dL' },
    ],
  });
  console.log('Seeded standalone tests + CBC/LFT/RFT/Lipid/Thyroid sub-tests');

  // ──────────────────────────────────────────────────────────────────────
  // TestSpecifications — sex-specific reference ranges
  // ──────────────────────────────────────────────────────────────────────

  await prisma.testSpecification.createMany({
    data: [
      // Uric Acid — male range wider at upper end
      { id: 'spec_uric_m', organizationId: ORG_ID, testId: 't_rft_uric', ageMinYears: 0, ageMaxYears: 120, sex: 'male', refLow: 3.4, refHigh: 7.0 },
      { id: 'spec_uric_f', organizationId: ORG_ID, testId: 't_rft_uric', ageMinYears: 0, ageMaxYears: 120, sex: 'female', refLow: 2.4, refHigh: 6.0 },
      // HDL — females typically higher
      { id: 'spec_hdl_m', organizationId: ORG_ID, testId: 't_lip_hdl', ageMinYears: 0, ageMaxYears: 120, sex: 'male', refLow: 40, refHigh: 120 },
      { id: 'spec_hdl_f', organizationId: ORG_ID, testId: 't_lip_hdl', ageMinYears: 0, ageMaxYears: 120, sex: 'female', refLow: 50, refHigh: 120 },
    ],
  });
  console.log('Seeded 4 TestSpecifications (Uric Acid + HDL sex overrides)');

  // ──────────────────────────────────────────────────────────────────────
  // Packages
  // ──────────────────────────────────────────────────────────────────────

  // CBC Panel — 14 sub-tests, matching the existing CBC fix pattern.
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

  // LFT Panel — 10 sub-tests (replaces the old single-column t_lft test).
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_lft',
      organizationId: ORG_ID,
      packageCode: 'LFT-PANEL',
      packageName: 'LFT (Liver Function Test)',
      packagePrice: 550,
      items: {
        create: [
          { testId: 't_lft_bili_total' }, { testId: 't_lft_bili_direct' },
          { testId: 't_lft_bili_indirect' }, { testId: 't_lft_sgot' },
          { testId: 't_lft_sgpt' }, { testId: 't_lft_alp' },
          { testId: 't_lft_tp' }, { testId: 't_lft_albumin' },
          { testId: 't_lft_globulin' }, { testId: 't_lft_ag_ratio' },
        ],
      },
    },
  });
  console.log('Seeded LFT panel (10 sub-tests)');

  // RFT Core Panel — 4 sub-tests (replaces the old single-column t_kft test).
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_rft',
      organizationId: ORG_ID,
      packageCode: 'RFT-PANEL',
      packageName: 'RFT (Kidney Function Test)',
      packagePrice: 250,
      items: {
        create: [
          { testId: 't_rft_urea' }, { testId: 't_rft_creat' },
          { testId: 't_rft_uric' }, { testId: 't_rft_egfr' },
        ],
      },
    },
  });
  console.log('Seeded RFT core panel (4 sub-tests)');

  // RFT Comprehensive Panel — 8 sub-tests (core + electrolytes).
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_rft_comp',
      organizationId: ORG_ID,
      packageCode: 'RFT-COMP',
      packageName: 'RFT Comprehensive (Kidney + Electrolytes)',
      packagePrice: 500,
      items: {
        create: [
          { testId: 't_rft_urea' }, { testId: 't_rft_creat' },
          { testId: 't_rft_uric' }, { testId: 't_rft_egfr' },
          { testId: 't_rft_sodium' }, { testId: 't_rft_potassium' },
          { testId: 't_rft_chloride' }, { testId: 't_rft_calcium' },
        ],
      },
    },
  });
  console.log('Seeded RFT Comprehensive panel (8 sub-tests)');

  // Lipid Profile Panel — 5 sub-tests (replaces the old single-column t_lipid test).
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_lipid',
      organizationId: ORG_ID,
      packageCode: 'LIPID-PANEL',
      packageName: 'Lipid Profile',
      packagePrice: 400,
      items: {
        create: [
          { testId: 't_lip_total' }, { testId: 't_lip_trig' },
          { testId: 't_lip_hdl' }, { testId: 't_lip_ldl' },
          { testId: 't_lip_vldl' },
        ],
      },
    },
  });
  console.log('Seeded Lipid Profile panel (5 sub-tests)');

  // Thyroid Profile Panel — 3 sub-tests (replaces the old single-column t_tsh test).
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_thyroid',
      organizationId: ORG_ID,
      packageCode: 'THY-PANEL',
      packageName: 'Thyroid Profile',
      packagePrice: 450,
      items: {
        create: [
          { testId: 't_thy_tsh' }, { testId: 't_thy_ft3' }, { testId: 't_thy_ft4' },
        ],
      },
    },
  });
  console.log('Seeded Thyroid Profile panel (3 sub-tests)');

  // Basic Health Check — updated: uses Total Cholesterol (from new lipid panel)
  // instead of the old monolithic t_lipid test, since t_lipid no longer exists.
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_basic',
      organizationId: ORG_ID,
      packageCode: 'PKG-BASIC',
      packageName: 'Basic Health Check',
      packagePrice: 500,
      items: {
        create: [
          { testId: 't_cbc_wbc' }, { testId: 't_cbc_rbc' }, { testId: 't_cbc_hgb' },
          { testId: 't_cbc_hct' }, { testId: 't_cbc_plt' }, { testId: 't_fbs' },
          { testId: 't_lip_total' },
        ],
      },
    },
  });

  // Diabetes Panel — updated: includes PPBS alongside FBS + HbA1c.
  await prisma.masterTestPackage.create({
    data: {
      id: 'pkg_diabetes',
      organizationId: ORG_ID,
      packageCode: 'PKG-DIAB',
      packageName: 'Diabetes Panel',
      packagePrice: 800,
      items: { create: [{ testId: 't_fbs' }, { testId: 't_ppbs' }, { testId: 't_hba1c' }] },
    },
  });
  console.log('Seeded 8 packages (CBC, LFT, RFT, RFT Comp, Lipid, Thyroid, Basic, Diabetes)');

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
