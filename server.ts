import 'dotenv/config';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import multer from 'multer';
import cors from 'cors';
import fs from 'fs';
import JSZip from 'jszip';
import { GoogleGenAI } from '@google/genai';
import admin from 'firebase-admin';
import firebaseConfig from './firebase-applet-config.json' with { type: 'json' };
import serviceAccount from './class-room-a05da-firebase-adminsdk-fbsvc-d78f73661e.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin with service account credentials
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount as any),
  projectId: firebaseConfig.projectId,
});

const db = new Database('database.db');
const gemini = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;

// Initialize Database (SQLite for materials, questions, progress)
db.exec(`
  CREATE TABLE IF NOT EXISTS materials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT,
    department TEXT,
    subject TEXT,
    topic TEXT,
    description TEXT,
    file_path TEXT,
    resource_type TEXT,
    upload_date DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS questions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT,
    subject TEXT,
    topic TEXT,
    question_text TEXT,
    option_a TEXT,
    option_b TEXT,
    option_c TEXT,
    option_d TEXT,
    correct_answer TEXT
  );

  CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT,
    question_id INTEGER,
    selected_answer TEXT,
    score INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(question_id) REFERENCES questions(id)
  );

  CREATE TABLE IF NOT EXISTS material_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT,
    material_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(material_id) REFERENCES materials(id)
  );

  CREATE TABLE IF NOT EXISTS attempt_results (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    staff_id TEXT,
    student_id TEXT,
    student_name TEXT,
    course_subject TEXT,
    attempt_id TEXT,
    total_questions INTEGER,
    correct_answers INTEGER,
    wrong_answers INTEGER,
    percentage REAL,
    status TEXT,
    answers_json TEXT,
    submitted_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT,
    email TEXT,
    role TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department TEXT,
    type TEXT,
    title TEXT,
    message TEXT,
    staff_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_read INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT,
    date TEXT,
    status TEXT,
    year_month TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(student_id, date)
  );
`);

// Lightweight schema migration for existing local databases.
const materialColumns = db.prepare("PRAGMA table_info(materials)").all() as Array<{ name: string }>;
if (!materialColumns.some((c) => c.name === 'department')) {
  db.exec('ALTER TABLE materials ADD COLUMN department TEXT');
}

// Ensure progress has attempt_id column for grouping attempts
const progressColumns = db.prepare("PRAGMA table_info(progress)").all() as Array<{ name: string }>;
if (!progressColumns.some((c) => c.name === 'attempt_id')) {
  try {
    db.exec("ALTER TABLE progress ADD COLUMN attempt_id TEXT");
  } catch (e) {
    // ignore if unable to alter (older sqlite may fail)
  }
}

// Ensure questions has subject for course identification
const questionColumns = db.prepare("PRAGMA table_info(questions)").all() as Array<{ name: string }>;
if (!questionColumns.some((c) => c.name === 'subject')) {
  try {
    db.exec("ALTER TABLE questions ADD COLUMN subject TEXT");
  } catch (e) {
    // ignore
  }
}
 
// Add student_name column to attempt_results if missing
const attemptResultsColumns = db.prepare("PRAGMA table_info(attempt_results)").all() as Array<{ name: string }>;
if (!attemptResultsColumns.some((c) => c.name === 'student_name')) {
  try {
    db.exec("ALTER TABLE attempt_results ADD COLUMN student_name TEXT");
  } catch (e) {
    // ignores
  }
}

// Ensure upload directories exist
const uploadDirs = ['public/uploads', 'public/uploads/videos', 'public/uploads/images', 'public/uploads/docs', 'public/uploads/zips'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let dest = 'public/uploads/docs';
    if (file.mimetype.startsWith('image/')) dest = 'public/uploads/images';
    else if (file.mimetype.startsWith('video/')) dest = 'public/uploads/videos';
    else if (file.originalname.endsWith('.zip')) dest = 'public/uploads/zips';
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage });

async function convertExistingMaterialsToZip() {
  const rows = db.prepare(`
    SELECT id, file_path, resource_type
    FROM materials
    WHERE file_path LIKE '/uploads/%'
      AND (resource_type IS NULL OR (LOWER(resource_type) != 'zip' AND LOWER(resource_type) != 'ai_generated'))
  `).all() as Array<{ id: number; file_path: string; resource_type: string | null }>;

  for (const row of rows) {
    try {
      const filePath = String(row.file_path || '');
      const absolutePath = path.resolve('public', filePath.replace(/^\//, ''));
      if (!fs.existsSync(absolutePath)) continue;

      const fileBuffer = await fs.promises.readFile(absolutePath);
      const originalName = path.basename(absolutePath);

      const zip = new JSZip();
      zip.file(originalName, fileBuffer);

      const zipFileName = `${Date.now()}-material-${row.id}.zip`;
      const zipAbsolutePath = path.resolve('public', 'uploads', 'zips', zipFileName);
      const zipBuffer = await zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE',
        compressionOptions: { level: 9 },
      });

      await fs.promises.writeFile(zipAbsolutePath, zipBuffer);
      await fs.promises.unlink(absolutePath).catch(() => undefined);

      db.prepare('UPDATE materials SET file_path = ?, resource_type = ? WHERE id = ?').run(
        `/uploads/zips/${zipFileName}`,
        'zip',
        row.id
      );
    } catch (error) {
      console.warn(`Skipping ZIP conversion for material ${row.id}:`, error);
    }
  }
}

