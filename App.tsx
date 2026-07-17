
import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Users, Calendar, Settings, History, Plus, Trash2, Download,
  CheckCircle, AlertCircle, FileSpreadsheet, Upload, Edit2, X, ChevronLeft, ChevronRight, Info, Plane, CalendarRange, DollarSign, Clock, Lock, Unlock, Star
} from 'lucide-react';
import {
  Employee, ShiftConfig, ScheduleVersion, WorkerPreference,
  ShiftType, HistoricalContext, ManualHistoryInput, DailyTiming
} from './types';
import { generateSchedule, exportToCSV, exportToExcel, getDaysInMonth, formatDateKey, parseDateKey, parsePastScheduleCSV, getFullWeeksRange, calculatePayroll } from './services/scheduler';

// Soft, high-contrast-text pastels for worker color coding
const WORKER_PALETTE = [
  '#fecaca', '#fed7aa', '#fde68a', '#d9f99d', '#a7f3d0',
  '#a5f3fc', '#bfdbfe', '#c7d2fe', '#e9d5ff', '#fbcfe8'
];
const suggestWorkerColor = (employees: Employee[]): string =>
  WORKER_PALETTE.find(c => !employees.some(e => e.color === c)) ||
  WORKER_PALETTE[employees.length % WORKER_PALETTE.length];

const ColorDot: React.FC<{ color?: string }> = ({ color }) => (
  <span className="inline-block w-3 h-3 rounded-full border border-black/10 shrink-0" style={{ backgroundColor: color || '#e5e7eb' }} />
);

// Persist state to localStorage so a page refresh doesn't wipe workers,
// rules, or generated schedule versions (GitHub Pages has no backend).
function usePersistentState<T>(key: string, initial: T | (() => T)) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) return JSON.parse(raw) as T;
    } catch { /* corrupted or unavailable storage — fall back to defaults */ }
    return typeof initial === 'function' ? (initial as () => T)() : initial;
  });
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(state)); } catch { /* storage full/blocked */ }
  }, [key, state]);
  return [state, setState] as const;
}

