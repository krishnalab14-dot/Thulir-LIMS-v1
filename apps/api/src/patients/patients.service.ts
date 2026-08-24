import { BadRequestException, Injectable } from '@nestjs/common';
import { Patient, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../prisma/tenant-context.service';
import { CheckDuplicateQueryDto } from './dto/check-duplicate-query.dto';
import { CreatePatientDto } from './dto/create-patient.dto';
import { assertNewPatientIdentity, PatientDemographicsInput, resolveDobAndAge } from './patient-demographics.util';
import { nextPatientUid } from './patient-uid.util';

const PATIENT_LIST_SELECT = {
  id: true,
  patientUid: true,
  title: true,
  firstName: true,
  lastName: true,
  gender: true,
  mobile: true,
  dob: true,
  email: true,
  externalMrn: true,
  createdAt: true,
} satisfies Prisma.PatientSelect;

@Injectable()
export class PatientsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenant: TenantContextService,
  ) {}

  /**
   * Duplicate detection for the registration wizard. Requires a mobile number
   * or a free-text term; matches mobile, name, external MRN and patientUid.
   */
  async checkDuplicate(query: CheckDuplicateQueryDto) {
    const mobile = query.mobile?.trim();
    const term = query.q?.trim();

    if (!mobile && !term && !query.firstName && !query.lastName) {
      throw new BadRequestException('Provide a mobile number or a search term');
    }

    const or: Prisma.PatientWhereInput[] = [];
    if (mobile) {
      or.push({ mobile: { contains: mobile } });
    }
    if (term) {
      // The registration corner-search sends only ?q= — staff type whatever
      // they have (name, PID, MRN, or a phone number), so the free-text term
      // must also match mobile for returning-patient lookup by phone.
      or.push(
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
        { externalMrn: { contains: term, mode: 'insensitive' } },
        { patientUid: { contains: term, mode: 'insensitive' } },
        { mobile: { contains: term } },
      );
    }
    if (query.firstName?.trim()) {
      or.push({ firstName: { contains: query.firstName.trim(), mode: 'insensitive' } });
    }
    if (query.lastName?.trim()) {
      or.push({ lastName: { contains: query.lastName.trim(), mode: 'insensitive' } });
    }

    const patients = await this.prisma.prisma.patient.findMany({
      where: { OR: or },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: PATIENT_LIST_SELECT,
    });
    return { count: patients.length, results: patients };
  }

  /** Public entry: POST /api/patients (own transaction). */
  async create(dto: CreatePatientDto): Promise<Patient> {
    const orgId = this.tenant.requireOrganizationId();
    return this.prisma.prisma.$transaction((tx) => this.createPatientInTx(tx, orgId, dto));
  }

  /**
   * Creates a patient inside an existing transaction (used by POST /api/orders).
   * Runs the duplicate-ready identity checks + collision-safe patientUid
   * generation. The tenant extension verifies orgId consistency on write.
   */
  async createPatientInTx(
    tx: Prisma.TransactionClient,
    orgId: string,
    input: PatientDemographicsInput,
  ): Promise<Patient> {
    assertNewPatientIdentity(input);

    const { dob, age } = resolveDobAndAge(input.dob, input.ageAtRegistration);

    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org) {
      throw new BadRequestException('Organization not found');
    }

    const patientUid = await nextPatientUid(tx, org, new Date().getFullYear());

    return tx.patient.create({
      data: {
        organizationId: orgId,
        patientUid,
        title: input.title ?? null,
        firstName: input.firstName!.trim(),
        lastName: input.lastName!.trim(),
        dob,
        ageAtRegistration: age,
        gender: input.gender as Patient['gender'],
        mobile: input.mobile!.trim(),
        email: input.email ?? null,
        address: input.address ?? null,
        externalMrn: input.externalMrn ?? null,
        abhaNumber: input.abhaNumber ?? null,
        createdBy: this.tenant.requireUserId(),
      },
    });
  }
}
