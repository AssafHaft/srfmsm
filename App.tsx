
import React, { useState, useMemo, useRef } from 'react';
import { 
  Users, Calendar, Settings, History, Plus, Trash2, Download, 
  CheckCircle, AlertCircle, FileSpreadsheet, Upload, Edit2, X, ChevronLeft, ChevronRight, Info
} from 'lucide-react';
import { 
  Employee, ShiftConfig, ScheduleVersion, WorkerPreference, 
  ShiftType, HistoricalContext, ManualHistoryInput
} from './types';
import { generateSchedule, exportToCSV, exportToExcel, getDaysInMonth, formatDateKey, parsePastScheduleCSV, getFullWeeksRange } from './services/scheduler';

// --- Manual History Modal ---
const ManualHistoryModal: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  year: number;
  month: number;
  employees: Employee[];
  onSave: (data: ManualHistoryInput) => void;
}> = ({ isOpen, onClose, year, month, employees, onSave }) => {
  if (!isOpen) return null;

  // Calculate the 14-day range: 7 days BEFORE the grid starts, and the first 7 days OF the grid
  const gridDays = getFullWeeksRange(year, month);
  const gridStart = gridDays[0];
  
  const contextDates: Date[] = []; // -7 to -1
  const scheduleDates: Date[] = []; // 0 to 6
  
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

  const [inputData, setInputData] = useState<ManualHistoryInput>({});

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
                       <li><strong>Previous Context (Week 1):</strong> Hidden days used only to calculate constraints (like "No Day after Night" or fatigue).</li>
                       <li><strong>Schedule Start (Week 2):</strong> First visible week of the new grid. Set this to "Freeze" the end of the previous month's schedule exactly as it was.</li>
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
  const [newTargetShifts, setNewTargetShifts] = useState<string>('');

  const resetForm = () => {
    setNewName('');
    setNewPref(WorkerPreference.EITHER);
    setNewDaysOff([]);
    setNewTargetShifts('');
    setEditingId(null);
    setIsAdding(false);
  };

  const startAdding = () => { resetForm(); setIsAdding(true); };
  const startEditing = (e: Employee) => {
    setNewName(e.name);
    setNewPref(e.preference);
    setNewDaysOff(e.availability.daysOff);
    setNewTargetShifts(e.targetShifts ? e.targetShifts.toString() : '');
    setEditingId(e.id);
    setIsAdding(true);
  };

  const handleSave = () => {
    if (!newName.trim()) return;
    const targetShifts = newTargetShifts ? parseInt(newTargetShifts) : undefined;
    if (editingId) {
      onUpdate({
        id: editingId, name: newName, preference: newPref, availability: { daysOff: newDaysOff }, targetShifts,
        color: employees.find(e => e.id === editingId)?.color || '#fff'
      });
    } else {
      onAdd({
        id: crypto.randomUUID(), name: newName, preference: newPref, availability: { daysOff: newDaysOff }, targetShifts,
        color: `hsl(${Math.floor(Math.random() * 360)}, 70%, 80%)`
      });
    }
    resetForm();
  };

  const toggleDayOff = (dayIndex: number) => {
    setNewDaysOff(prev => prev.includes(dayIndex) ? prev.filter(d => d !== dayIndex) : [...prev, dayIndex]);
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
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
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
          </div>
          <div className="mb-4">
             <label className="block text-sm font-medium mb-2">Unavailable Days</label>
             <div className="flex gap-2 flex-wrap">{days.map((d, i) => <button key={d} onClick={() => toggleDayOff(i)} className={`px-3 py-1 rounded-full text-sm border ${newDaysOff.includes(i) ? 'bg-red-100 text-red-700 border-red-200' : 'bg-white text-gray-600 border-gray-200'}`}>{d}</button>)}</div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="text-gray-500 hover:text-gray-700 px-4 py-2">Cancel</button>
            <button onClick={handleSave} className="bg-blue-600 text-white px-4 py-2 rounded-lg">{editingId ? 'Save' : 'Add'}</button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {employees.map(e => (
          <div key={e.id} className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border hover:border-blue-200 transition">
            <div>
              <div className="font-semibold text-gray-900 flex gap-2 items-center">{e.name} {e.targetShifts && <span className="text-[10px] bg-green-100 text-green-700 px-1 rounded">Target: {e.targetShifts}</span>}</div>
              <div className="text-xs text-gray-500 mt-1 flex gap-2">
                <span className={`px-2 py-0.5 rounded ${e.preference === WorkerPreference.DAY_ONLY ? 'bg-amber-100 text-amber-700' : e.preference === WorkerPreference.NIGHT_ONLY ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-200'}`}>{e.preference}</span>
                {e.availability.daysOff.length > 0 && <span className="text-red-500">Off: {e.availability.daysOff.map(d => days[d]).join(', ')}</span>}
              </div>
            </div>
            <div className="flex gap-1">
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
  return (
    <div className="p-6 bg-white rounded-xl shadow-sm border border-gray-100">
      <h2 className="text-xl font-bold text-gray-800 mb-6 flex items-center gap-2"><Settings className="w-5 h-5 text-blue-600" /> Shift Rules</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
           <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4">Daily Requirements</h3>
           <div className="space-y-3">
             {days.map((day, idx) => {
               const req = config.requirements[idx] || { day: 1, night: 1 };
               return (
                 <div key={day} className="flex items-center justify-between text-sm">
                    <span className="w-24 font-medium text-gray-700">{day}</span>
                    <div className="flex gap-4">
                      <div className="flex items-center gap-2"><span className="text-amber-600 text-xs font-bold">DAY</span><input type="number" min="0" value={req.day} onChange={e => updateReq(idx, 'day', parseInt(e.target.value))} className="w-12 p-1 border rounded text-center bg-white text-black" /></div>
                      <div className="flex items-center gap-2"><span className="text-indigo-600 text-xs font-bold">NIGHT</span><input type="number" min="0" value={req.night} onChange={e => updateReq(idx, 'night', parseInt(e.target.value))} className="w-12 p-1 border rounded text-center bg-white text-black" /></div>
                    </div>
                 </div>
               );
             })}
           </div>
        </div>
        <div className="space-y-6">
           <div className="bg-gray-50 p-4 rounded-lg">
               <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-2">Timing</h3>
               <div className="grid grid-cols-2 gap-4">
                 <div><label className="text-xs font-bold text-amber-600 block mb-1">Day Start</label><input type="time" value={config.dayStartTime} onChange={e => onUpdate({...config, dayStartTime: e.target.value})} className="w-full p-2 border rounded bg-white text-black" /></div>
                 <div><label className="text-xs font-bold text-indigo-600 block mb-1">Night Start</label><input type="time" value={config.nightStartTime} onChange={e => onUpdate({...config, nightStartTime: e.target.value})} className="w-full p-2 border rounded bg-white text-black" /></div>
               </div>
           </div>
           <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 flex items-start gap-3">
               <button onClick={() => onUpdate({...config, distributeDayShiftsToEither: !config.distributeDayShiftsToEither})} className={`mt-0.5 relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${config.distributeDayShiftsToEither ? 'bg-blue-600' : 'bg-gray-200'}`}><span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${config.distributeDayShiftsToEither ? 'translate-x-6' : 'translate-x-1'}`} /></button>
               <div><span className="block text-sm font-medium text-gray-900">Prioritize "Either" for Day Shifts</span></div>
           </div>
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
}> = ({ version, employees, config, onManualUpdate }) => {
  const [view, setView] = useState<'calendar' | 'stats'>('calendar');
  const [modalOpen, setModalOpen] = useState(false);
  const [manualSlot, setManualSlot] = useState<{ date: string, shift: ShiftType } | null>(null);
  
  const getEmp = (id: string) => employees.find(e => e.id === id);
  const openManualAssign = (date: string, shift: ShiftType) => { setManualSlot({ date, shift }); setModalOpen(true); };

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
             </div>
             <button onClick={() => exportToCSV(version, employees)} className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-700"><Download className="w-4 h-4" /> CSV</button>
             <button onClick={() => exportToExcel(version, employees)} className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-emerald-700"><FileSpreadsheet className="w-4 h-4" /> Excel</button>
          </div>
       </div>

       {view === 'calendar' ? (
         <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="grid grid-cols-7 bg-gray-50 border-b text-center py-2 text-xs font-bold text-gray-500 uppercase">
               {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 auto-rows-fr bg-gray-200 gap-px">
               {version.schedule.map((daySch) => {
                 const dateObj = new Date(daySch.date);
                 const req = config.requirements[dateObj.getDay()] || { day: 1, night: 1 };
                 const missingDay = req.day - daySch.dayShift.length;
                 const missingNight = req.night - daySch.nightShift.length;

                 return (
                   <div key={daySch.date} className={`min-h-[120px] p-2 flex flex-col gap-1 ${daySch.isPadding ? 'bg-gray-100' : 'bg-white'}`}>
                      <div className={`text-right text-sm font-bold mb-1 ${daySch.isPadding ? 'text-gray-300' : 'text-gray-500'}`}>{dateObj.getDate()}</div>
                      
                      {/* Day Shift */}
                      <div className="bg-amber-50 rounded p-1 border border-amber-100">
                         <div className="text-[10px] font-bold text-amber-600 uppercase mb-1">Day</div>
                         <div className="space-y-1">
                           {daySch.dayShift.map(id => (
                             <div key={id} className={`text-xs px-1.5 py-0.5 rounded shadow-sm text-gray-700 truncate ${daySch.isPadding ? 'bg-gray-200 opacity-60' : 'bg-white'}`}>{getEmp(id)?.name}</div>
                           ))}
                           {!daySch.isPadding && missingDay > 0 && Array.from({length: missingDay}).map((_, i) => (
                               <button key={i} onClick={() => openManualAssign(daySch.date, ShiftType.DAY)} className="w-full text-left text-xs px-1.5 py-1 bg-red-100 text-red-700 rounded flex items-center gap-1 hover:bg-red-200"><AlertCircle className="w-3 h-3" /> Empty</button>
                           ))}
                         </div>
                      </div>
                      {/* Night Shift */}
                      <div className="bg-indigo-50 rounded p-1 border border-indigo-100 mt-auto">
                         <div className="text-[10px] font-bold text-indigo-600 uppercase mb-1">Night</div>
                         <div className="space-y-1">
                           {daySch.nightShift.map(id => (
                             <div key={id} className={`text-xs px-1.5 py-0.5 rounded shadow-sm text-white truncate ${daySch.isPadding ? 'bg-indigo-300 opacity-60' : 'bg-indigo-700'}`}>{getEmp(id)?.name}</div>
                           ))}
                           {!daySch.isPadding && missingNight > 0 && Array.from({length: missingNight}).map((_, i) => (
                               <button key={i} onClick={() => openManualAssign(daySch.date, ShiftType.NIGHT)} className="w-full text-left text-xs px-1.5 py-1 bg-red-100 text-red-700 rounded flex items-center gap-1 hover:bg-red-200"><AlertCircle className="w-3 h-3" /> Empty</button>
                           ))}
                         </div>
                      </div>
                   </div>
                 );
               })}
            </div>
         </div>
       ) : (
         <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden p-6">
            <h3 className="font-bold text-gray-800 mb-4">Analysis (Target Month Only)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                 <thead className="bg-gray-50 text-gray-500 font-medium">
                    <tr>
                      <th className="px-4 py-3">Employee</th>
                      <th className="px-4 py-3 text-center">Day</th>
                      <th className="px-4 py-3 text-center">Night</th>
                      <th className="px-4 py-3 text-center">Total</th>
                      <th className="px-4 py-3 text-center">Target</th>
                    </tr>
                 </thead>
                 <tbody className="divide-y divide-gray-100">
                    {employees.map(emp => {
                       const stats = version.stats[emp.id] || { dayShifts: 0, nightShifts: 0, totalShifts: 0, longestStreak: 0 };
                       return (
                         <tr key={emp.id} className="hover:bg-gray-50">
                           <td className="px-4 py-3 font-medium text-gray-900">{emp.name}</td>
                           <td className="px-4 py-3 text-center font-medium text-gray-900">{stats.dayShifts}</td>
                           <td className="px-4 py-3 text-center font-medium text-gray-900">{stats.nightShifts}</td>
                           <td className="px-4 py-3 text-center font-bold bg-gray-50 text-gray-900">{stats.totalShifts}</td>
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
                 {employees.map(e => (
                   <button key={e.id} onClick={() => { onManualUpdate(manualSlot.date, manualSlot.shift, e.id); setModalOpen(false); }} className="w-full flex items-center justify-between p-3 rounded-lg border hover:bg-blue-50 text-left">
                     <div><div className="font-medium text-gray-900">{e.name}</div><div className="text-xs text-gray-500">{e.preference}</div></div>
                     {e.targetShifts && <div className="text-xs bg-gray-100 px-2 py-1 rounded">Target: {e.targetShifts}</div>}
                   </button>
                 ))}
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
  const [employees, setEmployees] = useState<Employee[]>([
    { id: '1', name: 'גולן חדד', preference: WorkerPreference.DAY_ONLY, availability: { daysOff: [] }, color: '#fff' },
    { id: '2', name: 'ניצן כפיר', preference: WorkerPreference.EITHER, availability: { daysOff: [] }, color: '#fff' },
    { id: '3', name: 'דן אהרוני', preference: WorkerPreference.EITHER, availability: { daysOff: [] }, color: '#fff' },
    { id: '4', name: 'ענבר כפיר', preference: WorkerPreference.EITHER, availability: { daysOff: [] }, color: '#fff' },
    { id: '5', name: 'רועי נוף', preference: WorkerPreference.EITHER, availability: { daysOff: [] }, color: '#fff' },
    { id: '6', name: 'עומרי חכים', preference: WorkerPreference.EITHER, availability: { daysOff: [] }, color: '#fff' },
  ]);
  const [config, setConfig] = useState<ShiftConfig>({
    dayStartTime: '06:00', dayEndTime: '15:00', nightStartTime: '14:00', nightEndTime: '00:00', distributeDayShiftsToEither: false,
    requirements: { 0: { day: 1, night: 1 }, 1: { day: 2, night: 1 }, 2: { day: 2, night: 1 }, 3: { day: 2, night: 1 }, 4: { day: 2, night: 2 }, 5: { day: 2, night: 2 }, 6: { day: 1, night: 1 } }
  });
  const [versions, setVersions] = useState<ScheduleVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [genMonth, setGenMonth] = useState(new Date().getMonth());
  const [genYear, setGenYear] = useState(new Date().getFullYear());
  const [manualHistory, setManualHistory] = useState<ManualHistoryInput | null>(null);
  const [historyModalOpen, setHistoryModalOpen] = useState(false);
  const [importedHistory, setImportedHistory] = useState<HistoricalContext | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentVersion = useMemo(() => versions.find(v => v.id === selectedVersionId) || versions[0] || null, [versions, selectedVersionId]);
  
  const handleGenerate = () => {
    if (employees.length === 0) { alert("No employees"); return; }
    try {
      const v = generateSchedule(employees, genYear, genMonth, config, importedHistory || undefined, manualHistory || undefined);
      setVersions(p => [v, ...p]); setSelectedVersionId(v.id); setTab('schedule');
    } catch (e) { alert("Generation failed"); console.error(e); }
  };

  const handleManualAssign = (date: string, shift: ShiftType, empId: string) => {
    if (!currentVersion) return;
    const updated = { ...currentVersion, schedule: [...currentVersion.schedule] };
    const idx = updated.schedule.findIndex(s => s.date === date);
    if (idx > -1) {
      const d = { ...updated.schedule[idx] };
      if (shift === ShiftType.DAY) d.dayShift = [...d.dayShift, empId]; else d.nightShift = [...d.nightShift, empId];
      updated.schedule[idx] = d;
      if (!d.isPadding) {
         const st = { ...updated.stats[empId] }; st.totalShifts++; if(shift===ShiftType.DAY) st.dayShifts++; else st.nightShifts++;
         updated.stats = { ...updated.stats, [empId]: st };
      }
      setVersions(p => p.map(v => v.id === updated.id ? updated : v));
    }
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
    // Reset input
    if (e.target) e.target.value = '';
  };

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900">
      <header className="bg-slate-900 text-white p-4 sticky top-0 z-20 shadow-md">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <h1 className="text-xl font-bold flex gap-2 items-center"><Calendar className="text-blue-400"/> ShiftMaster</h1>
          <nav className="flex gap-1 bg-slate-800 p-1 rounded-lg">
             {['workers','rules','schedule'].map(t => <button key={t} onClick={() => setTab(t as any)} className={`px-4 py-2 rounded-md text-sm capitalize ${tab===t?'bg-blue-600 text-white':'text-slate-400 hover:text-white'}`}>{t}</button>)}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto p-4 sm:p-6">
        {tab === 'workers' && <EmployeeManager employees={employees} onAdd={e=>setEmployees([...employees, e])} onRemove={id=>setEmployees(p=>p.filter(e=>e.id!==id))} onUpdate={u=>setEmployees(p=>p.map(e=>e.id===u.id?u:e))} />}
        {tab === 'rules' && <ConfigPanel config={config} onUpdate={setConfig} />}
        {tab === 'schedule' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
             <div className="lg:col-span-3 space-y-6">
                <div className="bg-white p-4 rounded-xl shadow border border-gray-100">
                   <h3 className="font-bold mb-4 flex gap-2"><CheckCircle className="text-blue-600 w-4 h-4"/> Generate</h3>
                   <div className="space-y-3 mb-4">
                      <div><label className="text-xs font-bold text-gray-500 uppercase">Month</label><select value={genMonth} onChange={e=>setGenMonth(parseInt(e.target.value))} className="w-full p-2 border rounded bg-gray-50 text-black">{Array.from({length:12}).map((_,i)=><option key={i} value={i}>{new Date(2000,i,1).toLocaleString('default',{month:'long'})}</option>)}</select></div>
                      <div><label className="text-xs font-bold text-gray-500 uppercase">Year</label><input type="number" value={genYear} onChange={e=>setGenYear(parseInt(e.target.value))} className="w-full p-2 border rounded bg-gray-50 text-black"/></div>
                   </div>
                   
                   <input type="file" ref={fileInputRef} className="hidden" accept=".csv" onChange={handleImportHistory} />
                   
                   <div className="space-y-2 mb-4">
                       <button onClick={() => setHistoryModalOpen(true)} className="w-full text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 py-2 rounded flex justify-center items-center gap-2 border">
                          <History className="w-3 h-3" /> {manualHistory ? 'Edit Manual Context' : 'Set Manual Context'}
                          {manualHistory && <span className="bg-green-500 w-2 h-2 rounded-full"></span>}
                       </button>

                       <button onClick={() => fileInputRef.current?.click()} className={`w-full text-xs py-2 rounded flex justify-center items-center gap-2 border transition-colors ${importedHistory ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}`}>
                          <Upload className="w-3 h-3" /> 
                          <span className="truncate max-w-[120px]">{importedHistory ? `CSV: ${importedHistory.sourceName}` : 'Import Previous CSV'}</span>
                          {importedHistory && <X className="w-3 h-3 hover:text-red-500 ml-1" onClick={(e) => { e.stopPropagation(); setImportedHistory(null); }} />}
                       </button>
                   </div>

                   <button onClick={handleGenerate} className="w-full bg-blue-600 text-white py-2.5 rounded-lg hover:bg-blue-700">Generate Schedule</button>
                </div>
                <div className="bg-white p-4 rounded-xl shadow border border-gray-100">
                   <h3 className="font-bold mb-4 flex gap-2"><History className="text-gray-500 w-4 h-4"/> Versions</h3>
                   <div className="space-y-2 max-h-[300px] overflow-y-auto">
                      {versions.map(v => (
                        <div key={v.id} onClick={()=>setSelectedVersionId(v.id)} className={`p-3 rounded-lg cursor-pointer border relative group ${selectedVersionId===v.id?'bg-blue-50 border-blue-200':'bg-gray-50 border-transparent hover:bg-gray-100'}`}>
                           <div className="text-sm font-medium">{v.name}</div>
                           <button onClick={(e)=>{e.stopPropagation(); setVersions(p=>p.filter(ver=>ver.id!==v.id))}} className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500"><Trash2 className="w-3 h-3"/></button>
                        </div>
                      ))}
                      {versions.length===0 && <div className="text-center text-xs text-gray-400">No versions yet</div>}
                   </div>
                </div>
             </div>
             <div className="lg:col-span-9">
                {currentVersion ? <ScheduleViewer version={currentVersion} employees={employees} config={config} onManualUpdate={handleManualAssign} /> : (
                  <div className="flex flex-col items-center justify-center p-12 bg-white rounded-xl border border-dashed border-gray-300 h-96">
                    <Calendar className="w-12 h-12 text-blue-200 mb-4"/>
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
