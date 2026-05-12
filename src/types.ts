export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'staff' | 'student';
  department?: string;
  subject?: string;
  phone?: string;
  course?: string;
  year?: string;
  updated_at?: any;
}

export interface Material {
  id: number;
  staff_id: string;
  department?: string;
  subject: string;
  topic: string;
  description: string;
  file_path: string;
  resource_type: string;
  upload_date: string;
}

export interface Question {
  id: number;
  subject: string;
  topic: string;
  question_text: string;
  option_a: string;
  option_b: string;
  option_c: string;
  option_d: string;
  correct_answer?: string;
}

export interface Progress {
  student_name?: string;
  subject?: string;
  topic: string;
  score: number;
  timestamp?: string;
  status?: string;
}

export interface Notification {
  id: number;
  department?: string;
  type: string;
  title: string;
  message: string;
  staff_id?: string;
  created_at?: string;
  is_read?: number;
}

export interface Attendance {
  id: number;
  student_id: string;
  date: string;
  status: 'present' | 'absent';
  year_month: string;
  created_at: string;
  updated_at: string;
}

export interface AttendanceSummary {
  total_present: number;
  total_absent: number;
  total_days: number;
}
