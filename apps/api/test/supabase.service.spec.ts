import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../src/supabase/supabase.service';

// Mock the supabase-js module so no network/config is needed in unit tests.
const mockCreateClient = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

const mockGetUser = jest.fn();
mockCreateClient.mockImplementation(() => ({ auth: { getUser: mockGetUser } }));

function serviceWith(env: Record<string, string>): SupabaseService {
  return new SupabaseService(new ConfigService(env));
}

describe('SupabaseService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('isConfigured() is false until SUPABASE_URL and SUPABASE_ANON_KEY are set', () => {
    expect(serviceWith({}).isConfigured()).toBe(false);
    expect(serviceWith({ SUPABASE_URL: 'https://abc.supabase.co' }).isConfigured()).toBe(false);
    expect(serviceWith({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon' }).isConfigured()).toBe(true);
  });

  it('constructs fine without any keys (app must boot before Keys tab is populated)', () => {
    expect(() => serviceWith({})).not.toThrow();
  });

  it('getAnonClient() throws a clear config error when keys are missing, without touching the network', () => {
    expect(() => serviceWith({}).getAnonClient()).toThrow('SUPABASE_URL and SUPABASE_ANON_KEY');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('getAdminClient() throws a clear config error when the service-role key is missing', () => {
    const svc = serviceWith({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon' });
    expect(() => svc.getAdminClient()).toThrow('SUPABASE_SERVICE_ROLE_KEY');
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it('creates the anon client once and reuses it (lazy singleton)', () => {
    const svc = serviceWith({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon' });
    const a = svc.getAnonClient();
    const b = svc.getAnonClient();
    expect(a).toBe(b);
    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://abc.supabase.co',
      'anon',
      expect.objectContaining({ auth: { persistSession: false, autoRefreshToken: false } }),
    );
  });

  it('verifyToken() returns the user for a valid JWT', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.c' } }, error: null });
    const svc = serviceWith({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon' });
    await expect(svc.verifyToken('jwt')).resolves.toEqual({ id: 'u1', email: 'a@b.c' });
    expect(mockGetUser).toHaveBeenCalledWith('jwt');
  });

  it('verifyToken() propagates a Supabase auth error', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: new Error('invalid JWT') });
    const svc = serviceWith({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'anon' });
    await expect(svc.verifyToken('bad')).rejects.toThrow('invalid JWT');
  });

  it('exposes the project ref from SUPABASE_PROJECT_REF', () => {
    expect(serviceWith({ SUPABASE_PROJECT_REF: 'abc' }).projectRef).toBe('abc');
    expect(serviceWith({}).projectRef).toBeUndefined();
  });
});
