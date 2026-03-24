/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { addDays, addMonths, eachDayOfInterval, endOfMonth, format, getDay, isSameMonth, parseISO, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { AlertTriangle, Calendar as CalendarIcon, ChevronLeft, ChevronRight, Database, Download, LogIn, LogOut, Plus, Printer, Settings, Trash2, Upload, User, UserPlus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useEffect, useState, useCallback, useRef } from 'react';
import { toPng } from 'html-to-image';
import { DayRequirement, Manager, Schedule, ShiftAssignment, ShiftType } from './types';
import { generateSchedule } from './utils/scheduler';
import { auth, db, googleProvider, signInWithPopup, onAuthStateChanged, doc, onSnapshot, setDoc, getDocFromServer, User as FirebaseUser } from './firebase';

const DAYS_OF_WEEK = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export default function App() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const monthKey = format(currentDate, 'yyyy-MM');
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  const [managers, setManagers] = useState<Manager[]>([]);
  const [monthRequirements, setMonthRequirements] = useState<Record<string, DayRequirement[]>>({});
  const [isSaved, setIsSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const defaultRequirements: DayRequirement[] = [
    { dayOfWeek: 1, minMorning: 4, minEvening: 2 }, // Mon
    { dayOfWeek: 2, minMorning: 4, minEvening: 2 }, // Tue
    { dayOfWeek: 3, minMorning: 4, minEvening: 2 }, // Wed
    { dayOfWeek: 4, minMorning: 4, minEvening: 2 }, // Thu
    { dayOfWeek: 5, minMorning: 4, minEvening: 2 }, // Fri
    { dayOfWeek: 6, minMorning: 2, minEvening: 1 }, // Sat
    { dayOfWeek: 0, minMorning: 2, minEvening: 1 }, // Sun
  ];

  const currentRequirements = monthRequirements[monthKey] || defaultRequirements;

  // Auth listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Sync with Firestore
  useEffect(() => {
    if (!isAuthReady || !user) {
      setIsLoading(false);
      return;
    }

    const path = 'settings/global';
    const unsubscribe = onSnapshot(doc(db, path), (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        if (data.managers) setManagers(data.managers);
        if (data.monthRequirements) setMonthRequirements(data.monthRequirements);
      } else {
        // Initialize with default data if nothing exists
        const initialManagers = [
          { id: '1', name: 'Гуля', isSpecial: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
          { id: '2', name: 'Татьяна', isSpecial: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
          { id: '3', name: 'Елена 3', isSpecial: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
          { id: '4', name: 'Елена', isSpecial: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
          { id: '5', name: 'Татьяна Р.', isSpecial: true, vacations: [], sickLeaves: [], preferredDaysOff: [] },
          { id: '6', name: 'Валерия', isSpecial: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
          { id: '7', name: 'Анастасия', isSpecial: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
          { id: '8', name: 'Юрий', isSpecial: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
        ];
        setManagers(initialManagers);
        setMonthRequirements({});
        
        // Save initial data to Firestore
        setDoc(doc(db, path), {
          managers: initialManagers,
          monthRequirements: {}
        }).catch(err => handleFirestoreError(err, OperationType.WRITE, path));
      }
      setIsLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });

    return () => unsubscribe();
  }, [isAuthReady, user]);

  // Save to Firestore helper
  const saveToFirestore = useCallback(async (newManagers: Manager[], newRequirements: Record<string, DayRequirement[]>) => {
    if (!user) return;
    const path = 'settings/global';
    try {
      await setDoc(doc(db, path), {
        managers: newManagers,
        monthRequirements: newRequirements
      });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2000);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }, [user]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
    } catch (error) {
      console.error('Logout failed', error);
    }
  };

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [activeTab, setActiveTab] = useState<'calendar' | 'table' | 'stats' | 'settings'>('calendar');
  const [selectedManagerId, setSelectedManagerId] = useState<string | 'all'>('all');

  useEffect(() => {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const newSchedule = generateSchedule(year, month, managers, currentRequirements);
    setSchedule(newSchedule);
  }, [currentDate, managers, monthRequirements]);

  const getManagerStats = (managerId: string) => {
    if (!schedule) return null;
    const managerAssignments = schedule.assignments.filter(a => a.managerId === managerId);
    
    return {
      morning: managerAssignments.filter(a => a.type === 'morning' || a.type === 'special').length,
      evening: managerAssignments.filter(a => a.type === 'evening' || a.type === 'special').length,
      special: managerAssignments.filter(a => a.type === 'special').length,
      vacation: managerAssignments.filter(a => a.type === 'vacation').length,
      sick: managerAssignments.filter(a => a.type === 'sick').length,
      off: managerAssignments.filter(a => a.type === 'off').length,
      totalHours: managerAssignments.reduce((acc, a) => {
        if (a.type === 'morning' || a.type === 'evening') return acc + 9;
        if (a.type === 'special') return acc + 12;
        return acc;
      }, 0),
      weekendOff: managerAssignments.filter(a => {
        if (a.type !== 'off') return false;
        const day = getDay(parseISO(a.date));
        return day === 0 || day === 6;
      }).length,
      pairedOff: managerAssignments.reduce((acc, a, i, arr) => {
        if (i === 0) return 0;
        const isOff = (type: string) => type === 'off' || type === 'vacation';
        if (isOff(a.type) && isOff(arr[i-1].type)) return acc + 1;
        return acc;
      }, 0),
    };
  };

  const addManager = () => {
    const newManager: Manager = {
      id: Math.random().toString(36).substr(2, 9),
      name: `Менеджер ${managers.length + 1}`,
      isSpecial: false,
      allowSingleDaysOff: false,
      priorityLoading: false,
      vacations: [],
      sickLeaves: [],
      preferredDaysOff: [],
    };
    const newManagers = [...managers, newManager];
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const removeManager = (id: string) => {
    const newManagers = managers.filter(m => m.id !== id);
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const updateManager = (id: string, updates: Partial<Manager>) => {
    const newManagers = managers.map(m => (m.id === id ? { ...m, ...updates } : m));
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const togglePreferredDayOff = (managerId: string, dateStr: string) => {
    const newManagers = managers.map(m => {
      if (m.id === managerId) {
        const preferredDaysOff = m.preferredDaysOff.includes(dateStr)
          ? m.preferredDaysOff.filter(d => d !== dateStr)
          : [...m.preferredDaysOff, dateStr];
        return { ...m, preferredDaysOff };
      }
      return m;
    });
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const addVacation = (managerId: string) => {
    const month = currentDate.getMonth() + 1;
    const isRestrictedMonth = month >= 4 && month <= 10;
    const today = format(new Date(), 'yyyy-MM-dd');

    if (isRestrictedMonth) {
      const hasOverlap = managers.some(otherM => 
        otherM.id !== managerId && 
        otherM.vacations.some(v => {
          const vStart = parseISO(v.start);
          const vEnd = parseISO(v.end);
          const uDate = parseISO(today);
          return (uDate <= vEnd && uDate >= vStart);
        })
      );

      if (hasOverlap) {
        alert('В период с апреля по октябрь пересечение отпусков у двух и более менеджеров запрещено!');
        return;
      }
    }

    const newManagers = managers.map(m => {
      if (m.id === managerId) {
        return {
          ...m,
          vacations: [...m.vacations, { start: today, end: today }]
        };
      }
      return m;
    });
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const removeVacation = (managerId: string, index: number) => {
    const newManagers = managers.map(m => {
      if (m.id === managerId) {
        const vacations = [...m.vacations];
        vacations.splice(index, 1);
        return { ...m, vacations };
      }
      return m;
    });
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const updateVacation = (managerId: string, index: number, updates: { start?: string; end?: string }) => {
    const month = currentDate.getMonth() + 1; // 1-indexed
    const isRestrictedMonth = month >= 4 && month <= 10;

    const newManagers = managers.map(m => {
      if (m.id === managerId) {
        const vacations = m.vacations ? [...m.vacations] : [];
        const updatedVacation = { ...vacations[index], ...updates };
        
        if (isRestrictedMonth) {
          // Check for overlaps with other managers in restricted months
          const hasOverlap = managers.some(otherM => 
            otherM.id !== managerId && 
            otherM.vacations?.some(v => {
              const vStart = parseISO(v.start);
              const vEnd = parseISO(v.end);
              const uStart = parseISO(updatedVacation.start);
              const uEnd = parseISO(updatedVacation.end);
              
              const isVInRestricted = (vStart.getMonth() + 1 >= 4 && vStart.getMonth() + 1 <= 10) || (vEnd.getMonth() + 1 >= 4 && vEnd.getMonth() + 1 <= 10);
              const isUInRestricted = (uStart.getMonth() + 1 >= 4 && uStart.getMonth() + 1 <= 10) || (uEnd.getMonth() + 1 >= 4 && uEnd.getMonth() + 1 <= 10);

              if (!isVInRestricted || !isUInRestricted) return false;

              return (uStart <= vEnd && uEnd >= vStart);
            })
          );

          if (hasOverlap) {
            alert('В период с апреля по октябрь пересечение отпусков у двух и более менеджеров запрещено!');
            return m;
          }
        }

        vacations[index] = updatedVacation;
        return { ...m, vacations };
      }
      return m;
    });
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const addSickLeave = (managerId: string) => {
    const newManagers = managers.map(m => {
      if (m.id === managerId) {
        return {
          ...m,
          sickLeaves: [...(m.sickLeaves || []), { start: format(new Date(), 'yyyy-MM-dd'), end: format(new Date(), 'yyyy-MM-dd') }]
        };
      }
      return m;
    });
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const removeSickLeave = (managerId: string, index: number) => {
    const newManagers = managers.map(m => {
      if (m.id === managerId) {
        const sickLeaves = [...(m.sickLeaves || [])];
        sickLeaves.splice(index, 1);
        return { ...m, sickLeaves };
      }
      return m;
    });
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const updateSickLeave = (managerId: string, index: number, updates: { start?: string; end?: string }) => {
    const newManagers = managers.map(m => {
      if (m.id === managerId) {
        const sickLeaves = [...(m.sickLeaves || [])];
        sickLeaves[index] = { ...sickLeaves[index], ...updates };
        return { ...m, sickLeaves };
      }
      return m;
    });
    setManagers(newManagers);
    saveToFirestore(newManagers, monthRequirements);
  };

  const updateRequirement = (dayOfWeek: number, updates: Partial<DayRequirement>) => {
    const current = monthRequirements[monthKey] || defaultRequirements;
    const updated = current.map(req => 
      req.dayOfWeek === dayOfWeek ? { ...req, ...updates } : req
    );
    const newRequirements = { ...monthRequirements, [monthKey]: updated };
    setMonthRequirements(newRequirements);
    saveToFirestore(managers, newRequirements);
  };

  const nextMonth = () => setCurrentDate(addMonths(currentDate, 1));
  const prevMonth = () => setCurrentDate(subMonths(currentDate, 1));

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadImage = async () => {
    if (exportRef.current === null) return;
    
    try {
      const dataUrl = await toPng(exportRef.current, { 
        cacheBust: true, 
        backgroundColor: '#F3F4F6',
        filter: (node: Node) => {
          const element = node as HTMLElement;
          return !element.classList?.contains('no-print');
        }
      });
      const link = document.createElement('a');
      link.download = `schedule-${monthKey}.png`;
      link.href = dataUrl;
      link.click();
    } catch (err) {
      console.error('Download failed', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#F3F4F6] text-[#1F2937] font-sans">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-lg">
              <CalendarIcon className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-gray-900">ShiftMaster</h1>
          </div>
          
          <div className="flex items-center space-x-4">
            <AnimatePresence>
              {isSaved && (
                <motion.div
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 10 }}
                  className="hidden sm:flex items-center space-x-1.5 text-green-600 bg-green-50 px-3 py-1.5 rounded-full border border-green-100"
                >
                  <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Сохранено</span>
                </motion.div>
              )}
            </AnimatePresence>
            
            {user && (
              <div className="flex items-center space-x-3 pr-2 border-r border-gray-100">
                <div className="flex flex-col items-end hidden sm:flex">
                  <span className="text-xs font-bold text-gray-900">{user.displayName}</span>
                  <span className="text-[10px] text-gray-500">{user.email}</span>
                </div>
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="w-8 h-8 rounded-full border border-gray-200" referrerPolicy="no-referrer" />
                ) : (
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                    <User className="w-4 h-4 text-gray-400" />
                  </div>
                )}
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                  title="Выйти"
                >
                  <LogOut className="w-5 h-5" />
                </button>
              </div>
            )}

            <nav className="flex space-x-1 bg-gray-100 p-1 rounded-xl">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === 'calendar' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Календарь
            </button>
            <button
              onClick={() => setActiveTab('table')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === 'table' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Таблица
            </button>
            <button
              onClick={() => setActiveTab('stats')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === 'stats' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Статистика
            </button>
            <button
              onClick={() => setActiveTab('settings')}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-all ${
                activeTab === 'settings' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              Настройки
            </button>
          </nav>
        </div>
      </div>
    </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {!user && isAuthReady ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-6 text-center">
            <div className="bg-white p-8 rounded-3xl shadow-sm border border-gray-100 max-w-md">
              <div className="bg-indigo-100 w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6">
                <CalendarIcon className="w-8 h-8 text-indigo-600" />
              </div>
              <h2 className="text-2xl font-bold text-gray-900 mb-2">Добро пожаловать в ShiftMaster</h2>
              <p className="text-gray-500 mb-8">Войдите, чтобы просматривать и редактировать графики смен в реальном времени.</p>
              <button
                onClick={handleLogin}
                className="w-full flex items-center justify-center space-x-3 bg-indigo-600 text-white px-6 py-4 rounded-2xl hover:bg-indigo-700 transition-all font-bold shadow-lg shadow-indigo-100"
              >
                <LogIn className="w-5 h-5" />
                <span>Войти через Google</span>
              </button>
            </div>
          </div>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {activeTab === 'calendar' ? (
          <div className="space-y-6" ref={exportRef}>
            <div className="flex flex-col md:flex-row md:items-center justify-between bg-white p-4 rounded-2xl shadow-sm border border-gray-100 gap-4 no-print">
              <div className="flex items-center space-x-4">
                <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <h2 className="text-2xl font-bold text-gray-800 capitalize">
                  {format(currentDate, 'LLLL yyyy')}
                </h2>
                <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
              
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center space-x-2 bg-gray-50 px-3 py-1.5 rounded-xl border border-gray-100">
                  <User className="w-4 h-4 text-gray-400" />
                  <select
                    value={selectedManagerId}
                    onChange={(e) => setSelectedManagerId(e.target.value)}
                    className="bg-transparent text-sm font-medium focus:outline-none text-gray-700"
                  >
                    <option value="all">Все менеджеры</option>
                    {managers.map(m => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    onClick={handlePrint}
                    className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                    title="Печать"
                  >
                    <Printer className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleDownloadImage}
                    className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                    title="Скачать картинкой"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </div>

                <div className="flex space-x-4 text-xs">
                  <div className="flex items-center space-x-1">
                    <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                    <span>Утро</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <div className="w-3 h-3 bg-indigo-500 rounded-full"></div>
                    <span>Вечер</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <div className="w-3 h-3 bg-amber-500 rounded-full"></div>
                    <span>Спец</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="hidden xl:grid grid-cols-7 gap-4 mb-2 px-2">
              {['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'].map(day => (
                <div key={day} className="text-center text-[10px] font-black uppercase text-gray-400 py-1">
                  {day}
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4">
              {(() => {
                const start = startOfMonth(currentDate);
                const end = endOfMonth(currentDate);
                const days = eachDayOfInterval({ start, end });
                
                // Calculate offset for Monday-start week
                // getDay: 0=Sun, 1=Mon, ..., 6=Sat
                // We want: Mon=0, Tue=1, ..., Sat=5, Sun=6
                const firstDayIdx = getDay(start);
                const offset = firstDayIdx === 0 ? 6 : firstDayIdx - 1;
                
                const placeholders = Array.from({ length: offset }).map((_, i) => (
                  <div key={`placeholder-${i}`} className="hidden xl:block bg-gray-50/30 rounded-2xl border border-dashed border-gray-100"></div>
                ));

                const dayCards = days.map(day => {
                  const dateStr = format(day, 'yyyy-MM-dd');
                  const dayAssignments = schedule?.assignments.filter(a => a.date === dateStr) || [];
                  const isWeekend = getDay(day) === 0 || getDay(day) === 6;

                  const filteredManagers = selectedManagerId === 'all' 
                    ? managers 
                    : managers.filter(m => m.id === selectedManagerId);

                  return (
                    <motion.div
                      key={dateStr}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`bg-white rounded-2xl shadow-sm border ${
                        isWeekend ? 'border-indigo-100 bg-indigo-50/10' : 'border-gray-100'
                      } overflow-hidden flex flex-col`}
                    >
                      <div className={`px-4 py-3 flex justify-between items-center border-b ${
                        isWeekend ? 'bg-indigo-50 border-indigo-100' : 'bg-gray-50 border-gray-100'
                      }`}>
                        <span className="font-bold text-lg">{format(day, 'dd.MM')}</span>
                        <span className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          isWeekend ? 'bg-indigo-200 text-indigo-700' : 'bg-gray-200 text-gray-600'
                        }`}>
                          {DAYS_OF_WEEK[getDay(day)]}
                        </span>
                      </div>
                      
                      <div className="p-3 space-y-3 flex-grow">
                        {(() => {
                          const filteredAssignments = selectedManagerId === 'all' 
                            ? dayAssignments 
                            : dayAssignments.filter(a => a.managerId === selectedManagerId);

                          const getManagersForType = (type: ShiftType) => 
                            filteredAssignments
                              .filter(a => a.type === type || (a.type === 'special' && (type === 'morning' || type === 'evening')))
                              .map(a => {
                                const m = managers.find(mgr => mgr.id === a.managerId);
                                if (!m) return null;
                                const name = a.type === 'special' ? `${m.name} (спец)` : m.name;
                                return (
                                  <span key={m.id} className="inline-flex items-center">
                                    {name}
                                    {a.isPreferenceIgnored && (
                                      <AlertTriangle className="w-3 h-3 text-red-500 ml-1" title="Желаемый выходной проигнорирован" />
                                    )}
                                  </span>
                                );
                              })
                              .filter(Boolean);

                          const morning = getManagersForType('morning');
                          const evening = getManagersForType('evening');
                          const vacation = filteredAssignments.filter(a => a.type === 'vacation').map(a => managers.find(m => m.id === a.managerId)?.name).filter(Boolean);
                          const sick = filteredAssignments.filter(a => a.type === 'sick').map(a => managers.find(m => m.id === a.managerId)?.name).filter(Boolean);

                          return (
                            <table className="w-full text-xs">
                              <tbody className="divide-y divide-gray-50">
                                {morning.length > 0 && (
                                  <tr>
                                    <td className="py-1.5 pr-2 font-bold text-green-600 w-1/4 align-top">Утро</td>
                                    <td className="py-1.5 text-gray-700 leading-relaxed flex flex-wrap gap-x-2">{morning}</td>
                                  </tr>
                                )}
                                {evening.length > 0 && (
                                  <tr>
                                    <td className="py-1.5 pr-2 font-bold text-indigo-600 w-1/4 align-top">Вечер</td>
                                    <td className="py-1.5 text-gray-700 leading-relaxed flex flex-wrap gap-x-2">{evening}</td>
                                  </tr>
                                )}
                                {vacation.length > 0 && (
                                  <tr>
                                    <td className="py-1.5 pr-2 font-bold text-red-500 w-1/4 align-top">Отпуск</td>
                                    <td className="py-1.5 text-gray-500 italic leading-relaxed">{vacation.join(', ')}</td>
                                  </tr>
                                )}
                                {sick.length > 0 && (
                                  <tr>
                                    <td className="py-1.5 pr-2 font-bold text-orange-500 w-1/4 align-top">Больн.</td>
                                    <td className="py-1.5 text-gray-500 italic leading-relaxed">{sick.join(', ')}</td>
                                  </tr>
                                )}
                                {morning.length === 0 && evening.length === 0 && vacation.length === 0 && sick.length === 0 && (
                                  <tr>
                                    <td colSpan={2} className="py-4 text-center text-gray-300 italic">Нет смен</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          );
                        })()}
                      </div>
                    </motion.div>
                  );
                });

                return [...placeholders, ...dayCards];
              })()}
            </div>
          </div>
        ) : activeTab === 'table' ? (
          <div className="space-y-8" ref={exportRef}>
            {/* Table Header */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4 no-print">
              <div className="flex items-center space-x-6">
                <button onClick={prevMonth} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <h2 className="text-2xl font-black text-gray-900 min-w-[180px] text-center capitalize">
                  {format(currentDate, 'LLLL yyyy')}
                </h2>
                <button onClick={nextMonth} className="p-2 hover:bg-gray-100 rounded-full transition-colors">
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>

              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <button
                    onClick={handlePrint}
                    className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                    title="Печать"
                  >
                    <Printer className="w-5 h-5" />
                  </button>
                  <button
                    onClick={handleDownloadImage}
                    className="p-2 text-gray-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all"
                    title="Скачать картинкой"
                  >
                    <Download className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="flex space-x-4 text-xs font-bold">
                  <div className="flex items-center space-x-1.5">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    <span>Утро</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
                    <span>Вечер</span>
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                    <span>Спец</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Weeks Container */}
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  {(() => {
                    const start = startOfMonth(currentDate);
                    const end = endOfMonth(currentDate);
                    let current = startOfWeek(start, { weekStartsOn: 1 });
                    const weeks = [];
                    
                    while (current <= end) {
                      const week = [];
                      for (let i = 0; i < 7; i++) {
                        week.push(new Date(current));
                        current = addDays(current, 1);
                      }
                      weeks.push(week);
                    }

                    return weeks.map((week, weekIdx) => (
                      <tbody key={weekIdx} className={weekIdx > 0 ? 'border-t-4 border-gray-100' : ''}>
                        <tr className="bg-gray-50/80">
                          <th className="p-3 text-left text-[10px] font-black uppercase text-indigo-600 border-r border-gray-100">
                            Неделя {weekIdx + 1}
                          </th>
                          {week.map(day => {
                            const isWeekend = getDay(day) === 0 || getDay(day) === 6;
                            const isCurrentMonth = isSameMonth(day, currentDate);
                            return (
                              <th 
                                key={day.toString()} 
                                className={`p-2 text-center border-r border-gray-100 min-w-[100px] ${
                                  isWeekend ? 'bg-indigo-50/30' : ''
                                } ${!isCurrentMonth ? 'opacity-30' : ''}`}
                              >
                                <div className="text-[9px] font-black text-gray-400 uppercase tracking-tighter">{DAYS_OF_WEEK[getDay(day)]}</div>
                                <div className="text-xs font-black text-gray-700">{format(day, 'dd.MM')}</div>
                              </th>
                            );
                          })}
                        </tr>
                        {managers.map(manager => (
                          <tr key={manager.id} className="border-b border-gray-50 hover:bg-gray-50/30 transition-colors">
                            <td className="p-3 font-bold text-[11px] text-gray-600 border-r border-gray-100 bg-gray-50/5">
                              {manager.name}
                            </td>
                            {week.map(day => {
                              const dateStr = format(day, 'yyyy-MM-dd');
                              const assignment = schedule?.assignments.find(a => a.date === dateStr && a.managerId === manager.id);
                              const type = assignment?.type || 'off';
                              const isCurrentMonth = isSameMonth(day, currentDate);
                              
                              const isPreferenceIgnored = assignment?.isPreferenceIgnored;
                              
                              let label = '—';
                              let cellClass = 'text-gray-300';
                              let dotColor = '';

                              if (type === 'morning') {
                                label = 'Утро';
                                cellClass = 'text-green-700 font-bold';
                                dotColor = 'bg-green-500';
                              } else if (type === 'evening') {
                                label = 'Вечер';
                                cellClass = 'text-indigo-700 font-bold';
                                dotColor = 'bg-indigo-500';
                              } else if (type === 'special') {
                                label = 'Спец';
                                cellClass = 'text-amber-700 font-bold';
                                dotColor = 'bg-amber-500';
                              } else if (type === 'vacation') {
                                label = 'Отпуск';
                                cellClass = 'text-red-600 font-bold';
                                dotColor = 'bg-red-500';
                              } else if (type === 'sick') {
                                label = 'Больн.';
                                cellClass = 'text-orange-600 font-bold';
                                dotColor = 'bg-orange-500';
                              }

                              return (
                                <td 
                                  key={dateStr} 
                                  className={`p-2 border-r border-gray-50 text-center ${!isCurrentMonth ? 'opacity-10' : ''}`}
                                >
                                  <div className={`flex items-center justify-center space-x-1.5 text-[9px] uppercase tracking-tighter ${cellClass}`}>
                                    {dotColor && <div className={`w-1 h-1 rounded-full ${dotColor}`}></div>}
                                    <span>{label}</span>
                                    {isPreferenceIgnored && (
                                      <AlertTriangle className="w-2.5 h-2.5 text-red-500" />
                                    )}
                                  </div>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    ));
                  })()}
                </table>
              </div>
            </div>
          </div>
        ) : activeTab === 'stats' ? (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl shadow-sm border border-gray-100">
              <h3 className="text-xl font-bold mb-6 flex items-center space-x-2">
                <Settings className="w-6 h-6 text-indigo-600" />
                <span>Статистика за {format(currentDate, 'LLLL yyyy')}</span>
              </h3>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-xs font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100">
                      <th className="pb-4 pl-4">Менеджер</th>
                      <th className="pb-4">Утро (9-18)</th>
                      <th className="pb-4">Вечер (12-21)</th>
                      <th className="pb-4">Спец (9-21)</th>
                      <th className="pb-4">Отпуск</th>
                      <th className="pb-4">Больнич.</th>
                      <th className="pb-4">Часы</th>
                      <th className="pb-4">Выходные</th>
                      <th className="pb-4">Парные вых.</th>
                      <th className="pb-4 pr-4">Вых. в Сб/Вс</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {managers.map(manager => {
                      const stats = getManagerStats(manager.id);
                      if (!stats) return null;
                      return (
                        <tr key={manager.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="py-4 pl-4">
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 bg-indigo-100 rounded-full flex items-center justify-center">
                                <User className="w-4 h-4 text-indigo-600" />
                              </div>
                              <span className="font-bold text-gray-700">{manager.name}</span>
                            </div>
                          </td>
                          <td className="py-4">
                            <span className="px-2 py-1 bg-green-100 text-green-700 rounded-lg text-sm font-bold">{stats.morning}</span>
                          </td>
                          <td className="py-4">
                            <span className="px-2 py-1 bg-indigo-100 text-indigo-700 rounded-lg text-sm font-bold">{stats.evening}</span>
                          </td>
                          <td className="py-4">
                            <span className="px-2 py-1 bg-amber-100 text-amber-700 rounded-lg text-sm font-bold">{stats.special}</span>
                          </td>
                          <td className="py-4 text-gray-500 font-medium">{stats.vacation}</td>
                          <td className="py-4 text-gray-500 font-medium">{stats.sick}</td>
                          <td className="py-4">
                            <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded-lg text-sm font-bold">{stats.totalHours}ч</span>
                          </td>
                          <td className="py-4 text-gray-500 font-medium">{stats.off}</td>
                          <td className="py-4">
                            <span className="px-2 py-1 bg-purple-100 text-purple-700 rounded-lg text-sm font-bold">{stats.pairedOff}</span>
                          </td>
                          <td className="py-4 pr-4">
                            <span className="px-2 py-1 bg-gray-100 text-gray-600 rounded-lg text-sm font-bold">{stats.weekendOff}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Settings Month Header */}
            <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center space-x-3">
                <Settings className="w-6 h-6 text-indigo-600" />
                <h3 className="text-lg font-bold">Настройки на месяц</h3>
              </div>
              
              <div className="flex items-center space-x-6 bg-gray-50 px-4 py-2 rounded-2xl border border-gray-100">
                <button onClick={prevMonth} className="p-1.5 hover:bg-white hover:shadow-sm rounded-xl transition-all">
                  <ChevronLeft className="w-5 h-5 text-gray-600" />
                </button>
                <div className="text-sm font-black text-gray-900 min-w-[140px] text-center capitalize">
                  {format(currentDate, 'LLLL yyyy')}
                </div>
                <button onClick={nextMonth} className="p-1.5 hover:bg-white hover:shadow-sm rounded-xl transition-all">
                  <ChevronRight className="w-5 h-5 text-gray-600" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Managers Settings */}
              <div className="lg:col-span-2 space-y-6">
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <div className="flex items-center space-x-3">
                      <User className="w-6 h-6 text-indigo-600" />
                      <h3 className="text-lg font-bold">Менеджеры</h3>
                    </div>
                    <button
                      onClick={addManager}
                      className="flex items-center space-x-2 bg-indigo-600 text-white px-4 py-2 rounded-xl hover:bg-indigo-700 transition-colors text-sm font-medium"
                    >
                      <UserPlus className="w-4 h-4" />
                      <span>Добавить</span>
                    </button>
                  </div>
                
                <div className="divide-y divide-gray-100">
                  {managers.map(manager => (
                    <div key={manager.id} className="p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4 flex-grow">
                          <input
                            type="text"
                            value={manager.name}
                            onChange={(e) => updateManager(manager.id, { name: e.target.value })}
                            className="text-lg font-semibold bg-transparent border-b border-transparent hover:border-gray-200 focus:border-indigo-500 focus:outline-none transition-all px-1 py-0.5"
                          />
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={manager.isSpecial}
                              onChange={(e) => updateManager(manager.id, { isSpecial: e.target.checked })}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm text-gray-600">Спецменеджер (2/2)</span>
                          </label>
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={manager.allowSingleDaysOff}
                              onChange={(e) => updateManager(manager.id, { allowSingleDaysOff: e.target.checked })}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm text-gray-600">Одиночные выходные</span>
                          </label>
                          <label className="flex items-center space-x-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={manager.priorityLoading}
                              onChange={(e) => updateManager(manager.id, { priorityLoading: e.target.checked })}
                              className="rounded text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="text-sm text-gray-600">Приоритет загрузки</span>
                          </label>
                        </div>
                        <button
                          onClick={() => removeManager(manager.id)}
                          className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                          {/* Vacations */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center space-x-2">
                                <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Отпуска</h4>
                                <div className="group relative">
                                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 cursor-help" />
                                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 bg-gray-800 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                                    С апреля по октябрь пересечение отпусков запрещено
                                  </div>
                                </div>
                              </div>
                              <button
                                onClick={() => addVacation(manager.id)}
                                className="text-indigo-600 hover:text-indigo-700 text-xs font-bold flex items-center space-x-1"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Добавить</span>
                              </button>
                            </div>
                            <div className="space-y-2">
                              {manager.vacations?.map((v, idx) => {
                                const vStart = parseISO(v.start);
                                const vEnd = parseISO(v.end);
                                const isRestricted = (vStart.getMonth() + 1 >= 4 && vStart.getMonth() + 1 <= 10) || (vEnd.getMonth() + 1 >= 4 && vEnd.getMonth() + 1 <= 10);
                                
                                const hasOverlap = isRestricted && managers.some(otherM => 
                                  otherM.id !== manager.id && 
                                  otherM.vacations?.some(ov => {
                                    const ovStart = parseISO(ov.start);
                                    const ovEnd = parseISO(ov.end);
                                    return (vStart <= ovEnd && vEnd >= ovStart);
                                  })
                                );

                                return (
                                  <div key={idx} className={`flex flex-wrap items-center gap-2 p-2 rounded-xl border transition-colors ${
                                    hasOverlap ? 'bg-red-50 border-red-200' : 'bg-gray-50 border-gray-100'
                                  }`}>
                                    <div className="flex items-center space-x-2 flex-grow min-w-0">
                                      <input
                                        type="date"
                                        value={v.start}
                                        onChange={(e) => updateVacation(manager.id, idx, { start: e.target.value })}
                                        className="text-[10px] w-full bg-white border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
                                      />
                                      <span className="text-gray-400">—</span>
                                      <input
                                        type="date"
                                        value={v.end}
                                        onChange={(e) => updateVacation(manager.id, idx, { end: e.target.value })}
                                        className="text-[10px] w-full bg-white border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
                                      />
                                    </div>
                                    <div className="flex items-center space-x-1 ml-auto">
                                      <button
                                        onClick={() => removeVacation(manager.id, idx)}
                                        className="p-1 text-gray-400 hover:text-red-500 transition-colors"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                      </button>
                                      {hasOverlap && (
                                        <AlertTriangle className="w-4 h-4 text-red-500" />
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Sick Leaves */}
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Больничные</h4>
                              <button
                                onClick={() => addSickLeave(manager.id)}
                                className="text-orange-600 hover:text-orange-700 text-xs font-bold flex items-center space-x-1"
                              >
                                <Plus className="w-3 h-3" />
                                <span>Добавить</span>
                              </button>
                            </div>
                            <div className="space-y-2">
                              {manager.sickLeaves?.map((s, idx) => (
                                <div key={idx} className="flex flex-wrap items-center gap-2 bg-orange-50/50 p-2 rounded-xl border border-orange-100">
                                  <div className="flex items-center space-x-2 flex-grow min-w-0">
                                    <input
                                      type="date"
                                      value={s.start}
                                      onChange={(e) => updateSickLeave(manager.id, idx, { start: e.target.value })}
                                      className="text-[10px] w-full bg-white border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
                                    />
                                    <span className="text-gray-400">—</span>
                                    <input
                                      type="date"
                                      value={s.end}
                                      onChange={(e) => updateSickLeave(manager.id, idx, { end: e.target.value })}
                                      className="text-[10px] w-full bg-white border border-gray-200 rounded px-1.5 py-1 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0"
                                    />
                                  </div>
                                  <button
                                    onClick={() => removeSickLeave(manager.id, idx)}
                                    className="p-1 text-gray-400 hover:text-red-500 transition-colors ml-auto"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          </div>

                        {/* Preferred Days Off */}
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <h4 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Желаемые выходные</h4>
                            <div className="text-[10px] text-gray-400">
                              <span className="text-red-400 font-bold">!</span> — нет мест на выходной
                            </div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {eachDayOfInterval({
                              start: startOfMonth(currentDate),
                              end: endOfMonth(currentDate),
                            }).map(day => {
                              const dateStr = format(day, 'yyyy-MM-dd');
                              const isSelected = manager.preferredDaysOff.includes(dateStr);
                              const dayOfWeek = getDay(day);
                              const req = currentRequirements.find(r => r.dayOfWeek === dayOfWeek) || { minMorning: 0, minEvening: 0 };
                              
                              // Calculate total managers needed for this day
                              // Special manager logic: if working, they cover 1 morning and 1 evening
                              // For simplicity in UI, we check how many managers requested this day off
                              const totalRequestingOff = managers.filter(m => m.preferredDaysOff.includes(dateStr)).length;
                              const totalManagers = managers.length;
                              const minNeeded = req.minMorning + req.minEvening;
                              const maxOffPossible = Math.max(0, totalManagers - minNeeded);
                              const isOverbooked = totalRequestingOff > maxOffPossible;

                              return (
                                <button
                                  key={dateStr}
                                  onClick={() => togglePreferredDayOff(manager.id, dateStr)}
                                  className={`w-8 h-8 flex flex-col items-center justify-center text-[10px] font-bold rounded-lg border transition-all relative ${
                                    isSelected
                                      ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                      : 'bg-white border-gray-200 text-gray-500 hover:border-indigo-300'
                                  }`}
                                >
                                  <span>{format(day, 'd')}</span>
                                  {isOverbooked && !isSelected && (
                                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-red-400 rounded-full border border-white"></div>
                                  )}
                                  {isOverbooked && isSelected && (
                                    <span className="text-[8px] leading-none text-red-200">!</span>
                                  )}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Load Settings */}
            <div className="space-y-6">
              <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex items-center space-x-3">
                  <Settings className="w-6 h-6 text-indigo-600" />
                  <h3 className="text-lg font-bold">Загрузка по дням</h3>
                </div>
                <div className="p-6 space-y-4">
                  {currentRequirements.map(req => {
                    const isWeekend = req.dayOfWeek === 0 || req.dayOfWeek === 6;
                    const recMorning = isWeekend ? 2 : 4;
                    const recEvening = isWeekend ? 1 : 2;
                    
                    return (
                      <div key={req.dayOfWeek} className="flex items-center justify-between p-3 bg-gray-50 rounded-2xl border border-gray-100">
                        <span className="font-bold text-gray-700 w-12">{DAYS_OF_WEEK[req.dayOfWeek]}</span>
                        <div className="flex items-center space-x-4">
                          <div className="flex flex-col items-center">
                            <div className="flex items-center space-x-1 mb-1">
                              <span className="text-[10px] text-gray-400 uppercase font-bold">Утро</span>
                              <span className="text-[9px] text-indigo-400 font-medium">(рек. {recMorning})</span>
                            </div>
                            <input
                              type="number"
                              min="0"
                              value={req.minMorning}
                              onChange={(e) => updateRequirement(req.dayOfWeek, { minMorning: parseInt(e.target.value) || 0 })}
                              className="w-12 text-center bg-white border border-gray-200 rounded-lg py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                          <div className="flex flex-col items-center">
                            <div className="flex items-center space-x-1 mb-1">
                              <span className="text-[10px] text-gray-400 uppercase font-bold">Вечер</span>
                              <span className="text-[9px] text-indigo-400 font-medium">(рек. {recEvening})</span>
                            </div>
                            <input
                              type="number"
                              min="0"
                              value={req.minEvening}
                              onChange={(e) => updateRequirement(req.dayOfWeek, { minEvening: parseInt(e.target.value) || 0 })}
                              className="w-12 text-center bg-white border border-gray-200 rounded-lg py-1 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="bg-indigo-600 rounded-3xl p-6 text-white shadow-lg shadow-indigo-200">
                <h4 className="font-bold mb-2">Инструкция</h4>
                <ul className="text-sm space-y-2 opacity-90 list-disc list-inside">
                  <li>Настройте количество менеджеров и их имена.</li>
                  <li>Укажите даты отпусков для каждого.</li>
                  <li>Спецменеджер работает по графику 2 через 2 (9:00-21:00).</li>
                  <li>Задайте минимальное количество смен для каждого дня недели.</li>
                  <li>Система автоматически сбалансирует вечерние смены и выходные.</li>
                </ul>
              </div>

              <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100 space-y-4">
                <div className="flex items-center space-x-3">
                  <Database className="w-6 h-6 text-indigo-600" />
                  <h3 className="text-lg font-bold">Управление данными</h3>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => {
                      const data = {
                        managers,
                        monthRequirements
                      };
                      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `shiftmaster-backup-${format(new Date(), 'yyyy-MM-dd')}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    className="flex items-center space-x-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-xl hover:bg-gray-200 transition-colors text-sm font-medium"
                  >
                    <Download className="w-4 h-4" />
                    <span>Экспорт (JSON)</span>
                  </button>
                  <label className="flex items-center space-x-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-xl hover:bg-gray-200 transition-colors text-sm font-medium cursor-pointer">
                    <Upload className="w-4 h-4" />
                    <span>Импорт</span>
                    <input
                      type="file"
                      accept=".json"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        const reader = new FileReader();
                        reader.onload = (event) => {
                          try {
                            const data = JSON.parse(event.target?.result as string);
                            if (data.managers) setManagers(data.managers);
                            if (data.monthRequirements) setMonthRequirements(data.monthRequirements);
                            alert('Данные успешно импортированы!');
                          } catch (err) {
                            alert('Ошибка при импорте файла');
                          }
                        };
                        reader.readAsText(file);
                      }}
                    />
                  </label>
                  <button
                    onClick={async () => {
                      if (window.confirm('Вы уверены, что хотите сбросить все данные до начальных? Это действие нельзя отменить.')) {
                        const path = 'settings/global';
                        const initialManagers = [
                          { id: '1', name: 'Гуля', isSpecial: false, allowSingleDaysOff: false, priorityLoading: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
                          { id: '2', name: 'Татьяна', isSpecial: false, allowSingleDaysOff: false, priorityLoading: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
                          { id: '3', name: 'Елена 3', isSpecial: false, allowSingleDaysOff: false, priorityLoading: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
                          { id: '4', name: 'Елена', isSpecial: false, allowSingleDaysOff: false, priorityLoading: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
                          { id: '5', name: 'Татьяна Р.', isSpecial: true, allowSingleDaysOff: false, priorityLoading: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
                          { id: '6', name: 'Валерия', isSpecial: false, allowSingleDaysOff: false, priorityLoading: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
                          { id: '7', name: 'Анастасия', isSpecial: false, allowSingleDaysOff: false, priorityLoading: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
                          { id: '8', name: 'Юрий', isSpecial: false, allowSingleDaysOff: false, priorityLoading: false, vacations: [], sickLeaves: [], preferredDaysOff: [] },
                        ];
                        try {
                          await setDoc(doc(db, path), {
                            managers: initialManagers,
                            monthRequirements: {}
                          });
                          alert('Данные успешно сброшены');
                        } catch (err) {
                          handleFirestoreError(err, OperationType.WRITE, path);
                        }
                      }
                    }}
                    className="flex items-center space-x-2 bg-red-50 text-red-600 px-4 py-2 rounded-xl hover:bg-red-100 transition-colors text-sm font-medium"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Сбросить всё</span>
                  </button>
                </div>
              </div>
            </div>
            </div>
          </div>
        )}
      </>
    )
  }
</main>
</div>
);
}
