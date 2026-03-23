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
  const managerStats: Record<string, { morningCount: number; eveningCount: number; weekendOffCount: number }> = {};
  
  managers.forEach(m => {
    managerStats[m.id] = { morningCount: 0, eveningCount: 0, weekendOffCount: 0 };
  });

  // 1. Handle Special Manager (2 on / 2 off)
  const specialManager = managers.find(m => m.isSpecial);
  if (specialManager) {
    let specialOn = true;
    let counter = 0;
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const isVacation = specialManager.vacations.some(v => 
        (isAfter(day, parseISO(v.start)) || isSameDay(day, parseISO(v.start))) &&
        (isBefore(day, parseISO(v.end)) || isSameDay(day, parseISO(v.end)))
      );

      if (isVacation) {
        assignments.push({ managerId: specialManager.id, date: dateStr, type: 'vacation' });
      } else if (specialOn) {
        assignments.push({ managerId: specialManager.id, date: dateStr, type: 'special' });
        managerStats[specialManager.id].morningCount++;
        managerStats[specialManager.id].eveningCount++;
      } else {
        assignments.push({ managerId: specialManager.id, date: dateStr, type: 'off' });
      }

      counter++;
      if (counter === 2) {
        specialOn = !specialOn;
        counter = 0;
      }
    });
  }

  // 2. Handle Regular Managers
  const regularManagers = managers.filter(m => !m.isSpecial);
  
  // Initialize assignments for regular managers with vacations and preferences
  days.forEach(day => {
    const dateStr = format(day, 'yyyy-MM-dd');
    const dayOfWeek = getDay(day);

    regularManagers.forEach(m => {
      const isVacation = m.vacations.some(v => 
        (isAfter(day, parseISO(v.start)) || isSameDay(day, parseISO(v.start))) &&
        (isBefore(day, parseISO(v.end)) || isSameDay(day, parseISO(v.end)))
      );

      if (isVacation) {
        assignments.push({ managerId: m.id, date: dateStr, type: 'vacation' });
      }
    });
  });

    // 3. Fill the rest greedily
    days.forEach(day => {
      const dateStr = format(day, 'yyyy-MM-dd');
      const dayOfWeek = getDay(day);
      const req = requirements.find(r => r.dayOfWeek === dayOfWeek) || { minMorning: 1, minEvening: 1 };

      const assignedToday = assignments.filter(a => a.date === dateStr);
      const availableManagers = regularManagers.filter(m => !assignedToday.some(a => a.managerId === m.id));

      // Calculate how many regular managers we need to pick for today
      // Special manager counts as 1 morning and 1 evening if working
      const specialAssigned = assignedToday.find(a => a.managerId === specialManager?.id);
      let morningNeeded = req.minMorning;
      let eveningNeeded = req.minEvening;
      
      if (specialAssigned?.type === 'special') {
        morningNeeded = Math.max(0, morningNeeded - 1);
        eveningNeeded = Math.max(0, eveningNeeded - 1);
      }
      
      const totalRegularNeeded = morningNeeded + eveningNeeded;
      
      // Sort to decide who works today at all
      availableManagers.sort((a, b) => {
        const getStatus = (mId: string, daysAgo: number) => {
          const targetDate = format(addDays(day, -daysAgo), 'yyyy-MM-dd');
          const assignment = assignments.find(as => as.managerId === mId && as.date === targetDate);
          return assignment ? (assignment.type === 'off' || assignment.type === 'vacation') : false;
        };

        const aOff1 = getStatus(a.id, 1);
        const bOff1 = getStatus(b.id, 1);
        const aOff2 = getStatus(a.id, 2);
        const bOff2 = getStatus(b.id, 2);

        // Rule 1: Priority to NOT work - Preferred Day Off
        // This is the user's explicit request. We respect it if we have enough other managers.
        const aPrefOff = a.preferredDaysOff.includes(dateStr);
        const bPrefOff = b.preferredDaysOff.includes(dateStr);
        if (aPrefOff !== bPrefOff) return aPrefOff ? 1 : -1;

        // Rule 2: Priority to work - Had 2+ days off
        const aNeedsToWork = aOff1 && aOff2;
        const bNeedsToWork = bOff1 && bOff2;
        if (aNeedsToWork !== bNeedsToWork) return aNeedsToWork ? -1 : 1;

        // Rule 3: Priority to NOT work - Had exactly 1 day off (Try to give 2 in a row)
        const aShouldStayOff = aOff1 && !aOff2;
        const bShouldStayOff = bOff1 && !bOff2;
        if (aShouldStayOff !== bShouldStayOff) return aShouldStayOff ? 1 : -1;

        // Priority 4: Total shifts (to balance hours)
        const aTotal = managerStats[a.id].morningCount + managerStats[a.id].eveningCount;
        const bTotal = managerStats[b.id].morningCount + managerStats[b.id].eveningCount;
        if (aTotal !== bTotal) return aTotal - bTotal;
        
        // Priority 5: Weekend off balance
        return managerStats[a.id].weekendOffCount - managerStats[b.id].weekendOffCount;
      });

      const workingToday = availableManagers.slice(0, totalRegularNeeded);
      const offToday = availableManagers.slice(totalRegularNeeded);

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
      });

      morningManagers.forEach(m => {
        const isPreferenceIgnored = m.preferredDaysOff.includes(dateStr);
        assignments.push({ managerId: m.id, date: dateStr, type: 'morning', isPreferenceIgnored });
        managerStats[m.id].morningCount++;
      });

      // Remaining available managers get 'off'
      offToday.forEach(m => {
        assignments.push({ managerId: m.id, date: dateStr, type: 'off' });
        if (dayOfWeek === 0 || dayOfWeek === 6) managerStats[m.id].weekendOffCount++;
      });
    });

  return { assignments, month, year };
}