// --- Manual History Modal ---
const ManualHistoryModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  year: number;
  month: number;
  employees: Employee[];
  onSave: (data: ManualHistoryInput) => void;
}> = ({ isOpen, onClose, year, month, employees, onSave }) => {
  // Hooks must run unconditionally — declaring state after the early
  // `if (!isOpen) return null` crashed React the first time the modal opened.
  const [inputData, setInputData] = useState<ManualHistoryInput>({});

  if (!isOpen) return null;

  const gridDays = getFullWeeksRange(year, month);
  const gridStart = gridDays[0];

  const contextDates: Date[] = [];
  const scheduleDates: Date[] = [];

  for (let i = 7; i > 0; i--) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() - i);
      contextDates.push(d);
  }
  for (let i = 0; i < 7; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      scheduleDates.push(d);
  }

  const toggleWorker = (dateKey: string, shift: 'dayShift' | 'nightShift', empId: string) => {
    setInputData(prev => {
      const current = prev[dateKey] || { dayShift: [], nightShift: [] };
      const list = current[shift];
      const exists = list.includes(empId);
      const newList = exists ? list.filter(id => id !== empId) : [...list, empId];
      
      return {
        ...prev,
        [dateKey]: { ...current, [shift]: newList }
      };
    });
  };

  const handleSave = () => {
    onSave(inputData);
    onClose();
  };

  const renderDay = (date: Date, isContext: boolean) => {
      const dateKey = formatDateKey(date);
      const entry = inputData[dateKey] || { dayShift: [], nightShift: [] };
      return (
         <div key={dateKey} className={`border rounded-lg p-3 ${isContext ? 'bg-gray-50 border-dashed' : 'bg-white border-solid border-blue-200'}`}>
            <div className="font-bold text-gray-700 mb-2 flex justify-between items-center">
               <span>{date.toLocaleDateString('default', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
               {isContext && <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">Context Only</span>}
            </div>
            <div className="grid grid-cols-2 gap-4">
               <div>
                  <div className="text-xs font-bold text-amber-600 mb-1">DAY</div>
                  <div className="flex flex-wrap gap-1">
                     {employees.map(e => (
                        <button
                          key={e.id}
                          onClick={() => toggleWorker(dateKey, 'dayShift', e.id)}
                          className={`text-xs px-2 py-1 rounded border ${
                            entry.dayShift.includes(e.id) ? 'bg-amber-100 border-amber-300 text-amber-800' : 'bg-white border-gray-200 text-gray-500'
                          }`}
                        >
                          {e.name}
                        </button>
                     ))}
                  </div>
               </div>
               <div>
                  <div className="text-xs font-bold text-indigo-600 mb-1">NIGHT</div>
                  <div className="flex flex-wrap gap-1">
                     {employees.map(e => (
                        <button
                          key={e.id}
                          onClick={() => toggleWorker(dateKey, 'nightShift', e.id)}
                          className={`text-xs px-2 py-1 rounded border ${
                            entry.nightShift.includes(e.id) ? 'bg-indigo-100 border-indigo-300 text-indigo-800' : 'bg-white border-gray-200 text-gray-500'
                          }`}
                        >
                          {e.name}
                        </button>
                     ))}
                  </div>
               </div>
            </div>
         </div>
      );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
       <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
          <div className="p-4 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
             <h3 className="text-lg font-bold text-gray-800">Set Transition Period</h3>
             <button onClick={onClose}><X className="w-5 h-5 text-gray-500" /></button>
          </div>
          <div className="p-4 overflow-y-auto flex-1">
             <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800 mb-4 flex items-start gap-2">
                 <Info className="w-5 h-5 shrink-0" />
                 <div>
                    <strong>Manual Transition Context:</strong>
                    <ul className="list-disc ml-4 mt-1 space-y-1">
                       <li><strong>Previous Context (Week 1):</strong> Hidden days used only to calculate constraints.</li>
                       <li><strong>Schedule Start (Week 2):</strong> First visible week of the new grid.</li>
                    </ul>
                 </div>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                 <div>
                    <h4 className="font-bold text-gray-500 text-sm uppercase mb-2 text-center">Previous Context (Hidden)</h4>
                    <div className="space-y-3">
                        {contextDates.map(d => renderDay(d, true))}
                    </div>
                 </div>
                 <div>
                    <h4 className="font-bold text-blue-600 text-sm uppercase mb-2 text-center">Schedule Start (Visible/Locked)</h4>
                    <div className="space-y-3">
                        {scheduleDates.map(d => renderDay(d, false))}
                    </div>
                 </div>
             </div>
          </div>
          <div className="p-4 border-t bg-gray-50 rounded-b-xl flex justify-end gap-2">
             <button onClick={onClose} className="px-4 py-2 text-gray-600">Cancel</button>
             <button onClick={handleSave} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Save Context</button>
          </div>
       </div>
    </div>
  );
};

// --- Employee Manager Component ---
const EmployeeManager: React.FC<{
  employees: Employee[];
  onAdd: (e: Employee) => void;
  onRemove: (id: string) => void;
  onUpdate: (e: Employee) => void;
}> = ({ employees, onAdd, onRemove, onUpdate }) => {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newPref, setNewPref] = useState<WorkerPreference>(WorkerPreference.EITHER);
  const [newDaysOff, setNewDaysOff] = useState<number[]>([]);
  const [newUnavailableDates, setNewUnavailableDates] = useState<string[]>([]);
  const [newTargetShifts, setNewTargetShifts] = useState<string>('');
  const [newHourlyRate, setNewHourlyRate] = useState<string>('');
  const [newColor, setNewColor] = useState<string>(WORKER_PALETTE[0]);

  // Specific Date Inputs
  const [dateInput, setDateInput] = useState('');
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');

  const resetForm = () => {
    setNewName('');
    setNewPref(WorkerPreference.EITHER);
    setNewDaysOff([]);
    setNewUnavailableDates([]);
    setNewTargetShifts('');
    setNewHourlyRate('');
    setEditingId(null);
    setIsAdding(false);
    setDateInput('');
    setRangeStart('');
    setRangeEnd('');
  };

  const startAdding = () => { resetForm(); setNewColor(suggestWorkerColor(employees)); setIsAdding(true); };
  const startEditing = (e: Employee) => {
    setNewName(e.name);
    setNewPref(e.preference);
    setNewDaysOff(e.availability.daysOff);
    setNewUnavailableDates(e.availability.unavailableDates || []);
    setNewTargetShifts(e.targetShifts ? e.targetShifts.toString() : '');
    setNewHourlyRate(e.hourlyRate ? e.hourlyRate.toString() : '');
    setNewColor(e.color && e.color !== '#fff' ? e.color : suggestWorkerColor(employees));
    setEditingId(e.id);
    setIsAdding(true);
  };

  const handleSave = () => {
    if (!newName.trim()) return;
    const targetShifts = newTargetShifts ? parseInt(newTargetShifts) : undefined;
    const hourlyRate = newHourlyRate ? parseFloat(newHourlyRate) : undefined;
    const employeeData = {
      name: newName, 
      preference: newPref, 
      availability: { 
        daysOff: newDaysOff, 
        unavailableDates: newUnavailableDates 
      }, 
      targetShifts,
      hourlyRate,
    };

    if (editingId) {
      onUpdate({
        ...employeeData,
        id: editingId,
        color: newColor
      });
    } else {
      onAdd({
        ...employeeData,
        id: crypto.randomUUID(),
        color: newColor
      });
    }
    resetForm();
  };

  const toggleDayOff = (dayIndex: number) => {
    setNewDaysOff(prev => prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex]);
  };

  const addUnavailableDate = () => {
    if (!dateInput || newUnavailableDates.includes(dateInput)) return;
    setNewUnavailableDates(prev => [...prev, dateInput].sort());
    setDateInput('');
  };

  const addRange = () => {
    if (!rangeStart || !rangeEnd) return;
    if (rangeStart > rangeEnd) { alert("Start date must be before end date"); return; }
    
    const datesToAdd: string[] = [];
    const current = new Date(rangeStart);
    const end = new Date(rangeEnd);
    current.setHours(12, 0, 0, 0);
    end.setHours(12, 0, 0, 0);

    while (current <= end) {
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const d = String(current.getDate()).padStart(2, '0');
        datesToAdd.push(`${y}-${m}-${d}`);
        current.setDate(current.getDate() + 1);
    }

    setNewUnavailableDates(prev => {
        const unique = new Set([...prev, ...datesToAdd]);
        return Array.from(unique).sort();
    });
    setRangeStart('');
    setRangeEnd('');
  };

  const removeUnavailableDate = (date: string) => {
    setNewUnavailableDates(prev => prev.filter(d => d !== date));
  };

  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  return (
    <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-100">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2"><Users className="w-5 h-5 text-blue-600" /> Workforce</h2>
        {!isAdding && <button onClick={startAdding} className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 flex items-center gap-2"><Plus className="w-4 h-4" /> Add Worker</button>}
      </div>
      {isAdding && (
        <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
          <h3 className="font-bold text-gray-800 mb-3">{editingId ? 'Edit Worker' : 'Add New Worker'}</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            <div><label className="block text-sm font-medium mb-1">Name</label><input value={newName} onChange={e => setNewName(e.target.value)} className="w-full p-2 border rounded bg-white text-black" /></div>
            <div>
              <label className="block text-sm font-medium mb-1">Preference</label>
              <select value={newPref} onChange={e => setNewPref(e.target.value as WorkerPreference)} className="w-full p-2 border rounded bg-white text-black">
                {Object.values(WorkerPreference).map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
               <label className="block text-sm font-medium mb-1">Target Shifts</label>
               <input type="number" min="0" value={newTargetShifts} onChange={e => setNewTargetShifts(e.target.value)} className="w-full p-2 border rounded bg-white text-black" placeholder="Optional" />
            </div>
            <div>
               <label className="block text-sm font-medium mb-1">Hourly Rate (₪)</label>
               <input type="number" min="0" step="0.5" value={newHourlyRate} onChange={e => setNewHourlyRate(e.target.value)} className="w-full p-2 border rounded bg-white text-black" placeholder="e.g. 75" />
            </div>
            <div>
               <label className="block text-sm font-medium mb-1">Color</label>
               <div className="flex items-center gap-2">
                  <input type="color" value={newColor} onChange={e => setNewColor(e.target.value)} className="w-10 h-10 p-0.5 border rounded bg-white cursor-pointer" title="Pick a custom color" />
                  <div className="flex flex-wrap gap-1">
                     {WORKER_PALETTE.map(c => (
                        <button key={c} onClick={() => setNewColor(c)} className={`w-5 h-5 rounded-full border-2 ${newColor === c ? 'border-blue-500 scale-110' : 'border-transparent'}`} style={{ backgroundColor: c }} title={c} />
                     ))}
                  </div>
               </div>
            </div>
          </div>
          
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-4">
             {/* Weekly Availability */}
             <div>
                <label className="block text-sm font-medium mb-2">Weekly Recurring Days Off</label>
                <div className="flex gap-2 flex-wrap">{days.map((d, i) => <button key={d} onClick={() => toggleDayOff(i)} className={`px-3 py-1 rounded-full text-sm border ${newDaysOff.includes(i) ? 'bg-red-100 text-red-700 border-red-200' : 'bg-white text-gray-600 border-gray-200'}`}>{d}</button>)}</div>
             </div>
             
             {/* Specific Dates / Vacations */}
             <div>
                <label className="block text-sm font-medium mb-2 flex items-center gap-1"><Plane className="w-4 h-4 text-blue-500" /> Vacation / Unavailable Dates</label>
                
                {/* Inputs Wrapper */}
                <div className="bg-white/50 border rounded-lg p-2 space-y-2 mb-2">
                   {/* Single Date */}
                   <div className="flex gap-2 items-center">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <input type="date" value={dateInput} onChange={e => setDateInput(e.target.value)} className="flex-1 p-1.5 border rounded text-xs bg-white text-black" />
                      <button onClick={addUnavailableDate} className="bg-gray-100 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-200 transition border">Add Single</button>
                   </div>
                   
                   {/* Range */}
                   <div className="flex gap-2 items-center">
                      <CalendarRange className="w-4 h-4 text-gray-400" />
                      <div className="flex items-center gap-1 flex-1">
                          <input type="date" value={rangeStart} onChange={e => setRangeStart(e.target.value)} className="w-full p-1.5 border rounded text-xs bg-white text-black" placeholder="Start" />
                          <span className="text-gray-400 text-xs">to</span>
                          <input type="date" value={rangeEnd} onChange={e => setRangeEnd(e.target.value)} className="w-full p-1.5 border rounded text-xs bg-white text-black" placeholder="End" />
                      </div>
                      <button onClick={addRange} className="bg-blue-100 text-blue-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-blue-200 transition border border-blue-200">Add Range</button>
                   </div>
                </div>

                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto border rounded p-2 bg-gray-50/50">
                   {newUnavailableDates.length === 0 && <span className="text-gray-400 text-xs italic">No specific dates added</span>}
                   {newUnavailableDates.map(date => (
                      <span key={date} className="flex items-center gap-1 bg-white text-gray-700 px-2 py-0.5 rounded text-[10px] font-medium border border-gray-200 shadow-sm">
                         {new Date(date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}
                         <button onClick={() => removeUnavailableDate(date)} className="text-gray-400 hover:text-red-500"><X className="w-3 h-3" /></button>
                      </span>
                   ))}
                </div>
             </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-blue-100">
            <button onClick={resetForm} className="text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
            <button onClick={handleSave} className="bg-blue-600 text-white px-4 py-2 rounded-lg">{editingId ? 'Save' : 'Add'}</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {employees.map(e => (
          <div key={e.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border hover:border-blue-200 transition group">
            <div className="flex-1">
              <div className="font-semibold text-gray-900 flex gap-2 items-center">
                <ColorDot color={e.color} />
                {e.name}
                {e.targetShifts && <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded">Target: {e.targetShifts}</span>}
                {e.hourlyRate && <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1 rounded">₪{e.hourlyRate}/h</span>}
              </div>
              <div className="text-xs text-gray-500 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <span className={`px-2 py-0.5 rounded ${e.preference === WorkerPreference.DAY_ONLY ? 'bg-amber-100 text-amber-700' : e.preference === WorkerPreference.NIGHT_ONLY ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200'}`}>{e.preference}</span>
                {e.availability.daysOff.length > 0 && <span className="text-red-500">Weekly: {e.availability.daysOff.map(d => days[d]).join(', ')}</span>}
                {e.availability.unavailableDates && e.availability.unavailableDates.length > 0 && (
                   <span className="text-blue-600 flex items-center gap-0.5"><Plane className="w-3 h-3" /> {e.availability.unavailableDates.length} days off</span>
                )}
              </div>
            </div>
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
              <button onClick={() => startEditing(e)} className="p-2 text-gray-400 hover:text-blue-600 rounded-full"><Edit2 className="w-4 h-4" /></button>
              <button onClick={() => onRemove(e.id)} className="p-2 text-gray-400 hover:text-red-500 rounded-full"><Trash2 className="w-4 h-4" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// --- Config Panel ---
const ConfigPanel: React.FC<{ config: ShiftConfig; onUpdate: (c: ShiftConfig) => void; }> = ({ config, onUpdate }) => {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const updateReq = (dayIdx: number, shift: 'day' | 'night', val: number) => {
    const newReqs = { ...config.requirements };
    if (!newReqs[dayIdx]) newReqs[dayIdx] = { day: 1, night: 1 };
    newReqs[dayIdx] = { ...newReqs[dayIdx], [shift]: val };
    onUpdate({ ...config, requirements: newReqs });
  };

  const updateTiming = (dayIdx: number, field: 'startTime' | 'endTime', val: string) => {
    const newTimings = { ...config.dailyTimings };
    if (!newTimings[dayIdx]) newTimings[dayIdx] = { startTime: '07:00', endTime: '22:00' };
    newTimings[dayIdx] = { ...newTimings[dayIdx], [field]: val };
    onUpdate({ ...config, dailyTimings: newTimings });
  };

  // Helper to display shift duration info
  const getDurationInfo = (idx: number) => {
    const t = config.dailyTimings[idx] || { startTime: '07:00', endTime: '22:00' };
    const parse = (s: string) => { const [h, m] = s.split(':').map(Number); return h + m/60; };
    let start = parse(t.startTime);
    let end = parse(t.endTime);
    if (end < start) end += 24;
    const total = end - start;
    const split = (total + 1) / 2;
    return { total, split };
  };

  return (
    <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-100">
      <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><Settings className="w-5 h-5 text-blue-600" /> Shift Rules</h2>
      
      <div className="mb-6 bg-blue-50 p-4 rounded-lg border border-blue-100 text-sm text-blue-800">
        <h4 className="font-bold flex items-center gap-2 mb-1"><Info className="w-4 h-4"/> How Shifts Are Calculated</h4>
        <p>Morning and Night shifts split the operational window evenly with a <strong>1-hour overlap</strong>.</p>
        <p className="mt-1">Example: 07:00 to 22:00 (15h total) → 8h Shifts (07:00-15:00 & 14:00-22:00).</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-gray-50 text-gray-500 font-medium">
            <tr>
              <th className="px-4 py-3">Day</th>
              <th className="px-4 py-3">Operational Hours (Start - End)</th>
              <th className="px-4 py-3">Requirements (Day / Night)</th>
              <th className="px-4 py-3">Shift Duration</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {days.map((day, idx) => {
               const req = config.requirements[idx] || { day: 1, night: 1 };
               const time = config.dailyTimings[idx] || { startTime: '07:00', endTime: '22:00' };
               const info = getDurationInfo(idx);
               return (
                 <tr key={day} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 w-32">{day}</td>
                    <td className="px-4 py-3">
                       <div className="flex items-center gap-2">
                          <input type="time" value={time.startTime} onChange={e => updateTiming(idx, 'startTime', e.target.value)} className="p-1.5 border rounded bg-white text-black" />
                          <span className="text-gray-400">to</span>
                          <input type="time" value={time.endTime} onChange={e => updateTiming(idx, 'endTime', e.target.value)} className="p-1.5 border rounded bg-white text-black" />
                       </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-4">
                        <div className="flex items-center gap-2"><span className="text-amber-600 text-xs font-bold">DAY</span><input type="number" min="0" value={req.day} onChange={e => updateReq(idx, 'day', parseInt(e.target.value))} className="w-12 p-1.5 border rounded text-center bg-white text-black" /></div>
                        <div className="flex items-center gap-2"><span className="text-indigo-600 text-xs font-bold">NIGHT</span><input type="number" min="0" value={req.night} onChange={e => updateReq(idx, 'night', parseInt(e.target.value))} className="w-12 p-1.5 border rounded text-center bg-white text-black" /></div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                       {req.day === 0 && req.night === 0 ? (
                         <span className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-500">Off</span>
                       ) : req.day === 0 || req.night === 0 ? (
                         <span className="text-xs bg-purple-100 text-purple-700 px-2 py-1 rounded font-bold">Solo: {info.total}h</span>
                       ) : (
                         <span className="text-xs bg-gray-100 px-2 py-1 rounded">Split: {info.split}h</span>
                       )}
                    </td>
                 </tr>
               );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-6 bg-emerald-50 p-4 rounded-lg border border-emerald-100">
           <div className="flex items-center gap-2 mb-1">
              <Clock className="w-4 h-4 text-emerald-600" />
              <span className="text-sm font-medium text-gray-900">Work Pattern & Limits</span>
           </div>
           <p className="text-xs text-gray-500 mb-3">Health and rest limits are hard rules the generator never breaks. Block mode builds continuous same-shift runs and rotates day/night in whole blocks for a predictable routine.</p>
           <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-3">
              <div>
                 <label className="block text-xs font-medium text-gray-600 mb-1">Max consecutive work days</label>
                 <input
                   type="number" min="1" max="14"
                   value={config.maxConsecutiveDays ?? 5}
                   onChange={e => onUpdate({ ...config, maxConsecutiveDays: Math.max(1, parseInt(e.target.value) || 1) })}
                   className="w-full p-2 border rounded bg-white text-black"
                 />
              </div>
              <div>
                 <label className="block text-xs font-medium text-gray-600 mb-1">Min rest days between blocks</label>
                 <input
                   type="number" min="1" max="7"
                   value={config.minRestDays ?? 1}
                   onChange={e => onUpdate({ ...config, minRestDays: Math.max(1, parseInt(e.target.value) || 1) })}
                   className="w-full p-2 border rounded bg-white text-black"
                 />
              </div>
              <div>
                 <label className="block text-xs font-medium text-gray-600 mb-1">Max shifts per worker / month</label>
                 <input
                   type="number" min="0"
                   value={config.maxShiftsPerMonth || ''}
                   placeholder="No cap"
                   onChange={e => onUpdate({ ...config, maxShiftsPerMonth: parseInt(e.target.value) || 0 })}
                   className="w-full p-2 border rounded bg-white text-black"
                 />
              </div>
           </div>
           <div className="flex items-center justify-between bg-white/60 rounded-lg p-3 border border-emerald-100">
              <div>
                 <div className="text-sm font-medium text-gray-900">Consistent shift blocks</div>
                 <div className="text-xs text-gray-500">Same shift type for a whole block (no day/night mixing), then rotate to the other type after rest</div>
              </div>
              <button onClick={() => onUpdate({ ...config, blockScheduling: !(config.blockScheduling ?? true) })} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 ${(config.blockScheduling ?? true) ? 'bg-emerald-600' : 'bg-gray-200'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${(config.blockScheduling ?? true) ? 'translate-x-6' : 'translate-x-1'}`} /></button>
           </div>
      </div>

      <div className="mt-6 bg-amber-50 p-4 rounded-lg border border-amber-100">
           <div className="flex items-center gap-2 mb-1">
              <Star className="w-4 h-4 text-amber-500" />
              <span className="text-sm font-medium text-gray-900">Premium / Weekend Days (higher pay)</span>
           </div>
           <p className="text-xs text-gray-500 mb-3">These sought-after shifts are rotated evenly between workers.</p>
           <div className="flex gap-2 flex-wrap">
              {days.map((d, i) => {
                 const premium = config.premiumDays ?? [5, 6];
                 const active = premium.includes(i);
                 return (
                   <button
                     key={d}
                     onClick={() => onUpdate({ ...config, premiumDays: active ? premium.filter(x => x !== i) : [...premium, i].sort() })}
                     className={`px-3 py-1 rounded-full text-sm border ${active ? 'bg-amber-100 text-amber-700 border-amber-300 font-bold' : 'bg-white text-gray-600 border-gray-200'}`}
                   >
                     {d.slice(0, 3)}
                   </button>
                 );
              })}
           </div>
      </div>

      <div className="mt-6 bg-gray-50 p-4 rounded-lg flex items-center justify-between">
           <span className="text-sm font-medium text-gray-900">Prioritize "Either" Preference for Day Shifts</span>
           <button onClick={() => onUpdate({...config, distributeDayShiftsToEither: !config.distributeDayShiftsToEither})} className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.distributeDayShiftsToEither ? 'bg-blue-600' : 'bg-gray-200'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.distributeDayShiftsToEither ? 'translate-x-6' : 'translate-x-1'}`} /></button>
      </div>
    </div>
  );
};

// --- Payroll Dashboard ---
const PayrollDashboard: React.FC<{
  version: ScheduleVersion;
  employees: Employee[];
  config: ShiftConfig;
}> = ({ version, employees, config }) => {
  const payrollData = calculatePayroll(version, employees, config);

  return (
    <div className="space-y-6">
       <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="p-4 border-b bg-gray-50 flex justify-between items-center">
             <h3 className="font-bold text-gray-800 flex items-center gap-2"><DollarSign className="w-5 h-5 text-green-600" /> Payroll Estimation</h3>
             <div className="text-xs text-gray-500">Based on configured daily hours</div>
          </div>
          <div className="overflow-x-auto">
             <table className="w-full text-sm text-left">
                <thead className="bg-gray-50 text-gray-500 font-medium border-b">
                   <tr>
                     <th className="px-4 py-3">Employee</th>
                     <th className="px-4 py-3">Rate</th>
                     <th className="px-4 py-3 text-center">Regular (1x)</th>
                     <th className="px-4 py-3 text-center">OT (1.25x)</th>
                     <th className="px-4 py-3 text-center">Extra (1.5x)</th>
                     <th className="px-4 py-3 text-center">Total Hours</th>
                     <th className="px-4 py-3 text-right">Est. Pay</th>
                   </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                   {employees.map(e => {
                      const data = payrollData[e.id];
                      if (!data || data.totalHours === 0) return null;
                      return (
                        <tr key={e.id} className="hover:bg-gray-50">
                           <td className="px-4 py-3 font-medium text-gray-900"><span className="flex items-center gap-2"><ColorDot color={e.color} /> {e.name}</span></td>
                           <td className="px-4 py-3 text-gray-500">{e.hourlyRate ? `₪${e.hourlyRate}` : '-'}</td>
                           <td className="px-4 py-3 text-center text-gray-900">{data.regularHours.toFixed(1)}</td>
                           <td className="px-4 py-3 text-center text-amber-600">{data.overtime125.toFixed(1)}</td>
                           <td className="px-4 py-3 text-center text-red-600 font-bold">{data.overtime150.toFixed(1)}</td>
                           <td className="px-4 py-3 text-center font-bold text-gray-900">{data.totalHours.toFixed(1)}</td>
                           <td className="px-4 py-3 text-right font-bold text-green-700">
                              {data.estimatedPay > 0 ? `₪${data.estimatedPay.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})}` : '-'}
                           </td>
                        </tr>
                      );
                   })}
                   {employees.every(e => !payrollData[e.id] || payrollData[e.id].totalHours === 0) && (
                      <tr><td colSpan={7} className="text-center py-4 text-gray-400">No shifts scheduled</td></tr>
                   )}
                </tbody>
             </table>
          </div>
       </div>
    </div>
  );
};

// --- Schedule Viewer ---
const ScheduleViewer: React.FC<{
  version: ScheduleVersion;
  employees: Employee[];
  config: ShiftConfig;
  onManualUpdate: (date: string, shift: ShiftType, empId: string) => void;
  onManualRemove: (date: string, shift: ShiftType, empId: string) => void;
  onToggleLock: (date: string) => void;
}> = ({ version, employees, config, onManualUpdate, onManualRemove, onToggleLock }) => {
  const [view, setView] = useState<'calendar' | 'stats' | 'payroll'>('calendar');
  const [modalOpen, setModalOpen] = useState(false);
  const [manualSlot, setManualSlot] = useState<{ date: string, shift: ShiftType } | null>(null);

  // Judge this schedule against the rules it was generated with, not the
  // current (possibly edited) config.
  const cfg = version.configSnapshot || config;

  const getEmp = (id: string) => employees.find(e => e.id === id);
  const openManualAssign = (date: string, shift: ShiftType) => { setManualSlot({ date, shift }); setModalOpen(true); };

  // Eligibility hints for the manual-assignment modal
  const getAssignmentWarnings = (e: Employee, date: string, shift: ShiftType): string[] => {
    const warnings: string[] = [];
    const d = parseDateKey(date);
    if (e.availability.daysOff.includes(d.getDay())) warnings.push('Weekly day off');
    if (e.availability.unavailableDates?.includes(date)) warnings.push('Unavailable / vacation');
    if (shift === ShiftType.DAY && e.preference === WorkerPreference.NIGHT_ONLY) warnings.push('Prefers nights only');
    if (shift === ShiftType.NIGHT && e.preference === WorkerPreference.DAY_ONLY) warnings.push('Prefers days only');

    // Health / work-pattern rule checks against the adjacent days
    const adjacent = (delta: number) => {
      const ad = parseDateKey(date);
      ad.setDate(ad.getDate() + delta);
      return version.schedule.find(s => s.date === formatDateKey(ad));
    };
    const prevDay = adjacent(-1);
    const nextDay = adjacent(1);
    if (shift === ShiftType.DAY && prevDay?.nightShift.includes(e.id)) warnings.push('Day shift right after their night shift');
    if (shift === ShiftType.NIGHT && nextDay?.dayShift.includes(e.id)) warnings.push('They work a day shift the next morning');
    if (cfg.blockScheduling ?? true) {
      const other = shift === ShiftType.DAY ? 'nightShift' : 'dayShift';
      if (prevDay?.[other].includes(e.id) || nextDay?.[other].includes(e.id)) warnings.push('Mixes shift types within a block');
    }
    const cap = cfg.maxShiftsPerMonth || 0;
    if (cap > 0 && (version.stats[e.id]?.totalShifts || 0) >= cap) warnings.push(`At monthly cap (${cap} shifts)`);
    return warnings;
  };
  const isAlreadyAssigned = (empId: string, date: string): boolean => {
    const day = version.schedule.find(s => s.date === date);
    return !!day && (day.dayShift.includes(empId) || day.nightShift.includes(empId));
  };

  const payrollForStats = useMemo(() => calculatePayroll(version, employees, cfg), [version, employees, cfg]);

  // Premium/weekend shifts per worker, computed from the live schedule so
  // manual edits are reflected immediately.
  const premiumDaySet = useMemo(() => new Set(cfg.premiumDays ?? [5, 6]), [cfg]);
  const weekendCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    version.schedule.forEach(d => {
      if (d.isPadding || !premiumDaySet.has(parseDateKey(d.date).getDay())) return;
      [...d.dayShift, ...d.nightShift].forEach(id => { counts[id] = (counts[id] || 0) + 1; });
    });
    return counts;
  }, [version, premiumDaySet]);

  return (
    <div className="space-y-6">
       <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
          <div>
            <h2 className="text-xl font-bold text-gray-800">{version.name}</h2>
            <p className="text-sm text-gray-500">Generated: {new Date(version.timestamp).toLocaleString()}</p>
          </div>
          <div className="flex gap-2">
             <div className="flex bg-gray-100 rounded-lg p-1">
                <button onClick={() => setView('calendar')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${view === 'calendar' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>Calendar</button>
                <button onClick={() => setView('stats')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${view === 'stats' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>Stats</button>
                <button onClick={() => setView('payroll')} className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${view === 'payroll' ? 'bg-white shadow text-blue-600' : 'text-gray-500'}`}>Payroll</button>
             </div>
             <button onClick={() => exportToCSV(version, employees)} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700"><Download className="w-4 h-4" /> CSV</button>
             <button onClick={() => exportToExcel(version, employees)} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-emerald-700"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
          </div>
       </div>

       {view === 'payroll' ? (
          <PayrollDashboard version={version} employees={employees} config={config} />
       ) : view === 'calendar' ? (
         <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="grid grid-cols-7 bg-gray-50 border-b text-center py-2 text-xs font-bold text-gray-500 uppercase">
               {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 auto-rows-fr bg-gray-200 gap-px">
               {version.schedule.map((daySch) => {
                 const dateObj = parseDateKey(daySch.date);
                 const req = cfg.requirements[dateObj.getDay()] || { day: 1, night: 1 };
                 // A solo requirement (total 1) is covered whichever shift the
                 // worker landed in — don't flag the other slot as empty.
                 const soloCovered = (req.day + req.night === 1) && (daySch.dayShift.length + daySch.nightShift.length >= 1);
                 const missingDay = soloCovered ? 0 : req.day - daySch.dayShift.length;
                 const missingNight = soloCovered ? 0 : req.night - daySch.nightShift.length;

                 const isPremiumDay = !daySch.isPadding && premiumDaySet.has(dateObj.getDay());

                 return (
                   <div key={daySch.date} className={`group min-h-[120px] p-2 flex flex-col gap-1 ${daySch.isPadding ? 'bg-gray-100' : 'bg-white'} ${daySch.locked ? 'ring-2 ring-inset ring-blue-400' : ''}`}>
                      <div className="flex justify-between items-center mb-1">
                         {!daySch.isPadding ? (
                           <button
                             onClick={() => onToggleLock(daySch.date)}
                             title={daySch.locked ? 'Unlock: allow this day to change on regenerate' : 'Lock: keep this day as-is when regenerating'}
                             className={`transition ${daySch.locked ? 'text-blue-600' : 'text-gray-300 opacity-0 group-hover:opacity-100 hover:text-blue-500'}`}
                           >
                             {daySch.locked ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
                           </button>
                         ) : <span />}
                         <div className={`text-right text-sm font-bold flex items-center gap-1 ${daySch.isPadding ? 'text-gray-300' : 'text-gray-500'}`}>
                            {isPremiumDay && <Star className="w-3 h-3 text-amber-400 fill-amber-300" />}
                            {dateObj.getDate()}
                         </div>
                      </div>

                      {/* Day Shift */}
                      <div className="bg-amber-50 rounded p-1 border border-amber-100">
                         <div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Day</div>
                         <div className="space-y-1">
                           {daySch.dayShift.map(id => (
                             <div key={id} className={`group/chip flex items-center justify-between text-xs px-1.5 py-0.5 rounded shadow-sm text-gray-800 ${daySch.isPadding ? 'bg-gray-200 opacity-60' : ''}`} style={daySch.isPadding ? undefined : { backgroundColor: getEmp(id)?.color || '#fff' }}>
                               <span className="truncate">{getEmp(id)?.name}</span>
                               {!daySch.isPadding && (
                                 <button onClick={() => onManualRemove(daySch.date, ShiftType.DAY, id)} title="Remove from shift" className="opacity-0 group-hover/chip:opacity-100 text-gray-500 hover:text-red-600 shrink-0 ml-1"><X className="w-3 h-3" /></button>
                               )}
                             </div>
                           ))}
                           {!daySch.isPadding && missingDay > 0 && Array.from({length: missingDay}).map((_, i) => (
                               <button key={i} onClick={() => openManualAssign(daySch.date, ShiftType.DAY)} className="w-full text-left text-xs px-1.5 py-1 bg-red-100 text-red-700 rounded flex items-center gap-1 hover:bg-red-200"><AlertCircle className="w-3 h-3" /> Empty</button>
                           ))}
                           {!daySch.isPadding && missingDay <= 0 && (
                               <button onClick={() => openManualAssign(daySch.date, ShiftType.DAY)} title="Add extra day-shift worker" className="w-full text-center text-[10px] py-0.5 rounded text-amber-500 hover:bg-amber-100 opacity-0 group-hover:opacity-100 transition">+ Add</button>
                           )}
                         </div>
                      </div>
                      {/* Night Shift */}
                      <div className="bg-indigo-50 rounded p-1 border border-indigo-100 mt-auto">
                         <div className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Night</div>
                         <div className="space-y-1">
                           {daySch.nightShift.map(id => (
                             <div key={id} className={`group/chip flex items-center justify-between text-xs px-1.5 py-0.5 rounded shadow-sm text-gray-800 border-l-2 border-indigo-400 ${daySch.isPadding ? 'bg-gray-200 opacity-60' : ''}`} style={daySch.isPadding ? undefined : { backgroundColor: getEmp(id)?.color || '#fff' }}>
                               <span className="truncate">{getEmp(id)?.name}</span>
                               {!daySch.isPadding && (
                                 <button onClick={() => onManualRemove(daySch.date, ShiftType.NIGHT, id)} title="Remove from shift" className="opacity-0 group-hover/chip:opacity-100 text-gray-500 hover:text-red-600 shrink-0 ml-1"><X className="w-3 h-3" /></button>
                               )}
                             </div>
                           ))}
                           {!daySch.isPadding && missingNight > 0 && Array.from({length: missingNight}).map((_, i) => (
                               <button key={i} onClick={() => openManualAssign(daySch.date, ShiftType.NIGHT)} className="w-full text-left text-xs px-1.5 py-1 bg-red-100 text-red-700 rounded flex items-center gap-1 hover:bg-red-200"><AlertCircle className="w-3 h-3" /> Empty</button>
                           ))}
                           {!daySch.isPadding && missingNight <= 0 && (
                               <button onClick={() => openManualAssign(daySch.date, ShiftType.NIGHT)} title="Add extra night-shift worker" className="w-full text-center text-[10px] py-0.5 rounded text-indigo-400 hover:bg-indigo-100 opacity-0 group-hover:opacity-100 transition">+ Add</button>
                           )}
                         </div>
                      </div>
                   </div>
                 );
               })}
            </div>
         </div>
       ) : (
         <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden p-6">
            <h3 className="font-bold text-gray-800 mb-4">Fairness Analysis (Target Month Only)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                 <thead className="bg-gray-50 text-gray-500 font-medium">
                    <tr>
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3 text-center">Day</th>
                      <th className="px-4 py-3 text-center">Night</th>
                      <th className="px-4 py-3 text-center">Day/Night Mix</th>
                      <th className="px-4 py-3 text-center">Total</th>
                      <th className="px-4 py-3 text-center">Hours</th>
                      <th className="px-4 py-3 text-center"><span className="inline-flex items-center gap-1"><Star className="w-3 h-3 text-amber-400" /> Weekend</span></th>
                      <th className="px-4 py-3 text-center">Longest Streak</th>
                      <th className="px-4 py-3 text-center">Target</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100">
                    {employees.map(emp => {
                       const stats = version.stats[emp.id] || { dayShifts: 0, nightShifts: 0, totalShifts: 0, longestStreak: 0 };
                       const hours = payrollForStats[emp.id]?.totalHours || 0;
                       const dayPct = stats.totalShifts > 0 ? Math.round((stats.dayShifts / stats.totalShifts) * 100) : 0;
                       const mixSkewed = stats.totalShifts > 2 && emp.preference === WorkerPreference.EITHER && (dayPct <= 25 || dayPct >= 75);
                       return (
                         <tr key={emp.id} className="hover:bg-gray-50">
                           <td className="px-4 py-3 font-medium text-gray-900"><span className="flex items-center gap-2"><ColorDot color={emp.color} /> {emp.name}</span></td>
                           <td className="px-4 py-3 text-center font-medium text-gray-900">{stats.dayShifts}</td>
                           <td className="px-4 py-3 text-center font-medium text-gray-900">{stats.nightShifts}</td>
                           <td className="px-4 py-3 text-center">
                              {stats.totalShifts > 0 ? (
                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${mixSkewed ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{dayPct}% day</span>
                              ) : '-'}
                           </td>
                           <td className="px-4 py-3 text-center font-bold bg-gray-50 text-gray-900">{stats.totalShifts}</td>
                           <td className="px-4 py-3 text-center font-medium text-gray-900">{hours.toFixed(1)}</td>
                           <td className="px-4 py-3 text-center font-medium text-amber-700">{weekendCounts[emp.id] || 0}</td>
                           <td className="px-4 py-3 text-center">
                              <span className={`px-2 py-1 rounded-full text-xs font-bold ${stats.longestStreak > (cfg.maxConsecutiveDays ?? 5) ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>{stats.longestStreak}d</span>
                           </td>
                           <td className="px-4 py-3 text-center">
                              {emp.targetShifts ? (
                                <span className={`px-2 py-1 rounded-full text-xs font-bold ${stats.totalShifts >= emp.targetShifts ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>{stats.totalShifts}/{emp.targetShifts}</span>
                              ) : '-'}
                           </td>
                         </tr>
                       )
                    })}
                 </tbody>
              </table>
            </div>
         </div>
       )}

       {modalOpen && manualSlot && (
         <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl p-6 w-full max-w-md">
               <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-bold text-gray-900">Manual Assignment</h3><button onClick={() => setModalOpen(false)}><X className="w-5 h-5" /></button></div>
               <div className="space-y-2 max-h-[300px] overflow-y-auto">
                 {employees.map(e => {
                   const alreadyAssigned = isAlreadyAssigned(e.id, manualSlot.date);
                   const warnings = getAssignmentWarnings(e, manualSlot.date, manualSlot.shift);
                   return (
                     <button
                       key={e.id}
                       disabled={alreadyAssigned}
                       onClick={() => { onManualUpdate(manualSlot.date, manualSlot.shift, e.id); setModalOpen(false); }}
                       className={`w-full flex items-center justify-between p-3 rounded-lg border text-left ${alreadyAssigned ? 'opacity-40 cursor-not-allowed bg-gray-50' : warnings.length > 0 ? 'border-amber-200 bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-blue-50'}`}
                     >
                       <div>
                         <div className="font-medium text-gray-900 flex items-center gap-2"><ColorDot color={e.color} /> {e.name}</div>
                         <div className="text-xs text-gray-500">{e.preference}</div>
                         {alreadyAssigned && <div className="text-xs text-gray-400 mt-0.5">Already assigned this date</div>}
                         {!alreadyAssigned && warnings.length > 0 && (
                           <div className="text-xs text-amber-600 mt-0.5 flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {warnings.join(' · ')}</div>
                         )}
                       </div>
                       {e.targetShifts && <div className="text-xs bg-gray-100 px-2 py-1 rounded shrink-0">Target: {e.targetShifts}</div>}
                     </button>
                   );
                 })}
               </div>
            </div>
         </div>
       )}
    </div>
  );
};

// --- App ---
const App: React.FC = () => {
  const [tab, setTab] = useState<'workers' | 'rules' | 'schedule'>('workers');
  const [employees, setEmployees] = usePersistentState<Employee[]>('shiftmaster_employees', [
    { id: '1', name: 'גולן חדד', preference: WorkerPreference.DAY_ONLY, availability: { daysOff: [], unavailableDates: [] }, color: WORKER_PALETTE[0], hourlyRate: 75 },
    { id: '2', name: 'ניצן כפיר', preference: WorkerPreference.EITHER, availability: { daysOff: [], unavailableDates: [] }, color: WORKER_PALETTE[1], hourlyRate: 75 },
    { id: '3', name: 'דן אהרוני', preference: WorkerPreference.EITHER, availability: { daysOff: [], unavailableDates: [] }, color: WORKER_PALETTE[2], hourlyRate: 75 },
    { id: '4', name: 'ענבר כפיר', preference: WorkerPreference.EITHER, availability: { daysOff: [], unavailableDates: [] }, color: WORKER_PALETTE[3], hourlyRate: 75 },
    { id: '5', name: 'רועי נוף', preference: WorkerPreference.EITHER, availability: { daysOff: [], unavailableDates: [] }, color: WORKER_PALETTE[4], hourlyRate: 75 },
    { id: '6', name: 'עומרי חכים', preference: WorkerPreference.EITHER, availability: { daysOff: [], unavailableDates: [] }, color: WORKER_PALETTE[5], hourlyRate: 75 },
  ]);

  // Default Daily Timings: 07:00 - 16:00 for all days (updated from 22:00)
  const defaultTimings: Record<number, DailyTiming> = {};
  for(let i=0; i<7; i++) defaultTimings[i] = { startTime: '07:00', endTime: '16:00' };

  const [config, setConfig] = usePersistentState<ShiftConfig>('shiftmaster_config', {
    dailyTimings: defaultTimings,
    distributeDayShiftsToEither: false,
    requirements: { 
      0: { day: 1, night: 2 }, // Sun
      1: { day: 1, night: 1 }, // Mon
      2: { day: 1, night: 2 }, // Tue
      3: { day: 1, night: 1 }, // Wed
      4: { day: 1, night: 2 }, // Thu
      5: { day: 1, night: 1 }, // Fri
      6: { day: 1, night: 2 }  // Sat
    }
  });
  
  const [versions, setVersions] = usePersistentState<ScheduleVersion[]>('shiftmaster_versions', []);
  const [selectedVersionId, setSelectedVersionId] = usePersistentState<string | null>('shiftmaster_selected_version', null);
  const [genMonth, setGenMonth] = useState(new Date().getMonth());
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [manualHistory, setManualHistory] = useState<ManualHistoryInput | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [importedHistory, setImportedHistory] = useState<HistoricalContext | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);

  const currentVersion = useMemo(() => versions.find(v => v.id === selectedVersionId) || versions[0] || null, [versions, selectedVersionId]);

  // One-time migration: assign palette colors to workers saved before color
  // coding existed (they carry the '#fff' placeholder).
  useEffect(() => {
    if (employees.some(e => !e.color || e.color === '#fff')) {
      setEmployees(prev => prev.map((e, i) =>
        (!e.color || e.color === '#fff') ? { ...e, color: WORKER_PALETTE[i % WORKER_PALETTE.length] } : e
      ));
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Locked days in the current version (for the same month) survive regeneration
  const lockedDaysForGen = useMemo(() => {
    if (!currentVersion || currentVersion.month !== genMonth || currentVersion.year !== genYear) return null;
    const entries: ManualHistoryInput = {};
    const validIds = new Set(employees.map(e => e.id));
    currentVersion.schedule.forEach(d => {
      if (d.locked && !d.isPadding) {
        entries[d.date] = {
          dayShift: d.dayShift.filter(id => validIds.has(id)),
          nightShift: d.nightShift.filter(id => validIds.has(id))
        };
      }
    });
    return Object.keys(entries).length > 0 ? entries : null;
  }, [currentVersion, genMonth, genYear, employees]);

  const handleGenerate = () => {
    if (employees.length === 0) { alert("No employees"); return; }
    try {
      const v = generateSchedule(employees, genYear, genMonth, config, importedHistory || undefined, manualHistory || undefined, lockedDaysForGen || undefined);
      // Number the variations so multiple runs for the same month are
      // distinguishable (computed inside the updater to avoid stale counts)
      setVersions(p => {
        const variation = p.filter(x => x.month === genMonth && x.year === genYear).length + 1;
        return [{ ...v, name: `${v.name} · v${variation}` }, ...p];
      });
      setSelectedVersionId(v.id); setTab('schedule');
    } catch (e) { alert("Generation failed"); console.error(e); }
  };

  const handleToggleLock = (date: string) => {
    if (!currentVersion) return;
    const updated = {
      ...currentVersion,
      schedule: currentVersion.schedule.map(s => s.date === date ? { ...s, locked: !s.locked } : s)
    };
    setVersions(p => p.map(v => v.id === updated.id ? updated : v));
  };

  // --- JSON Backup / Restore ---
  const handleBackup = () => {
    const data = {
      app: 'ShiftMaster',
      backupVersion: 1,
      exportedAt: new Date().toISOString(),
      employees, config, versions, selectedVersionId
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `shiftmaster_backup_${formatDateKey(new Date())}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'ShiftMaster' || !Array.isArray(data.employees) || !data.config || !Array.isArray(data.versions)) {
        alert('This file is not a valid ShiftMaster backup.');
        return;
      }
      const when = data.exportedAt ? new Date(data.exportedAt).toLocaleString() : 'unknown date';
      if (!window.confirm(`Restore backup from ${when}?\nThis replaces the current workers, rules, and all schedule versions.`)) return;
      setEmployees(data.employees);
      setConfig(data.config);
      setVersions(data.versions);
      setSelectedVersionId(data.selectedVersionId ?? null);
      alert('Backup restored.');
    } catch {
      alert('Could not read the backup file.');
    }
  };

  const handleManualAssign = (date: string, shift: ShiftType, empId: string) => {
    if (!currentVersion) return;
    const updated = { ...currentVersion, schedule: [...currentVersion.schedule] };
    const idx = updated.schedule.findIndex(s => s.date === date);
    if (idx > -1) {
      const d = { ...updated.schedule[idx] };
      // Guard against double-assignment on the same date
      if (d.dayShift.includes(empId) || d.nightShift.includes(empId)) return;
      if (shift === ShiftType.DAY) d.dayShift = [...d.dayShift, empId]; else d.nightShift = [...d.nightShift, empId];
      updated.schedule[idx] = d;
      if (!d.isPadding) {
         // Employee may have been added after this version was generated
         const st = { ...(updated.stats[empId] || { totalShifts: 0, dayShifts: 0, nightShifts: 0, longestStreak: 0 }) };
         st.totalShifts++;
         if (shift === ShiftType.DAY) st.dayShifts++; else st.nightShifts++;
         updated.stats = { ...updated.stats, [empId]: st };
      }
      setVersions(p => p.map(v => v.id === updated.id ? updated : v));
    }
  };

  const handleManualRemove = (date: string, shift: ShiftType, empId: string) => {
    if (!currentVersion) return;
    const day = currentVersion.schedule.find(s => s.date === date);
    if (!day) return;
    const updated = {
      ...currentVersion,
      schedule: currentVersion.schedule.map(s => {
        if (s.date !== date) return s;
        return shift === ShiftType.DAY
          ? { ...s, dayShift: s.dayShift.filter(id => id !== empId) }
          : { ...s, nightShift: s.nightShift.filter(id => id !== empId) };
      })
    };
    if (!day.isPadding && updated.stats[empId]) {
      const st = { ...updated.stats[empId] };
      st.totalShifts = Math.max(0, st.totalShifts - 1);
      if (shift === ShiftType.DAY) st.dayShifts = Math.max(0, st.dayShifts - 1);
      else st.nightShifts = Math.max(0, st.nightShifts - 1);
      updated.stats = { ...updated.stats, [empId]: st };
    }
    setVersions(p => p.map(v => v.id === updated.id ? updated : v));
  };

  const handleImportHistory = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      try {
        const history = await parsePastScheduleCSV(e.target.files[0], employees);
        setImportedHistory(history);
        alert(`Successfully imported history from ${history.sourceName}`);
      } catch (err) {
        alert("Failed to parse CSV. Make sure names match current employees.");
      }
    }
    if (e.target) e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-slate-900 text-white p-4 sticky top-0 z-20 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold flex gap-2 items-center"><Calendar className="text-blue-400"/> ShiftMaster</h1>
          <div className="flex items-center gap-3">
            <nav className="flex gap-1 bg-slate-800 p-1 rounded-lg">
               {['workers','rules','schedule'].map(t => <button key={t} onClick={() => setTab(t as any)} className={`px-4 py-2 rounded-md text-sm capitalize transition ${tab===t?'bg-blue-600 text-white shadow-lg shadow-blue-900/50':'text-slate-400 hover:text-white'}`}>{t}</button>)}
            </nav>
            <div className="flex gap-1 border-l border-slate-700 pl-3">
               <button onClick={handleBackup} title="Download full backup (workers, rules, schedules) as JSON" className="p-2 text-slate-400 hover:text-white transition"><Download className="w-4 h-4" /></button>
               <button onClick={() => backupInputRef.current?.click()} title="Restore from a JSON backup" className="p-2 text-slate-400 hover:text-white transition"><Upload className="w-4 h-4" /></button>
               <input type="file" ref={backupInputRef} accept=".json,application/json" className="hidden" onChange={handleRestore} />
            </div>
          </div>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        {tab === 'workers' && <EmployeeManager employees={employees} onAdd={e=>setEmployees([...employees, e])} onRemove={id=>setEmployees(p=>p.filter(e=>e.id!==id))} onUpdate={u=>setEmployees(p=>p.map(e=>e.id===u.id?u:e))} />}
        {tab === 'rules' && <ConfigPanel config={config} onUpdate={setConfig} />}
        {tab === 'schedule' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
             <div className="lg:col-span-3 space-y-6">
                <div className="bg-white p-4 rounded-xl shadow border border-gray-100">
                   <h3 className="font-bold mb-4 flex gap-2 items-center"><CheckCircle className="text-blue-600 w-4 h-4"/> Generate</h3>
                   <div className="space-y-3 mb-4">
                      <div><label className="text-xs font-bold text-gray-500 uppercase">Month</label><select value={genMonth} onChange={e=>setGenMonth(parseInt(e.target.value))} className="w-full p-2 border rounded bg-gray-50 text-black">{Array.from({length:12}).map((_,i)=><option key={i} value={i}>{new Date(2000,i,1).toLocaleString('default',{month:'long'})}</option>)}</select></div>
                      <div><label className="text-xs font-bold text-gray-500 uppercase">Year</label><input type="number" value={genYear} onChange={e=>setGenYear(parseInt(e.target.value))} className="w-full p-2 border rounded bg-gray-50 text-black"/></div>
                   </div>
                   
                   <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleImportHistory} />
                   
                   <div className="space-y-2 mb-4">
                       <button onClick={() => setHistoryModalOpen(true)} className="w-full text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded flex justify-center items-center gap-2 border">
                          <History className="w-3 h-3" /> {manualHistory ? 'Edit Manual Context' : 'Set Manual Context'}
                          {manualHistory && <span className="bg-green-500 w-2 h-2 rounded-full animate-pulse"></span>}
                       </button>

                       <button onClick={() => fileInputRef.current?.click()} className={`w-full text-xs py-2 rounded flex justify-center items-center gap-2 border transition-colors ${importedHistory ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                          <Upload className="w-3 h-3" /> 
                          <span className="truncate max-w-[120px]">{importedHistory ? `CSV: ${importedHistory.sourceName}` : 'Import Previous CSV'}</span>
                          {importedHistory && <X className="w-3 h-3 hover:text-red-500 ml-1" onClick={(e) => { e.stopPropagation(); setImportedHistory(null); }} />}
                       </button>
                   </div>

                   <button onClick={handleGenerate} className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700 font-bold shadow-md shadow-blue-200 transition">Generate Schedule</button>
                   {lockedDaysForGen && (
                     <div className="text-[11px] text-blue-600 mt-2 flex items-center gap-1.5 bg-blue-50 rounded p-2 border border-blue-100">
                        <Lock className="w-3 h-3 shrink-0" /> {Object.keys(lockedDaysForGen).length} locked day(s) will be kept as-is
                     </div>
                   )}
                </div>
                <div className="bg-white p-4 rounded-xl shadow border border-gray-100">
                   <h3 className="font-bold mb-4 flex gap-2 items-center"><History className="text-gray-500 w-4 h-4"/> Versions</h3>
                   <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                      {versions.map(v => (
                        <div key={v.id} onClick={()=>setSelectedVersionId(v.id)} className={`p-3 rounded-lg cursor-pointer border relative group transition-all ${selectedVersionId===v.id?'bg-blue-50 border-blue-200 translate-x-1':'bg-gray-50 border-transparent hover:bg-gray-100'}`}>
                           <div className="text-sm font-medium">{v.name}</div>
                           <div className="text-[10px] text-gray-400">{new Date(v.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                           <button onClick={(e)=>{e.stopPropagation(); setVersions(p=>p.filter(ver=>ver.id!==v.id))}} className="absolute top-3 right-2 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 transition"><Trash2 className="w-3 h-3"/></button>
                        </div>
                      ))}
                      {versions.length===0 && <div className="text-center text-xs text-gray-400 py-4">No versions generated yet</div>}
                   </div>
                </div>
             </div>
             <div className="lg:col-span-9">
                {currentVersion ? <ScheduleViewer version={currentVersion} employees={employees} config={config} onManualUpdate={handleManualAssign} onManualRemove={handleManualRemove} onToggleLock={handleToggleLock} /> : (
                  <div className="flex flex-col items-center justify-center p-12 bg-white rounded-xl border border-dashed border-gray-300 h-96">
                    <Calendar className="w-12 h-12 text-blue-200 mb-4 animate-bounce"/>
                    <h3 className="text-gray-900 font-medium">Ready to Schedule</h3>
                    <p className="text-gray-500 text-sm mt-1">Configure workers and click Generate</p>
                  </div>
                )}
             </div>
          </div>
        )}
      </main>
      <ManualHistoryModal isOpen={historyModalOpen} onClose={() => setHistoryModalOpen(false)} year={genYear} month={genMonth} employees={employees} onSave={setManualHistory} />
    </div>
  );
};

export default App;
