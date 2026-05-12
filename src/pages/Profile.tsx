import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  UserCircle,
  Mail,
  Phone,
  BookOpen,
  GraduationCap,
  Briefcase,
  Calendar,
  Shield,
  ChevronLeft,
  Edit2,
  CheckCircle,
  Clock
} from 'lucide-react';
import { User } from '../types';
import { auth, db, doc, getDoc } from '../firebase';
import AttendanceBox from '../components/AttendanceBox';

interface ProfileProps {
  user: User | null;
}

export default function Profile({ user }: ProfileProps) {
  const [profile, setProfile] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(auth.currentUser);

  useEffect(() => {
    const fetchProfile = async () => {
      if (!currentUser) return;
      
      try {
        const userDocRef = doc(db, 'users', currentUser.uid);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const userData = userDoc.data() as User;
          setProfile({ ...userData, id: currentUser.uid });
        }
      } catch (err) {
        console.error('Failed to fetch profile:', err);
      }
      setLoading(false);
    };

    fetchProfile();
  }, [currentUser]);

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-orange-600 mx-auto mb-4"></div>
          <p className="text-slate-500">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[60vh]">
        <div className="text-center text-slate-500">
          <UserCircle size={48} className="mx-auto mb-4 opacity-50" />
          <p>Unable to load profile information.</p>
        </div>
      </div>
    );
  }

  // Helper to get role badge color
  const getRoleBadgeColor = (role: string) => {
    switch (role) {
      case 'admin':
        return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'staff':
        return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'student':
        return 'bg-emerald-100 text-emerald-700 border-emerald-200';
      default:
        return 'bg-slate-100 text-slate-700 border-slate-200';
    }
  };

  // Helper to get role icon
  const getRoleIcon = (role: string) => {
    switch (role) {
      case 'admin':
        return <Shield size={18} />;
      case 'staff':
        return <Briefcase size={18} />;
      case 'student':
        return <GraduationCap size={18} />;
      default:
        return <UserCircle size={18} />;
    }
  };

  // Format date
  const formatDate = (date: any) => {
    if (!date) return 'N/A';
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString('en-US', { 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-2xl shadow-lg border border-slate-100 overflow-hidden"
      >
        {/* Header Banner */}
        <div className="bg-gradient-to-r from-orange-600 to-orange-500 p-8 relative">
          <div className="absolute top-4 right-4">
            <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-semibold border capitalize ${getRoleBadgeColor(profile.role || 'student')}`}>
              {getRoleIcon(profile.role || 'student')}
              {profile.role || 'student'}
            </span>
          </div>
        </div>

        {/* Profile Avatar */}
        <div className="px-8 -mt-16 relative z-10">
          <div className="w-32 h-32 bg-white rounded-2xl shadow-lg border-4 border-white flex items-center justify-center">
            <div className="w-28 h-28 bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl flex items-center justify-center">
              <span className="text-5xl font-bold text-white">
                {profile.name ? profile.name.charAt(0).toUpperCase() : 'U'}
              </span>
            </div>
          </div>
        </div>

        {/* Profile Content */}
        <div className="p-8 pt-4">
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-slate-900">{profile.name || 'User'}</h1>
            <p className="text-slate-500 mt-1 capitalize">{profile.role} Account</p>
          </div>

          {/* Info Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Basic Info Card */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                <UserCircle size={20} className="text-orange-600" />
                Personal Information
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <Mail size={18} className="text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Email Address</p>
                    <p className="text-slate-700 font-medium">{profile.email || 'Not provided'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Phone size={18} className="text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Phone Number</p>
                    <p className="text-slate-700 font-medium">{profile.phone || 'Not provided'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Account Info Card */}
            <div className="bg-slate-50 rounded-2xl p-6 border border-slate-100">
              <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                <Shield size={20} className="text-orange-600" />
                Account Details
              </h2>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <CheckCircle size={18} className="text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Account Status</p>
                    <p className="text-emerald-600 font-medium flex items-center gap-1">
                      <span className="w-2 h-2 bg-emerald-500 rounded-full"></span>
                      Active
                    </p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <Calendar size={18} className="text-slate-400 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">User ID</p>
                    <p className="text-slate-700 font-mono text-sm">{profile.id || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Staff-specific Info */}
            {profile.role === 'staff' && (
              <>
                <div className="bg-blue-50 rounded-2xl p-6 border border-blue-100">
                  <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <Briefcase size={20} className="text-blue-600" />
                    Staff Details
                  </h2>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <BookOpen size={18} className="text-slate-400 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Department</p>
                        <p className="text-slate-700 font-medium">{profile.department || 'Not assigned'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <BookOpen size={18} className="text-slate-400 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Subject</p>
                        <p className="text-slate-700 font-medium">{profile.subject || 'Not assigned'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Student-specific Info */}
            {profile.role === 'student' && (
              <>
                <div className="bg-emerald-50 rounded-2xl p-6 border border-emerald-100">
                  <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                    <GraduationCap size={20} className="text-emerald-600" />
                    Student Details
                  </h2>
                  <div className="space-y-4">
                    <div className="flex items-start gap-3">
                      <BookOpen size={18} className="text-slate-400 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Course</p>
                        <p className="text-slate-700 font-medium">{profile.course || 'Not assigned'}</p>
                      </div>
                    </div>
                    <div className="flex items-start gap-3">
                      <Clock size={18} className="text-slate-400 mt-0.5" />
                      <div>
                        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Year</p>
                        <p className="text-slate-700 font-medium">{profile.year || 'Not assigned'}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2">
                  <AttendanceBox studentId={profile.id} />
                </div>
              </>
            )}

            {/* Admin-specific Info */}
            {profile.role === 'admin' && (
              <div className="bg-purple-50 rounded-2xl p-6 border border-purple-100">
                <h2 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                  <Shield size={20} className="text-purple-600" />
                  Admin Privileges
                </h2>
                <div className="space-y-3">
                  <p className="text-slate-700">
                    As an administrator, you have access to:
                  </p>
                  <ul className="space-y-2 text-sm text-slate-600">
                    <li className="flex items-center gap-2">
                      <CheckCircle size={14} className="text-purple-500" />
                      Manage staff accounts
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle size={14} className="text-purple-500" />
                      Manage student accounts
                    </li>
                    <li className="flex items-center gap-2">
                      <CheckCircle size={14} className="text-purple-500" />
                      View analytics
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </div>

          {/* Last Updated */}
          <div className="mt-8 pt-6 border-t border-slate-100">
            <p className="text-xs text-slate-400 text-center">
              Profile information last updated: {formatDate(profile.updated_at)}
            </p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
