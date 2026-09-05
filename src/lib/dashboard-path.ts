import type { Role } from "@prisma/client";

const DASHBOARD_BY_ROLE: Record<Role, string> = {
  TEACHER: "/teacher/dashboard",
  STUDENT: "/student/dashboard",
};

export function dashboardPathForRole(role: Role): string {
  return DASHBOARD_BY_ROLE[role];
}
