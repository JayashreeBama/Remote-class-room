import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Calendar, Check, X, AlertCircle } from 'lucide-react';
import { Attendance, AttendanceSummary } from '../types';
import { auth } from '../firebase';

interface AttendanceBoxProps {
  studentId: string;
}

export default function AttendanceBox({ studentId }: AttendanceBoxProps) {
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [summary, setSummary] = useState<AttendanceSummary>({ total_present: 0, total_absent: 0, total_days: 0 });
  const [loading, setLoading] = useState(true);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [selectedStatus, setSelectedStatus] = useState<'present' | 'absent' | ''>('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchAttendance();
  }, []);

  const getHeaders = async () => {
    const token = auth.currentUser ? await auth.currentUser.getIdToken() : null;
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  };

  const fetchAttendance = async () => {
    try {
      setLoading(true);
      const headers = await getHeaders();

      const [attRes, sumRes] = await Promise.all([
        fetch('/api/student/attendance', { headers }),
        fetch('/api/student/attendance/summary', { headers }),
      ]);

      if (!attRes.ok || !sumRes.ok) throw new Error('Failed to fetch attendance');

      const attData = await attRes.json();
      const sumData = await sumRes.json();

      setAttendance(attData);
      setSummary(sumData);
    } catch (err) {
      console.error('Failed to fetch attendance:', err);
      setMessage({ type: 'error', text: 'Failed to load attendance data' });
    } finally {
      setLoading(false);
    }
  };

  const handleSaveAttendance = async () => {
    if (!selectedDate || !selectedStatus) {
      setMessage({ type: 'error', text: 'Please select both date and status' });
      return;
    }

    try {
      setSaving(true);
      const headers = await getHeaders();

      const res = await fetch('/api/student/attendance', {
        method: 'POST',
        headers,
        body: JSON.stringify({ date: selectedDate, status: selectedStatus }),
      });

      if (!res.ok) throw new Error('Failed to save attendance');

      setMessage({ type: 'success', text: 'Attendance saved successfully!' });
      await fetchAttendance();
      setSelectedDate(new Date().toISOString().split('T')[0]);
      setSelectedStatus('');

      setTimeout(() => setMessage(null), 3000);
    } catch (err) {
      console.error('Failed to save attendance:', err);
      setMessage({ type: 'error', text: 'Failed to save attendance' });
    } finally {
      setSaving(false);
    }
  };

  const getAttendanceStatus = (date: string): 'present' | 'absent' | null => {
    const record = attendance.find(a => a.date === date);
    return record ? record.status : null;
  };

  const getDaysInMonth = () => {
    const today = new Date();
    return new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  };

  const generateCalendarDays = () => {
    const today = new Date();
    const daysInMonth = getDaysInMonth();
    const days = [];

    for (let i = 1; i <= daysInMonth; i++) {
      const date = new Date(today.getFullYear(), today.getMonth(), i);
      const dateStr = date.toISOString().split('T')[0];
      const status = getAttendanceStatus(dateStr);
      days.push({ dateStr, day: i, status, isToday: dateStr === new Date().toISOString().split('T')[0] });
    }
    return days;
  };

  if (loading) {
    return (
      <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
        <div className="flex items-center gap-2 mb-4">
          <Calendar size={20} className="text-blue-600" />
          <h2 className="text-lg font-bold text-slate-900">Attendance</h2>
        </div>
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-blue-200 rounded w-1/2"></div>
          <div className="h-4 bg-blue-200 rounded w-3/4"></div>
        </div>
      </div>
    );
  }

  const calendarDays = generateCalendarDays();
  const currentMonth = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.2 }}
      className="bg-blue-50 rounded-2xl p-6 border border-blue-100"
    >
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2 mb-2">
          <Calendar size={20} className="text-blue-600" />
          Monthly Attendance - {currentMonth}
        </h2>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <div className="bg-white rounded-lg p-3 border border-blue-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Present Days</p>
          <p className="text-2xl font-bold text-emerald-600">{summary.total_present}</p>
        </div>
        <div className="bg-white rounded-lg p-3 border border-blue-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Absent Days</p>
          <p className="text-2xl font-bold text-red-600">{summary.total_absent}</p>
        </div>
        <div className="bg-white rounded-lg p-3 border border-blue-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Days</p>
          <p className="text-2xl font-bold text-blue-600">{summary.total_days}</p>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="mb-6">
        <div className="bg-white rounded-lg p-4 border border-blue-100">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Current Month View</p>
          <div className="grid grid-cols-7 gap-2 mb-4">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
              <div key={day} className="text-center text-xs font-semibold text-slate-500 h-8 flex items-center justify-center">
                {day}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {calendarDays.map(({ dateStr, day, status, isToday }) => (
              <button
                key={dateStr}
                onClick={() => setSelectedDate(dateStr)}
                className={`h-8 rounded text-xs font-semibold transition-all ${
                  isToday ? 'ring-2 ring-blue-500' : ''
                } ${
                  status === 'present'
                    ? 'bg-emerald-100 text-emerald-700'
                    : status === 'absent'
                      ? 'bg-red-100 text-red-700'
                      : selectedDate === dateStr
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                <span className="flex items-center justify-center h-full">
                  {status === 'present' ? <Check size={14} /> : status === 'absent' ? <X size={14} /> : day}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Input Section */}
      <div className="bg-white rounded-lg p-4 border border-blue-100 space-y-4">
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Mark Attendance</p>

        <div className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Select Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Attendance Status</label>
            <div className="flex gap-3">
              <button
                onClick={() => setSelectedStatus('present')}
                className={`flex-1 py-2 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                  selectedStatus === 'present'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <Check size={16} />
                Present
              </button>
              <button
                onClick={() => setSelectedStatus('absent')}
                className={`flex-1 py-2 px-3 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
                  selectedStatus === 'absent'
                    ? 'bg-red-500 text-white'
                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                }`}
              >
                <X size={16} />
                Absent
              </button>
            </div>
          </div>

          {message && (
            <div
              className={`p-3 rounded-lg flex items-center gap-2 text-sm font-semibold ${
                message.type === 'success'
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                  : 'bg-red-50 text-red-700 border border-red-200'
              }`}
            >
              {message.type === 'error' ? <AlertCircle size={16} /> : <Check size={16} />}
              {message.text}
            </div>
          )}

          <button
            onClick={handleSaveAttendance}
            disabled={saving || !selectedStatus}
            className={`w-full py-2 px-4 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 ${
              saving || !selectedStatus
                ? 'bg-slate-300 text-slate-500 cursor-not-allowed'
                : 'bg-blue-600 text-white hover:bg-blue-700 active:scale-95'
            }`}
          >
            {saving ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                Saving...
              </>
            ) : (
              <>
                <Check size={16} />
                Save Attendance
              </>
            )}
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="mt-4 flex gap-4 text-xs">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-emerald-100 border border-emerald-300 flex items-center justify-center">
            <Check size={10} className="text-emerald-600" />
          </div>
          <span className="text-slate-600">Present</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-red-100 border border-red-300 flex items-center justify-center">
            <X size={10} className="text-red-600" />
          </div>
          <span className="text-slate-600">Absent</span>
        </div>
      </div>
    </motion.div>
  );
}
