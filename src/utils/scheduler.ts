import { addDays, eachDayOfInterval, endOfMonth, format, getDay, isAfter, isBefore, isSameDay, parseISO, startOfMonth } from 'date-fns';
import { DayRequirement, Manager, Schedule, ShiftAssignment, ShiftType } from '../types';

export function generateSchedule(
  year: number,
  month: number,
  managers: Manager[],
  requirements: DayRequirement[]
): Schedule {
  const start = startOfMonth(new Date(year, month));
  const end = endOfMonth(start);
  const days = eachDayOfInterval({ start, end });

  const assignments: ShiftAssignment[] = [];
  const managerStats: Record<string, { 
    morningCount: number; 
    eveningCount: number; 
    weekendOffCount: number;
    consecutiveWorkDays: number;
    offCount: number;
  }> = {};
  
  managers.forEach(m => {
    managerStats[m.id] = { 
      morningCount: 0, 
      eveningCount: 0, 
      weekendOffCount: 0,
      consecutiveWorkDays: 0,
      offCount: 0
    };
  });

  // 1. Handle Special Managers (2 on / 2 off)
  const specialManagers = managers.filter(m => m.isSpecial);
  specialManagers.forEach(sm => {
    let specialOn = true;
    let counter = 0;
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const isVacation = sm.vacations.some(v => 
        (isAfter(day, parseISO(v.start)) || isSameDay(day, parseISO(v.start))) &&
        (isBefore(day, parseISO(v.end)) || isSameDay(day, parseISO(v.end)))
      );
      const isSick = sm.sickLeaves?.some(s => 
        (isAfter(day, parseISO(s.start)) || isSameDay(day, parseISO(s.start))) &&
        (isBefore(day, parseISO(s.end)) || isSameDay(day, parseISO(s.end)))
      );

      if (isSick) {
        assignments.push({ managerId: sm.id, date: dateStr, type: 'sick' });
        managerStats[sm.id].consecutiveWorkDays = 0;
        managerStats[sm.id].offCount++;
      } else if (isVacation) {
        assignments.push({ managerId: sm.id, date: dateStr, type: 'vacation' });
        managerStats[sm.id].consecutiveWorkDays = 0;
        managerStats[sm.id].offCount++;
      } else if (specialOn) {
        assignments.push({ managerId: sm.id, date: dateStr, type: 'special' });
        managerStats[sm.id].morningCount++;
        managerStats[sm.id].eveningCount++;
        managerStats[sm.id].consecutiveWorkDays++;
      } else {
        assignments.push({ managerId: sm.id, date: dateStr, type: 'off' });
        managerStats[sm.id].consecutiveWorkDays = 0;
        managerStats[sm.id].offCount++;
      }

      counter++;
      if (counter === 2) {
        specialOn = !specialOn;
        counter = 0;
      }
    });
  });

  // 2. Handle Regular Managers
  const regularManagers = managers.filter(m => !m.isSpecial);
  
  // Initialize assignments for regular managers with vacations and sick leaves
  days.forEach(day => {
    const dateStr = format(day, 'yyyy-MM-dd');

    regularManagers.forEach(m => {
      const isVacation = m.vacations.some(v => 
        (isAfter(day, parseISO(v.start)) || isSameDay(day, parseISO(v.start))) &&
        (isBefore(day, parseISO(v.end)) || isSameDay(day, parseISO(v.end)))
      );
      const isSick = m.sickLeaves?.some(s => 
        (isAfter(day, parseISO(s.start)) || isSameDay(day, parseISO(s.start))) &&
        (isBefore(day, parseISO(s.end)) || isSameDay(day, parseISO(s.end)))
      );

      if (isSick) {
        assignments.push({ managerId: m.id, date: dateStr, type: 'sick' });
        managerStats[m.id].offCount++;
      } else if (isVacation) {
        assignments.push({ managerId: m.id, date: dateStr, type: 'vacation' });
        managerStats[m.id].offCount++;
      }
    });
  });

    // 3. Fill the rest greedily
    days.forEach((day, dayIdx) => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayOfWeek = getDay(day);
      const daysRemaining = days.length - dayIdx - 1;
      const req = requirements.find(r => r.dayOfWeek === dayOfWeek) || { minMorning: 1, minEvening: 1 };

      const assignedToday = assignments.filter(a => a.date === dateStr);
      const availableManagers = regularManagers.filter(m => !assignedToday.some(a => a.managerId === m.id));

      // Calculate how many regular managers we need to pick for today
      // Each special manager working counts as 1 morning and 1 evening
      const specialWorkingToday = assignedToday.filter(a => a.type === 'special').length;
      let morningNeeded = Math.max(0, req.minMorning - specialWorkingToday);
      let eveningNeeded = Math.max(0, req.minEvening - specialWorkingToday);
      
      const totalRegularNeeded = morningNeeded + eveningNeeded;
      
      // Sort to decide who works today at all
      // We shuffle first to ensure ties are broken randomly each day
      const shuffled = [...availableManagers].sort(() => Math.random() - 0.5);
      
      shuffled.sort((a, b) => {
        // 1. Hard Constraints: Max 6 days in a row
        const aStreak = managerStats[a.id].consecutiveWorkDays;
        const bStreak = managerStats[b.id].consecutiveWorkDays;
        if (aStreak >= 6 && bStreak < 6) return 1;
        if (bStreak >= 6 && aStreak < 6) return -1;

        // 2. Mandatory Paired Days Off
        // If a manager doesn't allow single days off and just started a break yesterday,
        // they MUST stay off today to complete the pair.
        const getStatus = (mId: string, daysAgo: number) => {
          const targetDate = format(addDays(day, -daysAgo), 'yyyy-MM-dd');
          const assignment = assignments.find(as => as.managerId === mId && as.date === targetDate);
          // Vacation and Sick also count as "off" for pairing purposes
          return assignment ? (assignment.type === 'off' || assignment.type === 'vacation' || assignment.type === 'sick') : false;
        };
        const aOff1 = getStatus(a.id, 1);
        const bOff1 = getStatus(b.id, 1);
        const aOff2 = getStatus(a.id, 2);
        const bOff2 = getStatus(b.id, 2);

        const aMustStayOff = !a.allowSingleDaysOff && aOff1 && !aOff2;
        const bMustStayOff = !b.allowSingleDaysOff && bOff1 && !bOff2;
        if (aMustStayOff !== bMustStayOff) return aMustStayOff ? 1 : -1;

        // 3. Fairness: Total shifts balance (Primary driver)
        const aTotal = managerStats[a.id].morningCount + managerStats[a.id].eveningCount;
        const bTotal = managerStats[b.id].morningCount + managerStats[b.id].eveningCount;
        if (aTotal !== bTotal) return aTotal - bTotal;

        // 4. Weekend Balance
        if (managerStats[a.id].weekendOffCount !== managerStats[b.id].weekendOffCount) {
          return managerStats[b.id].weekendOffCount - managerStats[a.id].weekendOffCount;
        }

        // 5. User Preferences: Priority Loading
        if (a.priorityLoading !== b.priorityLoading) return a.priorityLoading ? -1 : 1;

        // 6. User Preferences: Preferred Day Off
        const aPrefOff = a.preferredDaysOff.includes(dateStr);
        const bPrefOff = b.preferredDaysOff.includes(dateStr);
        if (aPrefOff !== bPrefOff) return aPrefOff ? 1 : -1;

        // 7. Minimum 8 days off per month (Soft constraint)
        const aNeedsOff = (daysRemaining + managerStats[a.id].offCount) <= 8;
        const bNeedsOff = (daysRemaining + managerStats[b.id].offCount) <= 8;
        if (aNeedsOff !== bNeedsOff) return aNeedsOff ? 1 : -1;

        // 8. Soft Limit: Try to give off after 5 days
        if (aStreak >= 5 && bStreak < 5) return 1;
        if (bStreak >= 5 && aStreak < 5) return -1;

        return 0;
      });

      const workingToday = shuffled.slice(0, totalRegularNeeded);
      const offToday = shuffled.slice(totalRegularNeeded);

      // Now distribute workingToday between morning and evening shifts
      workingToday.sort((a, b) => {
        if (managerStats[a.id].eveningCount !== managerStats[b.id].eveningCount) {
          return managerStats[a.id].eveningCount - managerStats[b.id].eveningCount;
        }
        return managerStats[b.id].morningCount - managerStats[a.id].morningCount;
      });

      const eveningManagers = workingToday.slice(0, eveningNeeded);
      const morningManagers = workingToday.slice(eveningNeeded);

      eveningManagers.forEach(m => {
        const isPreferenceIgnored = m.preferredDaysOff.includes(dateStr);
        assignments.push({ managerId: m.id, date: dateStr, type: 'evening', isPreferenceIgnored });
        managerStats[m.id].eveningCount++;
        managerStats[m.id].consecutiveWorkDays++;
      });

      morningManagers.forEach(m => {
        const isPreferenceIgnored = m.preferredDaysOff.includes(dateStr);
        assignments.push({ managerId: m.id, date: dateStr, type: 'morning', isPreferenceIgnored });
        managerStats[m.id].morningCount++;
        managerStats[m.id].consecutiveWorkDays++;
      });

      // Remaining available managers get 'off'
      offToday.forEach(m => {
        assignments.push({ managerId: m.id, date: dateStr, type: 'off' });
        if (dayOfWeek === 0 || dayOfWeek === 6) managerStats[m.id].weekendOffCount++;
        managerStats[m.id].consecutiveWorkDays = 0;
        managerStats[m.id].offCount++;
      });
    });

  return { assignments, month, year };
}
