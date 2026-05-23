// User types for Recruiter Radar

export type UserRole = 'super_admin' | 'agency_admin' | 'admin' | 'manager' | 'recruiter' | 'user' | 'viewer';

export interface User {
  id: string;
  email: string;
  name: string;
  roles: UserRole[];
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface UserSession {
  userId: string;
  email: string;
  roles: UserRole[];
  permissions: string[];
  expiresAt: string;
}