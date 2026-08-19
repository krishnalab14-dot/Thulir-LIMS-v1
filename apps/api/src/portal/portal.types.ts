/**
 * Stage 8: Portal auth types — distinct from staff AuthUser (§0).
 *
 * Patient tokens:  { patientId, organizationId, type: 'patient' }
 * Referrer tokens: { partyId, organizationId, type: 'referrer' }
 *
 * These must NEVER satisfy the staff JwtAuthGuard / RolesGuard (§2 of the
 * stage spec), and staff tokens must never satisfy the portal guard. The
 * discriminated `type` field makes the boundary explicit.
 */

export interface PatientPortalUser {
  patientId: string;
  organizationId: string;
  type: 'patient';
}

export interface ReferrerPortalUser {
  partyId: string;
  organizationId: string;
  type: 'referrer';
}

export type PortalUser = PatientPortalUser | ReferrerPortalUser;

/** The access-token JWT payload for portal users. */
export interface PortalJwtPayload {
  sub: string;
  organizationId: string;
  type: 'patient' | 'referrer';
  /** Set for patient tokens. */
  patientId?: string;
  /** Set for referrer tokens. */
  partyId?: string;
}
