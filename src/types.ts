export type ShiftType = 'morning' | 'evening' | 'special' | 'off' | 'vacation' | 'sick';

export interface Manager {
  id: string;
  name: string;
  isSpecial: boolean;
  allowSingleDaysOff: boolean;
  priorityLoading: boolean;
  vacations: { start: string; end: string }[];
  sickLeaves: { start: string; end: string }[];
  preferredDaysOff: string[]; // ISO date strings
}

export interface DayRequirement {
  dayOfWeek: number; // 0-6 (Sunday-Saturday)
  minMorning: number;
  minEvening: number;
}

export interface ShiftAssignment {
  managerId: string;
  date: string; // ISO date string
  type: ShiftType;
  isPreferenceIgnored?: boolean;
}

export interface Schedule {
  assignments: ShiftAssignment[];
  month: number;
  year: number;
}
