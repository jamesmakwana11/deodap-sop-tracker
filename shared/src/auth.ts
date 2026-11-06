export const ROLES = ['viewer', 'auditor', 'admin'] as const;
export type Role = (typeof ROLES)[number];

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}

export interface UserSummary extends AuthUser {
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

/** viewer < auditor < admin. */
export function hasRole(user: Pick<AuthUser, 'role'> | null | undefined, required: Role): boolean {
  if (!user) return false;
  return ROLES.indexOf(user.role) >= ROLES.indexOf(required);
}

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  viewer: 'Read the dashboard, campaign details, history and reports.',
  auditor: 'Viewer, plus manual verification and starting a Meta refresh.',
  admin: 'Auditor, plus Meta connection, ad account selection, schedule and users.',
};

export const MIN_PASSWORD_LENGTH = 10;
