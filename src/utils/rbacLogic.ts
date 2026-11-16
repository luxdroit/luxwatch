import type { UserRole } from '../types.ts';

export function canManageContent(role: UserRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canCreateUserWithRole(
  actorRole: UserRole,
  targetRole: UserRole
): boolean {
  if (actorRole === 'owner') {
    return targetRole === 'admin' || targetRole === 'normal';
  }
  if (actorRole === 'admin') {
    return targetRole === 'normal';
  }
  return false;
}

export function canDeleteUser(
  actorRole: UserRole,
  actorId: number,
  targetRole: UserRole,
  targetId: number
): boolean {
  if (actorId === targetId) {
    return false;
  }
  if (targetRole === 'owner') {
    return false;
  }
  if (actorRole === 'owner') {
    return targetRole === 'admin' || targetRole === 'normal';
  }
  if (actorRole === 'admin') {
    return targetRole === 'normal';
  }
  return false;
}

export function canViewUserInManagement(
  actorRole: UserRole,
  targetRole: UserRole
): boolean {
  if (actorRole === 'owner') {
    return true;
  }
  if (actorRole === 'admin') {
    return targetRole === 'normal';
  }
  return false;
}