async function restoreAiGeneratedMaterialsFromZip() {
  const rows = db.prepare(`
    SELECT id, file_path, resource_type
    FROM materials
    WHERE LOWER(resource_type) = 'zip'
      AND file_path LIKE '/uploads/zips/%'
  `).all() as Array<{ id: number; file_path: string; resource_type: string | null }>;

  for (const row of rows) {
    try {
      const filePath = String(row.file_path || '');
      const absolutePath = path.resolve('public', filePath.replace(/^\//, ''));
      if (!fs.existsSync(absolutePath)) continue;

      const zipBuffer = await fs.promises.readFile(absolutePath);
      const zip = await JSZip.loadAsync(zipBuffer);
      const jsonEntryName = Object.keys(zip.files).find((name) => name.toLowerCase().endsWith('.json'));
      if (!jsonEntryName) continue;

      const jsonText = await zip.files[jsonEntryName].async('string');
      let parsed: any;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        continue;
      }

      const looksLikeAiPlan =
        typeof parsed?.objective === 'string' ||
        typeof parsed?.studyGuide === 'string' ||
        Array.isArray(parsed?.resources?.youtube) ||
        Array.isArray(parsed?.resources?.websites);
      if (!looksLikeAiPlan) continue;

      const restoredName = `${Date.now()}-ai-material-${row.id}.json`;
      const restoredAbsolutePath = path.resolve('public', 'uploads', 'docs', restoredName);
      await fs.promises.writeFile(restoredAbsolutePath, jsonText, 'utf-8');

      db.prepare('UPDATE materials SET file_path = ?, resource_type = ? WHERE id = ?').run(
        `/uploads/docs/${restoredName}`,
        'AI_GENERATED',
        row.id
      );
    } catch (error) {
      console.warn(`Skipping AI restore for material ${row.id}:`, error);
    }
  }
}

async function startServer() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/uploads', express.static('public/uploads'));

  await restoreAiGeneratedMaterialsFromZip();
  await convertExistingMaterialsToZip();

  // Auth Middleware using Firebase Admin
  // Uses Firestore REST API instead of admin.firestore() to avoid needing
  // Application Default Credentials / a service account key locally.
  const authenticateToken = async (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token) return res.sendStatus(401);

    try {
      // verifyIdToken only uses public keys — no ADC needed
      const decodedToken = await admin.auth().verifyIdToken(token);

      // Fetch role via Firestore REST API using the user's own Bearer token
      let role: string | undefined;
      let name: string | undefined;
      let department: string | undefined;
      let course: string | undefined;
      try {
        const fsRes = await fetch(
          `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${decodedToken.uid}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (fsRes.ok) {
          const data = await fsRes.json();
          role = data.fields?.role?.stringValue;
          name = data.fields?.name?.stringValue;
          department = data.fields?.department?.stringValue;
          course = data.fields?.course?.stringValue;
        }
      } catch (_) { /* fall through to email fallback */ }

      // Fallback: recognise admin@gmail.com before its Firestore doc is created
      if (!role && decodedToken.email === 'admin@gmail.com') {
        role = 'admin';
        name = 'Admin';
      }

      if (!role) {
        return res.status(403).json({ message: 'User profile not found' });
      }

      req.user = {
        id: decodedToken.uid,
        email: decodedToken.email,
        role,
        name: name || decodedToken.email,
        department,
        course,
        token, // forwarded to admin routes that need Firestore REST API access
      };
      next();
    } catch (error) {
      console.error('Auth Error:', error);
      res.sendStatus(403);
    }
  };

  // Helper function to get student name from local users table or Firestore
  // Uses Admin SDK (has full access) instead of REST API (which has permission restrictions)
  // If name not found, returns student_id as fallback
  const getStudentName = async (studentId: string, bearerToken?: string): Promise<string> => {
    try {
      // Check local users table first (fastest)
      const localUser = db.prepare('SELECT name FROM users WHERE id = ?').get(studentId) as any;
      if (localUser?.name && localUser.name.trim()) {
        console.log(`[getStudentName] Found ${studentId} in local cache: ${localUser.name}`);
        return localUser.name;
      }

      // Use Firestore Admin SDK (most reliable - has full access regardless of security rules)
      console.log(`[getStudentName] Fetching ${studentId} from Firestore Admin SDK...`);
      try {
        const userDoc = await admin.firestore().collection('users').doc(studentId).get();
        if (userDoc.exists) {
          const data = userDoc.data() as any;
          // Try multiple possible field names for user name
          const name = data?.name || data?.displayName || data?.fullName || data?.email || '';
          
          if (name && name.trim()) {
            console.log(`[getStudentName] Admin SDK found name: "${name}" for ${studentId}`);
            // Cache in local users table for future quick lookups
            try {
              db.prepare('INSERT OR REPLACE INTO users (id, name, email, role) VALUES (?, ?, ?, ?)')
                .run(studentId, name, data?.email || '', data?.role || 'student');
              console.log(`[getStudentName] Cached ${studentId} -> ${name}`);
            } catch (e) {
              console.warn('Failed to cache user in local DB:', e);
            }
            return name;
          } else {
            console.warn(`[getStudentName] Admin SDK returned empty name for ${studentId}`);
          }
        } else {
          console.warn(`[getStudentName] Firestore doc not found for ${studentId}`);
        }
      } catch (err) {
        console.error(`[getStudentName] Admin SDK error for ${studentId}:`, err);
      }
    } catch (err) {
      console.error(`[getStudentName] Unexpected error for ${studentId}:`, err);
    }
    
    // Return student ID as fallback (more useful than "Unknown" for debugging)
    console.log(`[getStudentName] Returning studentId as fallback: ${studentId}`);
    return studentId;
  };

  // Repair function to populate missing student names from Firestore
  // NOTE: Skipping during startup to avoid auth issues. Names will be enriched on-demand when accessed.
const repairMissingStudentNames = async () => {
    try {
      console.log('Student name repair (skipped - will enrich on-demand via API)');
    } catch (err) {
      console.error('Error in student name repair:', err);
    }
  };

  // Cleanup old read notifications (older than 7 days)
  const cleanupOldNotifications = async () => {
    try {
      const deleted = db.prepare(`
        DELETE FROM notifications 
        WHERE is_read = 1 AND created_at < datetime('now', '-7 days')
      `).run();
      if (deleted.changes > 0) {
        console.log(`[Notification Cleanup] Deleted ${deleted.changes} old read notifications`);
      }
    } catch (err) {
      console.error('[Notification Cleanup] Error:', err);
    }
  };

  // --- Auth Routes (Most logic moved to frontend with Firebase Auth) ---
  // The server just needs to verify tokens for other routes.
  
  // --- Admin Routes ---
  app.get('/api/admin/staff', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
      const response = await fetch(
        `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents:runQuery`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${req.user.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'users' }],
              where: { fieldFilter: { field: { fieldPath: 'role' }, op: 'EQUAL', value: { stringValue: 'staff' } } }
            }
          })
        }
      );
      const results = await response.json();
      const staff = results
        .filter((r: any) => r.document)
        .map((r: any) => ({
          id: r.document.name.split('/').pop(),
          name: r.document.fields.name?.stringValue,
          email: r.document.fields.email?.stringValue,
          department: r.document.fields.department?.stringValue,
          phone: r.document.fields.phone?.stringValue,
          role: r.document.fields.role?.stringValue,
        }));
      res.json(staff);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch staff' });
    }
  });

  app.delete('/api/admin/staff/:id', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
      // Delete Firestore document via REST API
      await fetch(
        `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${req.params.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${req.user.token}` } }
      );
      // Delete from Firebase Auth (requires service account — fails gracefully if unavailable)
      try { await admin.auth().deleteUser(req.params.id); } catch (e: any) {
        console.warn('Firebase Auth user deletion skipped (no service account configured):', e.message);
      }
      res.json({ message: 'Staff deleted' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete staff' });
    }
  });

  app.get('/api/admin/students', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
      const response = await fetch(
        `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents:runQuery`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${req.user.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            structuredQuery: {
              from: [{ collectionId: 'users' }],
              where: { fieldFilter: { field: { fieldPath: 'role' }, op: 'EQUAL', value: { stringValue: 'student' } } }
            }
          })
        }
      );
      const results = await response.json();
      const students = results
        .filter((r: any) => r.document)
        .map((r: any) => ({
          id: r.document.name.split('/').pop(),
          name: r.document.fields.name?.stringValue,
          email: r.document.fields.email?.stringValue,
          course: r.document.fields.course?.stringValue,
          year: r.document.fields.year?.stringValue,
          role: r.document.fields.role?.stringValue,
        }));
      res.json(students);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch students' });
    }
  });

  app.delete('/api/admin/students/:id', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
      // Delete Firestore document via REST API
      await fetch(
        `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${req.params.id}`,
        { method: 'DELETE', headers: { Authorization: `Bearer ${req.user.token}` } }
      );
      // Delete from Firebase Auth (requires service account — fails gracefully if unavailable)
      try { await admin.auth().deleteUser(req.params.id); } catch (e: any) {
        console.warn('Firebase Auth user deletion skipped (no service account configured):', e.message);
      }
      res.json({ message: 'Student deleted' });
    } catch (error) {
      res.status(500).json({ error: 'Failed to delete student' });
    }
  });

  // Repair endpoint to populate missing student names from Firestore
  app.post('/api/admin/repair-student-names', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'admin') return res.sendStatus(403);
    try {
      // Fetch all unique student IDs with unknown names or empty names
      const unknownRecords = db.prepare(`
        SELECT DISTINCT student_id FROM attempt_results 
        WHERE student_name IS NULL OR student_name = '' OR student_name = 'Unknown'
      `).all() as Array<{ student_id: string }>;

      console.log(`Repairing student names for ${unknownRecords.length} students...`);
      
      let updated = 0;
      let failed = 0;

      for (const record of unknownRecords) {
        try {
          // Use the helper function to fetch name
          const fetchedName = await getStudentName(record.student_id, req.user.token);
          
          // Only update if we got a name that's not the student_id (meaning it was found in Firestore)
          if (fetchedName && fetchedName !== record.student_id && fetchedName.trim()) {
            // Update all records for this student with the fetched name
            db.prepare(`
              UPDATE attempt_results 
              SET student_name = ? 
              WHERE student_id = ? AND (student_name IS NULL OR student_name = '' OR student_name = 'Unknown')
            `).run(fetchedName, record.student_id);
            
            updated++;
            console.log(`✓ Updated ${record.student_id} -> ${fetchedName}`);
          } else {
            failed++;
            console.warn(`Could not fetch meaningful name for ${record.student_id}`);
          }
        } catch (err) {
          failed++;
          console.warn(`Failed to repair ${record.student_id}:`, err);
        }
      }

      res.json({
        success: true,
        message: `Repair completed: ${updated} records updated, ${failed} not found`,
        updated,
        failed,
        total: unknownRecords.length
      });
    } catch (error) {
      console.error('Repair error:', error);
      res.status(500).json({ error: 'Failed to repair student names' });
    }
  });

  // --- Staff Routes (SQLite storage) ---
  app.post('/api/staff/materials', authenticateToken, upload.single('file'), async (req: any, res) => {
    if (req.user.role !== 'staff') return res.sendStatus(403);
    const { subject, topic, description, resource_type, link } = req.body;
    const staffDepartment = req.user.department || null;

    try {
      let filePath = req.file ? `/uploads/${req.file.destination.split('/').pop()}/${req.file.filename}` : link;
      let storedResourceType = resource_type;

      if (req.file) {
        const requestedType = String(resource_type || '').toUpperCase();
        if (requestedType === 'AI_GENERATED') {
          filePath = `/uploads/${req.file.destination.split('/').pop()}/${req.file.filename}`;
          storedResourceType = 'AI_GENERATED';
        } else {
        const originalName = String(req.file.originalname || 'material');
        const isZipUpload = originalName.toLowerCase().endsWith('.zip') || String(req.file.mimetype || '').includes('zip');

        if (isZipUpload) {
          storedResourceType = 'zip';
        } else {
          const sourcePath = path.resolve(req.file.path);
          const fileBuffer = await fs.promises.readFile(sourcePath);
          const zip = new JSZip();
          zip.file(originalName, fileBuffer);

          const zipFileName = `${Date.now()}-${path.parse(originalName).name}.zip`;
          const zipAbsolutePath = path.resolve('public', 'uploads', 'zips', zipFileName);
          const zipBuffer = await zip.generateAsync({
            type: 'nodebuffer',
            compression: 'DEFLATE',
            compressionOptions: { level: 9 },
          });

          await fs.promises.writeFile(zipAbsolutePath, zipBuffer);
          // Remove original uploaded file after successful compression.
          await fs.promises.unlink(sourcePath).catch(() => undefined);

          filePath = `/uploads/zips/${zipFileName}`;
          storedResourceType = 'zip';
        }
        }
      }

db.prepare('INSERT INTO materials (staff_id, department, subject, topic, description, file_path, resource_type) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
        req.user.id,
        staffDepartment,
        subject,
        topic,
        description,
        filePath,
        storedResourceType
      );

      // Create notification for students in the same department
      const notificationTitle = `New ${storedResourceType === 'AI_GENERATED' ? 'AI Study Material' : 'Material'} Added`;
      const notificationMessage = `${topic} - ${subject}`;
      db.prepare('INSERT INTO notifications (department, type, title, message, staff_id) VALUES (?, ?, ?, ?, ?)').run(
        staffDepartment,
        storedResourceType || 'material',
        notificationTitle,
        notificationMessage,
        req.user.id
      );

      res.json({ message: 'Material uploaded' });
    } catch (err) {
      console.error('Database error saving material:', err);
      res.status(500).json({ error: 'Failed to save material to database' });
    }
  });

  app.get('/api/staff/materials', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'staff') return res.sendStatus(403);
    const staffDept = String(req.user.department || '').trim();
    try {
      // Return materials uploaded by this staff OR materials matching the staff's department OR global materials
      const materials = db.prepare(
        `SELECT * FROM materials WHERE staff_id = ? OR (LOWER(department) = LOWER(?) OR department IS NULL OR department = '') ORDER BY upload_date DESC`
      ).all(req.user.id, staffDept);
      // Fallback: return all materials if none matched (so staff still sees recent uploads)
      if (!materials || materials.length === 0) {
        const all = db.prepare('SELECT * FROM materials ORDER BY upload_date DESC').all();
        return res.json(all);
      }
      return res.json(materials);
    } catch (err) {
      console.error('Failed to fetch staff materials:', err);
      return res.status(500).json({ error: 'Failed to fetch materials' });
    }
  });

  app.get('/api/staff/progress', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'staff') return res.sendStatus(403);
    try {
      // Prefer aggregated attempts per student (grouped by attempt_id only)
      let rows = db.prepare(`
        SELECT p.attempt_id, p.student_id, MAX(p.timestamp) as timestamp,
               SUM(p.score) as correct, COUNT(*) as total_questions
        FROM progress p
        JOIN questions q ON p.question_id = q.id
        WHERE q.staff_id = ? AND p.attempt_id IS NOT NULL
        GROUP BY p.attempt_id, p.student_id
        ORDER BY timestamp DESC
      `).all(req.user.id) as Array<any>;

      if (rows && rows.length > 0) {
        const mapped = rows.map(r => {
          // Get subject from first question in this attempt
          const firstQuestion = db.prepare(`
            SELECT q.subject, q.topic FROM progress p
            JOIN questions q ON p.question_id = q.id
            WHERE p.attempt_id = ?
            LIMIT 1
          `).get(r.attempt_id) as any;
          const subject = firstQuestion?.subject || 'General';
          const topic = firstQuestion?.topic || subject;
          const percentage = r.total_questions === 0 ? 0 : (r.correct / r.total_questions) * 100;
          return {
            student_id: r.student_id,
            student_name: undefined,
            topic: topic,
            subject: subject,
            score: Math.round(percentage),
            correctAnswers: r.correct,
            totalQuestions: r.total_questions,
            percentage: Math.round(percentage * 10) / 10,
            timestamp: r.timestamp,
          };
        });
        rows = mapped as any;
      } else {
        rows = db.prepare(`
          SELECT p.student_id, q.topic, p.score, p.timestamp as status
          FROM progress p
          JOIN questions q ON p.question_id = q.id
          WHERE q.staff_id = ?
          ORDER BY p.timestamp DESC
        `).all(req.user.id) as Array<any>;
      }

      // If staff has no matched progress, return empty list (so new staff sees 0 activity)
      if (!rows || rows.length === 0) {
        rows = [];
      }


      // Enrich with student name by fetching from local cache or Firestore
      const uniqueStudentIds = Array.from(new Set(rows.map(r => r.student_id).filter(Boolean)));
      const studentNameMap: Record<string, string> = {};

      await Promise.all(uniqueStudentIds.map(async (sid) => {
        const name = await getStudentName(sid, req.user.token);
        // Always store a fallback name - prefer actual name, otherwise use student_id
        studentNameMap[sid] = (name && name !== sid) ? name : sid;
      }));

      // Ensure every row has a proper student_name field (never "Unknown")
      const enriched = rows.map(r => {
        const student_name = studentNameMap[r.student_id] || r.student_id;
        return {
          ...r,
          student_name: student_name,  // Always set to either the name or student_id
          student_id: r.student_id  // Ensure student_id is also available
        };
      });

      console.log('[API Response] Progress enriched:', enriched.slice(0, 2));
      res.json(enriched);
    } catch (err) {
      console.error('Failed to fetch staff progress:', err);
      res.status(500).json({ error: 'Failed to fetch progress' });
    }
  });

  // Get all course-wise test results for staff
  app.get('/api/staff/course-results', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'staff') return res.sendStatus(403);
    try {
      let results = db.prepare(`
        SELECT id, student_id, student_name, course_subject, attempt_id, total_questions, correct_answers, wrong_answers, percentage, status, submitted_at
        FROM attempt_results
        WHERE staff_id = ?
        ORDER BY submitted_at DESC
      `).all(req.user.id) as Array<any>;

      // Enrich missing student names using helper function
      const enriched = await Promise.all(results.map(async (r: any) => {
        // Skip if we have a real name (not empty, not null, not 'Unknown')
        if (r.student_name && r.student_name.trim() && r.student_name !== 'Unknown') {
          return r;
        }
        
        // Fetch name using helper function (pass token for Firestore REST API)
        const fetchedName = await getStudentName(r.student_id, req.user.token);
        // Only update DB if we got a real name (not just student_id fallback)
        if (fetchedName && fetchedName !== r.student_id && fetchedName !== 'Unknown') {
          try {
            db.prepare('UPDATE attempt_results SET student_name = ? WHERE id = ?').run(fetchedName, r.id);
          } catch (e) {
            console.warn('Failed to update student name in DB:', e);
          }
          return { ...r, student_name: fetchedName };
        }
        
        // Use student_id as fallback if no real name found
        const displayName = fetchedName || r.student_id;
        return { ...r, student_name: displayName };
      }));

      console.log('[API Response] Course results enriched:', enriched.slice(0, 2));
      res.json(enriched);
    } catch (err) {
      console.error('Failed to fetch course results:', err);
      res.status(500).json({ error: 'Failed to fetch course results' });
    }
  });

  // Get detailed breakdown of a specific attempt
  app.get('/api/staff/attempt-details/:attemptId', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'staff') return res.sendStatus(403);
    try {
      const { attemptId } = req.params;
      
      // Get the attempt result summary
      const result = db.prepare('SELECT * FROM attempt_results WHERE attempt_id = ? AND staff_id = ?').get(attemptId, req.user.id) as any;
      if (!result) return res.status(404).json({ error: 'Attempt not found' });

      // Get all progress rows for this attempt with question details
      const details = db.prepare(`
        SELECT p.id, p.question_id, p.selected_answer, p.score, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer, q.topic
        FROM progress p
        JOIN questions q ON p.question_id = q.id
        WHERE p.attempt_id = ?
        ORDER BY p.id ASC
      `).all(attemptId) as Array<any>;

      // Format the response
      const formattedDetails = details.map(d => ({
        question_id: d.question_id,
        question_text: d.question_text,
        topic: d.topic,
        options: {
          A: d.option_a,
          B: d.option_b,
          C: d.option_c,
          D: d.option_d
        },
        student_answer: d.selected_answer,
        correct_answer: d.correct_answer,
        is_correct: d.score === 1
      }));

      res.json({
        result: {
          id: result.id,
          course_subject: result.course_subject,
          total_questions: result.total_questions,
          correct_answers: result.correct_answers,
          wrong_answers: result.wrong_answers,
          percentage: result.percentage,
          status: result.status,
          submitted_at: result.submitted_at
        },
        details: formattedDetails
      });
    } catch (err) {
      console.error('Failed to fetch attempt details:', err);
      res.status(500).json({ error: 'Failed to fetch attempt details' });
    }
  });

  app.get('/api/staff/questions', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'staff') return res.sendStatus(403);
    try {
      const questions = db.prepare(`
        SELECT id, subject, topic, question_text, option_a, option_b, option_c, option_d, correct_answer
        FROM questions
        WHERE staff_id = ?
        ORDER BY id DESC
      `).all(req.user.id);
      res.json(questions);
    } catch (err) {
      console.error('Failed to fetch staff questions:', err);
      res.status(500).json({ error: 'Failed to fetch staff questions' });
    }
  });

  app.post('/api/staff/questions', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'staff') return res.sendStatus(403);
    const { subject, topic, questions } = req.body;

    if (!subject || !topic || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'Invalid payload. subject, topic and non-empty questions are required.' });
    }

    const validQuestions = questions
      .map((q: any) => ({
        question_text: String(q?.question_text ?? '').trim(),
        option_a: String(q?.option_a ?? '').trim(),
        option_b: String(q?.option_b ?? '').trim(),
        option_c: String(q?.option_c ?? '').trim(),
        option_d: String(q?.option_d ?? '').trim(),
        correct_answer: String(q?.correct_answer ?? 'A').trim().toUpperCase(),
      }))
      .filter((q: any) => q.question_text && q.option_a && q.option_b && q.option_c && q.option_d)
      .map((q: any) => ({
        ...q,
        correct_answer: ['A', 'B', 'C', 'D'].includes(q.correct_answer) ? q.correct_answer : 'A',
      }));

    if (validQuestions.length === 0) {
      return res.status(400).json({ error: 'No valid questions to save.' });
    }

    const insert = db.prepare('INSERT INTO questions (staff_id, subject, topic, question_text, option_a, option_b, option_c, option_d, correct_answer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
    const transaction = db.transaction((rows: any[]) => {
      rows.forEach((q: any) => {
        insert.run(req.user.id, subject, topic, q.question_text, q.option_a, q.option_b, q.option_c, q.option_d, q.correct_answer);
      });
    });

try {
      transaction(validQuestions);
      res.json({ message: 'Questions saved', savedCount: validQuestions.length });

      // Create notification for students in the same department
      try {
        const staffDept = req.user.department || null;
        db.prepare('INSERT INTO notifications (department, type, title, message, staff_id) VALUES (?, ?, ?, ?, ?)').run(
          staffDept,
          'questions',
          'New Quiz Added',
          `${topic} - ${subject} (${validQuestions.length} questions)`,
          req.user.id
        );
      } catch (e) { console.warn('Notification creation failed:', e); }
    } catch (err) {
      console.error('Failed to save questions:', err);
      res.status(500).json({ error: 'Failed to save questions' });
    }
  });

  // --- Notification Routes for Students ---
  app.get('/api/student/notifications', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);
    try {
      const studentDept = String(req.user.department || '').trim();
      let notifications: any[];
      
      if (studentDept) {
        notifications = db.prepare(`
          SELECT * FROM notifications 
          WHERE department = ? OR department IS NULL OR department = ''
          ORDER BY created_at DESC 
          LIMIT 20
        `).all(studentDept) as any[];
      } else {
        notifications = db.prepare(`
          SELECT * FROM notifications 
          ORDER BY created_at DESC 
          LIMIT 20
        `).all() as any[];
      }
      
      res.json(notifications);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
      res.status(500).json({ error: 'Failed to fetch notifications' });
    }
  });

  app.post('/api/student/notifications/:id/read', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);
    try {
      db.prepare('UPDATE notifications SET is_read = 1 WHERE id = ?').run(req.params.id);
      res.json({ message: 'Notification marked as read' });
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
      res.status(500).json({ error: 'Failed to mark notification as read' });
    }
  });

  app.post('/api/student/notifications/read-all', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);
    try {
      const studentDept = String(req.user.department || '').trim();
      if (studentDept) {
        db.prepare(`
          UPDATE notifications 
          SET is_read = 1 
          WHERE (department = ? OR department IS NULL OR department = '') AND is_read = 0
        `).run(studentDept);
      } else {
        db.prepare('UPDATE notifications SET is_read = 1 WHERE is_read = 0').run();
      }
res.json({ message: 'All notifications marked as read' });
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
      res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
  });

  app.get('/api/student/materials', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);
    const studentDepartment = String(req.user.department || '').trim();

    let materials: any[] = [];
    if (studentDepartment) {
      materials = db.prepare(
        'SELECT * FROM materials WHERE LOWER(department) = LOWER(?) OR department IS NULL OR department = "" ORDER BY upload_date DESC'
      ).all(studentDepartment) as any[];

      // Fallback for profile/department naming mismatch so students can still see uploaded content.
      if (materials.length === 0) {
        materials = db.prepare('SELECT * FROM materials ORDER BY upload_date DESC').all() as any[];
      }
    } else {
      materials = db.prepare('SELECT * FROM materials ORDER BY upload_date DESC').all() as any[];
    }

    res.json(materials);
  });

  app.post('/api/student/materials/:id/access', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);
    db.prepare('INSERT INTO material_access (student_id, material_id) VALUES (?, ?)').run(req.user.id, req.params.id);
    res.json({ message: 'Access logged' });
  });

  app.post('/api/student/chatbot', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);
    if (!gemini) {
      return res.status(500).json({ error: 'GEMINI_API_KEY is not configured on server.' });
    }

    const message = String(req.body?.message || '').trim();
    const historyInput = Array.isArray(req.body?.history) ? req.body.history : [];
    if (!message) {
      return res.status(400).json({ error: 'Message is required.' });
    }

    const history = historyInput
      .slice(-8)
      .map((m: any) => ({
        role: m?.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: String(m?.content || '').slice(0, 1000) }],
      }))
      .filter((m: any) => String(m.parts?.[0]?.text || '').trim().length > 0);

    try {
      const prompt = `You are a helpful educational chatbot for students. Keep answers concise, clear, and practical. If asked outside study context, still answer politely in a safe manner.`;
      const result = await gemini.models.generateContent({
        model: 'gemini-2.5-flash-lite',
        contents: [
          { role: 'user', parts: [{ text: prompt }] },
          ...history,
          { role: 'user', parts: [{ text: message }] }
        ]
      });

      const reply = String(result.text || '').trim();
      if (!reply) {
        return res.status(502).json({ error: 'No response from chatbot.' });
      }
      return res.json({ reply });
    } catch (error) {
      console.error('Student chatbot error:', error);
      return res.status(500).json({ error: 'Failed to get chatbot response.' });
    }
  });

  app.get('/api/student/materials/:id/download', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);

    const material = db.prepare('SELECT id, subject, topic, description, resource_type, file_path FROM materials WHERE id = ?').get(req.params.id) as any;
    if (!material) return res.status(404).json({ error: 'Material not found' });

    const filePath = String(material.file_path || '');
    if (!filePath) return res.status(400).json({ error: 'No file available for download' });

    const safeBaseName = String(material.topic || `material-${material.id}`)
      .toLowerCase()
      .replace(/[^a-z0-9-_]+/g, '-')
      .replace(/^-+|-+$/g, '') || `material-${material.id}`;
    const zipName = `${safeBaseName}.zip`;

    // External resources are packaged into a zip text manifest.
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      const zip = new JSZip();
      const manifest = [
        `Subject: ${material.subject || ''}`,
        `Topic: ${material.topic || ''}`,
        `Type: ${material.resource_type || ''}`,
        `Description: ${material.description || ''}`,
        `URL: ${filePath}`,
      ].join('\n');
      zip.file('resource-link.txt', manifest);
      zip.file('link.url', `[InternetShortcut]\nURL=${filePath}\n`);

      return zip
        .generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
        .then((buffer) => {
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
          res.send(buffer);
        })
        .catch((error) => {
          console.error('Failed to create zip for external resource:', error);
          res.status(500).json({ error: 'Failed to prepare download' });
        });
    }

    if (!filePath.startsWith('/uploads/')) {
      return res.status(400).json({ error: 'Unsupported material path' });
    }

    const uploadsRoot = path.resolve(process.cwd(), 'public', 'uploads');
    const resolvedPath = path.resolve(process.cwd(), 'public', filePath.replace(/^\//, ''));

    // Prevent path traversal outside uploads directory.
    if (!resolvedPath.startsWith(uploadsRoot)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    // If already zipped, send directly.
    if (String(material.resource_type || '').toLowerCase() === 'zip' || resolvedPath.toLowerCase().endsWith('.zip')) {
      return res.download(resolvedPath, path.basename(resolvedPath));
    }

    // For non-zip local files, return a generated zip package.
    return fs.promises
      .readFile(resolvedPath)
      .then((fileBuffer) => {
        const zip = new JSZip();
        zip.file(path.basename(resolvedPath), fileBuffer);
        return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
      })
      .then((buffer) => {
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
        res.send(buffer);
      })
      .catch((error) => {
        console.error('Failed to create zip download:', error);
        res.status(500).json({ error: 'Failed to prepare download' });
      });
  });

  app.get('/api/student/questions', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);

    // Return only questions uploaded by the student's department/subject.
    // Students should see quizzes for their own course/stream.
    const studentSubject = String(req.user.course || req.user.subject || '').trim();
    const studentDepartment = String(req.user.department || '').trim();

    try {
      let questions: any[] = [];

      // Filtering logic:
      // - Staff uploads questions with `subject` and `topic`.
      // - For students, we must match the student's assigned `course` (or `subject`).
      // - If course/subject is not present, we do NOT fall back to department here,
      //   because questions are not stored with department in the database schema.
      if (studentSubject) {
        questions = db.prepare(
          `SELECT id, subject, topic, question_text, option_a, option_b, option_c, option_d
           FROM questions
           WHERE LOWER(subject) = LOWER(?)
           ORDER BY id DESC`
        ).all(studentSubject);
      } else {
        questions = [];
      }

      res.json(questions || []);
    } catch (e) {
      console.error('Failed to fetch student questions:', e);
      res.status(500).json({ error: 'Failed to fetch questions' });
    }
  });

  app.post('/api/student/submit-answer', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);
    const { question_id, selected_answer } = req.body;
    const question = db.prepare('SELECT correct_answer FROM questions WHERE id = ?').get(question_id);
    const score = selected_answer === question.correct_answer ? 1 : 0;
    db.prepare('INSERT INTO progress (student_id, question_id, selected_answer, score) VALUES (?, ?, ?, ?)').run(req.user.id, question_id, selected_answer, score);
    res.json({ score, correct_answer: question.correct_answer });
  });

  // Submit multiple answers at once and evaluate score server-side
  app.post('/api/student/submit-answers', authenticateToken, async (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);
    const payload = req.body?.answers;
    const courseSubject = req.body?.subject; // Expected: course name/subject from frontend
    if (!Array.isArray(payload)) return res.status(400).json({ error: 'Invalid payload' });

    let totalScore = 0;
    let courseSubjectFromQuestions = courseSubject || '';
    const review: Array<any> = [];
    const answersMap: Record<number, string> = {};

    const insertStmt = db.prepare('INSERT INTO progress (student_id, question_id, selected_answer, score, attempt_id) VALUES (?, ?, ?, ?, ?)');

    const attemptId = String(Date.now()) + '-' + Math.random().toString(36).slice(2,8);
    for (const item of payload) {
      const qid = item.question_id;
      const selected = String(item.selected_answer || '');
      const question = db.prepare('SELECT correct_answer, subject, staff_id FROM questions WHERE id = ?').get(qid) as any;
      const correct = question ? String(question.correct_answer || '') : '';
      const isCorrect = selected && selected.toUpperCase() === correct.toUpperCase();
      const score = isCorrect ? 1 : 0;
      try { insertStmt.run(req.user.id, qid, selected, score, attemptId); } catch (e) { /* ignore insert errors */ }
      if (isCorrect) totalScore += 1;
      answersMap[qid] = selected;
      review.push({ question_id: qid, selected: selected || null, correct: correct || null, isCorrect });
      
      // Extract course subject and staff_id from first question
      if (!courseSubjectFromQuestions && question?.subject) {
        courseSubjectFromQuestions = question.subject;
      }
    }

    const totalQuestions = payload.length;
    const percentage = totalQuestions === 0 ? 0 : (totalScore / totalQuestions) * 100;
    let status = 'Needs Improvement';
    if (percentage >= 80) status = 'Excellent';
    else if (percentage >= 50) status = 'Good';

    const result = {
      totalQuestions,
      correctAnswers: totalScore,
      wrongAnswers: totalQuestions - totalScore,
      percentage,
      status,
    };

    // Save aggregated result to attempt_results table (get staff_id from questions and fetch student name)
    try {
      const firstQuestion = db.prepare('SELECT staff_id FROM questions WHERE id = ?').get(payload[0]?.question_id) as any;
      const staffId = firstQuestion?.staff_id || '';
      
      // Get student name using helper function (pass token for Firestore REST API)
      let studentName = req.user.name && req.user.name.trim() ? req.user.name : await getStudentName(req.user.id, req.user.token);
      if (!studentName || studentName === 'Unknown') {
        studentName = req.user.email || 'Unknown';
      }
      
      console.log(`Saving result for student: ${studentName} (ID: ${req.user.id})`);
      
      db.prepare(`
        INSERT INTO attempt_results (staff_id, student_id, student_name, course_subject, attempt_id, total_questions, correct_answers, wrong_answers, percentage, status, answers_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(staffId, req.user.id, studentName, courseSubjectFromQuestions, attemptId, totalQuestions, totalScore, totalQuestions - totalScore, parseFloat(percentage.toFixed(2)), status, JSON.stringify(answersMap));
    } catch (e) {
      console.error('Failed to save aggregated result:', e);
    }

    res.json({ result, review });
  });

  app.get('/api/student/progress', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);
    // Prefer returning aggregated attempts (grouped by attempt_id only)
    try {
      const attempts = db.prepare(`
        SELECT p.attempt_id, MAX(p.timestamp) as timestamp,
               SUM(p.score) as correct, COUNT(*) as total_questions
        FROM progress p
        WHERE p.student_id = ? AND p.attempt_id IS NOT NULL
        GROUP BY p.attempt_id
        ORDER BY timestamp DESC
      `).all(req.user.id) as Array<any>;

      if (attempts && attempts.length > 0) {
        const mapped = attempts.map(a => {
          // Get subject from first question in this attempt
          const firstQuestion = db.prepare(`
            SELECT q.subject FROM progress p
            JOIN questions q ON p.question_id = q.id
            WHERE p.attempt_id = ?
            LIMIT 1
          `).get(a.attempt_id) as any;
          const subject = firstQuestion?.subject || 'General';
          
          const percentage = a.total_questions === 0 ? 0 : (a.correct / a.total_questions) * 100;
          let status = 'Needs Improvement';
          if (percentage >= 80) status = 'Excellent';
          else if (percentage >= 50) status = 'Good';
          return {
            attempt_id: a.attempt_id,
            subject: subject,
            topic: subject,
            score: Math.round(percentage),
            correctAnswers: a.correct,
            totalQuestions: a.total_questions,
            percentage: Math.round(percentage * 10) / 10,
            status,
            timestamp: a.timestamp,
          };
        });
        return res.json(mapped);
      }

      // Fallback to older per-question format if no attempt_id data exists
      const progress = db.prepare(`
        SELECT q.subject, q.topic, p.score, p.timestamp
        FROM progress p
        JOIN questions q ON p.question_id = q.id
        WHERE p.student_id = ?
      `).all(req.user.id);
      res.json(progress);
    } catch (err) {
      console.error('Failed to fetch student progress:', err);
      res.status(500).json({ error: 'Failed to fetch progress' });
    }
  });

  // Attendance API endpoints
  app.get('/api/student/attendance', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);

    const currentDate = new Date();
    const currentYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    try {
      const attendance = db.prepare(`
        SELECT id, date, status, year_month, created_at, updated_at
        FROM attendance
        WHERE student_id = ? AND year_month = ?
        ORDER BY date DESC
      `).all(req.user.id, currentYearMonth) as Array<any>;

      res.json(attendance);
    } catch (err) {
      console.error('Failed to fetch attendance:', err);
      res.status(500).json({ error: 'Failed to fetch attendance' });
    }
  });

  app.post('/api/student/attendance', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);

    const { date, status } = req.body;
    if (!date || !status || !['present', 'absent'].includes(status)) {
      return res.status(400).json({ error: 'Invalid date or status' });
    }

    const currentDate = new Date();
    const currentYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    try {
      const existing = db.prepare('SELECT id FROM attendance WHERE student_id = ? AND date = ?').get(req.user.id, date) as any;

      if (existing) {
        db.prepare(`
          UPDATE attendance
          SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE student_id = ? AND date = ?
        `).run(status, req.user.id, date);
      } else {
        db.prepare(`
          INSERT INTO attendance (student_id, date, status, year_month, created_at, updated_at)
          VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(req.user.id, date, status, currentYearMonth);
      }

      res.json({ success: true, message: 'Attendance saved' });
    } catch (err) {
      console.error('Failed to save attendance:', err);
      res.status(500).json({ error: 'Failed to save attendance' });
    }
  });

  app.get('/api/student/attendance/summary', authenticateToken, (req: any, res) => {
    if (req.user.role !== 'student') return res.sendStatus(403);

    const currentDate = new Date();
    const currentYearMonth = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}`;

    try {
      const summary = db.prepare(`
        SELECT
          SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as total_present,
          SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as total_absent,
          COUNT(*) as total_days
        FROM attendance
        WHERE student_id = ? AND year_month = ?
      `).get(req.user.id, currentYearMonth) as any;

      res.json({
        total_present: summary?.total_present || 0,
        total_absent: summary?.total_absent || 0,
        total_days: summary?.total_days || 0,
      });
    } catch (err) {
      console.error('Failed to fetch attendance summary:', err);
      res.status(500).json({ error: 'Failed to fetch summary' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const net = await import('net');
    const basePort = Number(process.env.PORT) || 3002;

    const findFreePort = async (start: number, attempts = 20) => {
      for (let i = 0; i < attempts; i++) {
        const port = start + i;
        // eslint-disable-next-line no-await-in-loop
        const ok = await new Promise<boolean>((resolve) => {
          const tester = net.createServer()
            .once('error', () => resolve(false))
            .once('listening', () => {
              tester.close();
              resolve(true);
            })
            .listen(port, '0.0.0.0');
        });
        if (ok) return port;
      }
      return null;
    };

    const chosenPort = await findFreePort(basePort, 20);
    if (!chosenPort) {
      console.error(`Failed to find free port in range ${basePort}-${basePort + 19}. Set PORT env to an open port.`);
      process.exit(1);
    }

    // Disable HMR to avoid WebSocket upgrade issues during quick dev runs.
    // If you need live HMR, we can re-enable with a deterministic free port.
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: 'spa',
    });
    app.use(vite.middlewares);

    // Log incoming requests to a file for debugging from outside the terminal
    app.use((req, res, next) => {
      try {
        fs.appendFileSync('server-requests.log', `${new Date().toISOString()} ${req.method} ${req.url}\n`);
      } catch (e) { /* ignore */ }
      next();
    });

    // Fallback to serve index.html directly if Vite middleware doesn't handle it (helps when HMR disabled)
    app.get('/', (req, res) => {
      try {
        const indexPath = path.resolve(process.cwd(), 'index.html');
        if (fs.existsSync(indexPath)) return res.sendFile(indexPath);
      } catch (e) { /* ignore */ }
      res.status(200).send('<!doctype html><html><body><div id="root"></div><script>console.log("index fallback served")</script></body></html>');
    });

    // Force server-port.txt to reflect chosen port (always use 3002 by default)
    try { fs.writeFileSync('server-port.txt', String(chosenPort)); } catch (e) { /* ignore */ }

    // Repair missing student names before starting server
await repairMissingStudentNames();
    await cleanupOldNotifications();

    app.listen(chosenPort, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${chosenPort}`);
    });
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => res.sendFile(path.resolve(__dirname, 'dist', 'index.html')));

    const PORT = Number(process.env.PORT) || 3002;
    
    // Repair missing student names before starting server
    await repairMissingStudentNames();
    await cleanupOldNotifications();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();
