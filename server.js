require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const compression = require('compression');

const { Server } = require('socket.io');
const admin = require('firebase-admin');
const { MongoClient, ObjectId } = require('mongodb');
const path = require('path');

// ─── MongoDB Connection ─────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI;
let mongoClient;
let db = null;
let dbReady = false;

async function connectMongoDB() {
  try {
    if (!MONGODB_URI) {
      throw new Error('❌ MONGODB_URI environment variable is not defined');
    }

    console.log('📡 Attempting to connect to MongoDB...');
    mongoClient = new MongoClient(MONGODB_URI, {
      tls: true,
      serverSelectionTimeoutMS: 10000, // Faster timeout
      connectTimeoutMS: 10000,
    });

    await mongoClient.connect();
    db = mongoClient.db();
    dbReady = true;
    console.log('✅ MongoDB connected successfully');

    // Rename moodLogs to mood_logs for consistency
    const collections = await db.listCollections().toArray();
    const hasOldMoodLogs = collections.find(c => c.name === 'moodLogs');
    const hasNewMoodLogs = collections.find(c => c.name === 'mood_logs');

    if (hasOldMoodLogs && !hasNewMoodLogs) {
      console.log('🔄 Renaming collection "moodLogs" to "mood_logs"');
      await db.collection('moodLogs').rename('mood_logs');
      console.log('✅ Collection renamed successfully');
    }

    // Ensure Indexes for Performance
    console.log('⚡ Checking database indexes...');
    await Promise.all([
      db.collection('users').createIndex({ orgId: 1 }),
      db.collection('users').createIndex({ username: 1 }, { unique: true, sparse: true }),
      db.collection('organizations').createIndex({ inviteCode: 1 }, { unique: true }),
      db.collection('mood_logs').createIndex({ orgId: 1, timestamp: -1 }),
      db.collection('notifications').createIndex({ orgId: 1, timestamp: -1 }),
      db.collection('notifications').createIndex({ userId: 1 }),
      db.collection('self_care_logs').createIndex({ userId: 1, completedAt: -1 })
    ]);
    console.log('✅ Database indexes verified');
  } catch (err) {
    console.error('❌ MongoDB connection failed:', err.message);
    if (err.message.includes('SSL')) {
      console.error('💡 Hint: This error often happens if the Render IP is not allowlisted in MongoDB Atlas Network Access.');
    }
    // Don't exit immediately on local dev to allow troubleshooting, but on Render it will crash safely
    if (process.env.NODE_ENV === 'production') {
      process.exit(1);
    }
  }
}

// ─── Firebase Auth Only ─────────────────────────────────────────
let firebaseAuth = null;

try {
  const fs = require('fs');
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('🔑 Using Firebase credentials from environment variable');
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } else if (fs.existsSync(path.join(__dirname, 'serviceAccountKey.json'))) {
    console.log('🔑 Using Firebase credentials from serviceAccountKey.json');
    serviceAccount = require('./serviceAccountKey.json');
  } else {
    throw new Error('No Firebase credentials found');
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
  firebaseAuth = admin.auth();
  console.log('✅ Firebase Auth initialized successfully');
} catch (err) {
  console.warn('⚠️  Firebase Auth not configured');
}

// Connection is now handled in the start() function at the bottom

// ─── Express + Socket.io ────────────────────────────────────────
const app = express();

// 1. Explicitly Handle CORS Preflight First
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Origin', 'Accept', 'X-Requested-With'],
  credentials: true,
  optionsSuccessStatus: 204
}));

// 2. Extra Header Safety for Fetch API (Ensures headers are present even if middleware is bypassed)
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type,Authorization');
  res.setHeader('Access-Control-Allow-Credentials', true);

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
});

app.use(express.json());
app.use(compression());

// Serve static files from 'public' — no cache so updates apply immediately
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: 0,
  etag: false,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));

// ─── Health Check Root (Fallback) ───────────────────────────────
app.get('/api/health', (req, res) => {
  res.send('Sonder API Server is running!');
});



// ─── Test endpoint ──────────────────────────────────────────────
app.get('/api/test', (req, res) => {
  res.json({
    message: 'API is working with MongoDB!',
    timestamp: Date.now(),
    database: dbReady ? 'MongoDB Connected' : 'Not connected'
  });
});

// ─── Quotes Proxy ───────────────────────────────────────────────
app.get('/api/quotes', async (req, res) => {
  try {
    const https = require('https');
    const allQuotes = [];

    const fetchZenQuotes = () => {
      return new Promise((resolve) => {
        https.get('https://zenquotes.io/api/quotes', (apiRes) => {
          let data = '';
          apiRes.on('data', (chunk) => { data += chunk; });
          apiRes.on('end', () => {
            try {
              const quotes = JSON.parse(data);
              resolve(quotes);
            } catch (err) {
              resolve([]);
            }
          });
        }).on('error', () => resolve([]));
      });
    };

    const fetchQuotableQuotes = async (page = 1, limit = 150) => {
      return new Promise((resolve) => {
        https.get(`https://api.quotable.io/quotes?page=${page}&limit=${limit}`, (apiRes) => {
          let data = '';
          apiRes.on('data', (chunk) => { data += chunk; });
          apiRes.on('end', () => {
            try {
              const response = JSON.parse(data);
              if (response.results) {
                const quotes = response.results.map(q => ({
                  q: q.content,
                  a: q.author
                }));
                resolve(quotes);
              } else {
                resolve([]);
              }
            } catch (err) {
              resolve([]);
            }
          });
        }).on('error', () => resolve([]));
      });
    };

    const [zenQuotes, quotable1, quotable2, quotable3] = await Promise.all([
      fetchZenQuotes(),
      fetchQuotableQuotes(1, 150),
      fetchQuotableQuotes(2, 150),
      fetchQuotableQuotes(3, 150)
    ]);

    allQuotes.push(...zenQuotes, ...quotable1, ...quotable2, ...quotable3);

    const uniqueQuotes = Array.from(
      new Map(allQuotes.map(q => [q.q, q])).values()
    );

    res.json({ success: true, quotes: uniqueQuotes });

  } catch (err) {
    console.error('Quotes endpoint error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Helper: Verify Firebase Token ──────────────────────────────
async function verifyToken(token) {
  try {
    if (!firebaseAuth) return null;
    const decoded = await firebaseAuth.verifyIdToken(token);
    return decoded;
  } catch (err) {
    return null;
  }
}

// ─── Auth Middleware ────────────────────────────────────────────
async function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split('Bearer ')[1];
  const decoded = await verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  req.user = decoded;
  next();
}

function collectUserPushTokens(users) {
  const tokenSet = new Set();
  (users || []).forEach((userDoc) => {
    if (typeof userDoc?.fcmToken === 'string' && userDoc.fcmToken.trim()) {
      tokenSet.add(userDoc.fcmToken.trim());
    }
    if (Array.isArray(userDoc?.fcmTokens)) {
      userDoc.fcmTokens.forEach((token) => {
        if (typeof token === 'string' && token.trim()) {
          tokenSet.add(token.trim());
        }
      });
    }
  });
  return Array.from(tokenSet);
}

async function cleanupInvalidPushTokens(invalidTokens) {
  if (!invalidTokens || invalidTokens.length === 0) return;
  const cleaned = invalidTokens.filter((token) => typeof token === 'string' && token.trim());
  if (cleaned.length === 0) return;

  await Promise.all([
    db.collection('users').updateMany(
      { fcmTokens: { $exists: true } },
      { $pull: { fcmTokens: { $in: cleaned } } }
    ),
    db.collection('users').updateMany(
      { fcmToken: { $in: cleaned } },
      { $unset: { fcmToken: "" } }
    )
  ]);
}

async function sendPushToUsers({ query, excludeUserId, notification, data, logLabel }) {
  if (!firebaseAuth || typeof admin === 'undefined' || !dbReady) return;

  const finalQuery = { ...(query || {}) };
  if (excludeUserId) {
    finalQuery._id = { $ne: excludeUserId };
  }

  const users = await db.collection('users').find(finalQuery).toArray();
  const tokens = collectUserPushTokens(users);
  if (tokens.length === 0) return;

  const payload = {
    notification,
    data: Object.fromEntries(
      Object.entries(data || {}).map(([k, v]) => [k, typeof v === 'string' ? v : String(v ?? '')])
    ),
    tokens
  };

  const response = await admin.messaging().sendEachForMulticast(payload);
  const invalidTokens = [];
  response.responses.forEach((result, index) => {
    if (result.success) return;
    const code = result.error?.code || "";
    if (code.includes('registration-token-not-registered') || code.includes('invalid-registration-token')) {
      invalidTokens.push(tokens[index]);
    }
  });
  await cleanupInvalidPushTokens(invalidTokens);

  const invalidCount = invalidTokens.length;
  console.log(`📡 ${logLabel}: ${response.successCount} successes, ${response.failureCount} failures${invalidCount ? `, ${invalidCount} invalid tokens cleaned` : ''}`);
}

// ─── REST: Supervisor — List all their groups ────────────────────
app.get('/api/supervisor/groups', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Supervisor access required' });
    }

    const orgIds = userDoc.orgIds || (userDoc.orgId ? [userDoc.orgId] : []);
    if (orgIds.length === 0) return res.json({ groups: [], activeOrgId: null });

    const orgs = await db.collection('organizations').find({
      _id: { $in: orgIds.map(id => { try { return new ObjectId(id); } catch (e) { return null; } }).filter(Boolean) }
    }).toArray();

    res.json({
      groups: orgs.map(o => ({ id: o._id.toString(), name: o.name, inviteCode: o.inviteCode })),
      activeOrgId: userDoc.orgId || null
    });
  } catch (err) {
    console.error('List supervisor groups error:', err);
    res.status(500).json({ error: 'Failed to list groups' });
  }
});

// ─── REST: Supervisor — Create additional group ──────────────────
app.post('/api/supervisor/create-group', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Group name is required' });

    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Supervisor access required' });
    }

    const inviteCode = Math.floor(100000 + Math.random() * 900000).toString();

    // Check if supervisor is approved — get institutionId
    const supRecord = await db.collection('approved_supervisors').findOne({
      email: (req.user.email || '').toLowerCase(),
      isActive: true
    });

    const orgResult = await db.collection('organizations').insertOne({
      name,
      adminId: req.user.uid,
      inviteCode,
      members: [req.user.uid],
      institutionId: supRecord?.institutionId || null,
      createdAt: new Date()
    });

    const newOrgId = orgResult.insertedId.toString();
    const existingOrgIds = userDoc.orgIds || (userDoc.orgId ? [userDoc.orgId] : []);

    await db.collection('users').updateOne(
      { _id: req.user.uid },
      { $set: { orgId: newOrgId, orgIds: [...new Set([...existingOrgIds, newOrgId])], role: 'admin', lastUpdated: new Date() } }
    );

    res.json({ orgId: newOrgId, inviteCode, name });
  } catch (err) {
    console.error('Supervisor create group error:', err);
    res.status(500).json({ error: 'Failed to create group' });
  }
});

// ─── REST: Supervisor — Join additional group ────────────────────
app.post('/api/supervisor/join-group', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ error: 'Invite code is required' });

    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Supervisor access required' });
    }

    const org = await db.collection('organizations').findOne({ inviteCode });
    if (!org) return res.status(404).json({ error: 'Invalid invite code' });

    const newOrgId = org._id.toString();
    const existingOrgIds = userDoc.orgIds || (userDoc.orgId ? [userDoc.orgId] : []);

    if (existingOrgIds.includes(newOrgId)) {
      return res.status(400).json({ error: 'You are already in this group' });
    }

    // Get supervisor's institution
    const supRecord = await db.collection('approved_supervisors').findOne({
      email: (req.user.email || '').toLowerCase(),
      isActive: true
    });

    // If group belongs to a different institution, deny
    if (org.institutionId && supRecord?.institutionId &&
        org.institutionId.toString() !== supRecord.institutionId.toString()) {
      return res.status(403).json({
        error: 'This group is not associated with your institution. You cannot join it.'
      });
    }

    await db.collection('users').updateOne(
      { _id: req.user.uid },
      { $set: { orgId: newOrgId, orgIds: [...new Set([...existingOrgIds, newOrgId])], lastUpdated: new Date() } }
    );

    await db.collection('organizations').updateOne(
      { _id: org._id },
      { $addToSet: { members: req.user.uid } }
    );

    // Tag group with supervisor's institutionId if not already set
    if (!org.institutionId && supRecord?.institutionId) {
      await db.collection('organizations').updateOne(
        { _id: org._id },
        { $set: { institutionId: supRecord.institutionId } }
      );
    }

    res.json({ orgId: newOrgId, name: org.name, inviteCode: org.inviteCode });
  } catch (err) {
    console.error('Supervisor join group error:', err);
    res.status(500).json({ error: 'Failed to join group' });
  }
});

// ─── REST: Supervisor — Switch active group ──────────────────────
app.post('/api/supervisor/switch-group', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { orgId } = req.body;
    if (!orgId) return res.status(400).json({ error: 'orgId is required' });

    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Supervisor access required' });
    }

    const orgIds = userDoc.orgIds || (userDoc.orgId ? [userDoc.orgId] : []);
    if (!orgIds.includes(orgId)) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    await db.collection('users').updateOne(
      { _id: req.user.uid },
      { $set: { orgId, lastUpdated: new Date() } }
    );

    const org = await db.collection('organizations').findOne({ _id: new ObjectId(orgId) });
    res.json({ success: true, orgId, name: org?.name || '' });
  } catch (err) {
    console.error('Switch group error:', err);
    res.status(500).json({ error: 'Failed to switch group' });
  }
});

// ─── REST: Create Organization ──────────────────────────────────
app.post('/api/org/create', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Org name is required' });

    const inviteCode = Math.floor(100000 + Math.random() * 900000).toString();

    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });

    if (userDoc && userDoc.orgId) {
      return res.status(400).json({ error: 'You are already in an organization' });
    }

    const orgResult = await db.collection('organizations').insertOne({
      name,
      adminId: req.user.uid,
      inviteCode,
      members: [req.user.uid],
      createdAt: new Date(),
    });

    const orgId = orgResult.insertedId.toString();

    // Check if creator is an approved supervisor — tag group with institutionId
    const supRecord = await db.collection('approved_supervisors').findOne({
      email: (req.user.email || '').toLowerCase(),
      isActive: true
    });
    if (supRecord) {
      await db.collection('organizations').updateOne(
        { _id: orgResult.insertedId },
        { $set: { institutionId: supRecord.institutionId } }
      );
    }

    await db.collection('users').updateOne(
      { _id: req.user.uid },
      {
        $set: {
          orgId,
          role: 'admin',
          email: req.user.email || '',
          institutionId: supRecord?.institutionId || null,
          isOnline: false,
          currentMood: '',
          currentActivity: '',
          lastUpdated: new Date(),
        }
      },
      { upsert: true }
    );

    res.json({ orgId, inviteCode });
  } catch (err) {
    console.error('Create org error:', err);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

// ─── REST: Join Organization ────────────────────────────────────
app.post('/api/org/join', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { inviteCode } = req.body;
    if (!inviteCode) return res.status(400).json({ error: 'Invite code is required' });

    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });

    if (userDoc && userDoc.orgId) {
      return res.status(400).json({ error: 'You are already in an organization' });
    }

    const org = await db.collection('organizations').findOne({ inviteCode });

    if (!org) {
      return res.status(404).json({ error: 'Invalid invite code' });
    }

    const orgId = org._id.toString();

    await db.collection('users').updateOne(
      { _id: req.user.uid },
      {
        $set: {
          orgId,
          role: 'member',
          email: req.user.email || '',
          institutionId: org.institutionId || null,
          isOnline: false,
          currentMood: '',
          currentActivity: '',
          lastUpdated: new Date(),
        }
      },
      { upsert: true }
    );

    await db.collection('organizations').updateOne(
      { _id: org._id },
      { $addToSet: { members: req.user.uid } }
    );

    res.json({ orgId, orgName: org.name });
  } catch (err) {
    console.error('Join org error:', err);
    res.status(500).json({ error: 'Failed to join organization' });
  }
});

// ─── REST: Verify User Organization ─────────────────────────────
app.get('/api/user/verify-org', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const getManilaDateKey = (date = new Date()) => {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Manila',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).formatToParts(date);
      const year = parts.find(p => p.type === 'year')?.value;
      const month = parts.find(p => p.type === 'month')?.value;
      const day = parts.find(p => p.type === 'day')?.value;
      return `${year}-${month}-${day}`;
    };

    const todayKey = getManilaDateKey(new Date());
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getManilaDateKey(yesterday);

    const uid = req.user.uid;
    const email = req.user.email || '';
    // Firebase token includes picture (Google/Facebook profile photo) and name
    const photoURL = req.user.picture || '';
    const displayNameFromToken = req.user.name || '';

    // Step 1: Find or Create User
    let userDoc = await db.collection('users').findOne({ _id: uid });

    if (!userDoc) {
      console.log(`🆕 Creating new user record for ${email}`);
      const newUser = {
        _id: uid,
        email: email,
        displayName: displayNameFromToken,
        username: '',
        orgId: '',
        role: 'member',
        photoURL: photoURL,
        loginStreak: 1,
        lastLoginDate: todayKey,
        lastLoginAt: new Date(),
        isOnline: false,
        lastUpdated: new Date()
      };
      await db.collection('users').insertOne(newUser);
      userDoc = newUser;
    } else {
      // Always sync latest photoURL and displayName from Firebase token
      const updates = { lastUpdated: new Date() };
      if (photoURL && photoURL !== userDoc.photoURL) updates.photoURL = photoURL;
      if (displayNameFromToken && !userDoc.displayName) updates.displayName = displayNameFromToken;
      if (Object.keys(updates).length > 1) {
        await db.collection('users').updateOne({ _id: uid }, { $set: updates });
        userDoc = { ...userDoc, ...updates };
      }
    }

    // Step 1.5: Daily login streak (+1 max once per day, based on Asia/Manila date)
    const lastLoginDate = userDoc.lastLoginDate || null;
    let loginStreak = Number(userDoc.loginStreak) || 0;

    if (!lastLoginDate) {
      loginStreak = 1;
      const loginUpdates = {
        loginStreak,
        lastLoginDate: todayKey,
        lastLoginAt: new Date(),
        lastUpdated: new Date()
      };
      await db.collection('users').updateOne({ _id: uid }, { $set: loginUpdates });
      userDoc = { ...userDoc, ...loginUpdates };
    } else if (lastLoginDate !== todayKey) {
      if (lastLoginDate === yesterdayKey) {
        loginStreak += 1;
      } else {
        loginStreak = 1;
      }

      const loginUpdates = {
        loginStreak,
        lastLoginDate: todayKey,
        lastLoginAt: new Date(),
        lastUpdated: new Date()
      };
      await db.collection('users').updateOne({ _id: uid }, { $set: loginUpdates });
      userDoc = { ...userDoc, ...loginUpdates };
    } else if (loginStreak < 1) {
      // Backfill legacy users that already have today's date but missing/zero streak.
      loginStreak = 1;
      const loginUpdates = {
        loginStreak,
        lastLoginAt: new Date(),
        lastUpdated: new Date()
      };
      await db.collection('users').updateOne({ _id: uid }, { $set: loginUpdates });
      userDoc = { ...userDoc, ...loginUpdates };
    }

    // Step 2: Handle Org ID
    let orgId = userDoc.orgId || null;

    if (!orgId) {
      const org = await db.collection('organizations').findOne({ members: uid });
      if (org) {
        orgId = org._id.toString();
        await db.collection('users').updateOne(
          { _id: uid },
          { $set: { orgId } }
        );
      }
    }

    // Step 3: Check if User is Supervisor
    const supRecord = await db.collection('approved_supervisors').findOne({
      email: email.toLowerCase(),
      isActive: true
    });
    const isSupervisor = !!supRecord || userDoc.role === 'supervisor' || userDoc.role === 'admin';

    // Auto-sync Role/Institution for new/unmarked supervisors
    if (supRecord && (userDoc.role !== 'supervisor' && userDoc.role !== 'admin' || !userDoc.institutionId)) {
      await db.collection('users').updateOne(
        { _id: uid },
        {
          $set: {
            role: userDoc.role === 'admin' ? 'admin' : 'supervisor',
            institutionId: supRecord.institutionId
          }
        }
      );
    }

    res.json({
      orgId: orgId || null,
      isSupervisor: isSupervisor,
      institutionId: supRecord?.institutionId || userDoc.institutionId || null,
      hasUsername: !!(userDoc.username || userDoc.displayName),
      user: {
        uid,
        email,
        username: userDoc.username || '',
        displayName: userDoc.displayName || '',
        photoURL: userDoc.photoURL || '',
        avatarUrl: userDoc.avatarUrl || '',
        role: userDoc.role || 'member',
        loginStreak: Number(userDoc.loginStreak) || 0,
        lastLoginDate: userDoc.lastLoginDate || null
      }
    });
  } catch (err) {
    console.error('Verify org error:', err);
    res.status(500).json({ error: 'Failed to verify organization membership' });
  }
});

// ─── REST: List Notifications ─────────────────────────────────────
app.get('/api/notifications/list', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { orgId } = req.query;
    const uid = req.user.uid;
    if (!orgId) return res.status(400).json({ error: 'orgId is required' });

    const userDoc = await db.collection('users').findOne({ _id: uid });
    if (!userDoc || userDoc.orgId !== orgId) {
      return res.status(403).json({ error: 'Not authorized for this organization' });
    }
    const role = String(userDoc.role || '').toLowerCase();
    const isSupervisor = role === 'admin' || role === 'owner';

    // Fetch notifications for this org that are either team-level or belong to this user.
    // SOS is supervisor-only.
    const notifications = await db.collection('notifications')
      .find({
        orgId: orgId,
        $and: [
          {
            $or: [
              { targetUserId: { $exists: false } },
              { targetUserId: '' },
              { targetUserId: uid }
            ]
          }
        ],
        $or: [
          { userId: uid },
          ...(isSupervisor ? [{ type: 'sos' }] : []),
          { type: 'debriefing' },
          { category: 'team' },
          ...(isSupervisor ? [{ category: 'urgent' }] : [])
        ]
      })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    const notificationsData = notifications.map(n => ({
      ...n,
      id: n._id.toString(),
      _id: undefined
    }));

    res.json({ success: true, notifications: notificationsData });
  } catch (err) {
    console.error('List notifications error:', err);
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
});

// ─── REST: Clear Notifications ─────────────────────────────────────
app.post('/api/notifications/clear', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { orgId } = req.query;
    const uid = req.user.uid;
    if (!orgId) return res.status(400).json({ error: 'orgId is required' });

    const userDoc = await db.collection('users').findOne({ _id: uid });
    if (!userDoc || userDoc.orgId !== orgId) {
      return res.status(403).json({ error: 'Not authorized for this organization' });
    }
    const role = String(userDoc.role || '').toLowerCase();
    const isSupervisor = role === 'admin' || role === 'owner';

    const publicTypes = isSupervisor
      ? ['sos', 'debriefing', 'important_day', 'goal']
      : ['debriefing', 'important_day', 'goal'];
    await db.collection('notifications').deleteMany({
      orgId: orgId,
      $and: [
        {
          $or: [
            { targetUserId: { $exists: false } },
            { targetUserId: '' },
            { targetUserId: uid }
          ]
        }
      ],
      $or: [
        { userId: uid }, // Their personal ones
        { type: { $in: publicTypes } }, // Team/public types visible to this role
        { category: { $in: isSupervisor ? ['team', 'urgent'] : ['team'] } }
      ]
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Clear notifications error:', err);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// ─── REST: Check Username ───────────────────────────────────────
app.get('/api/user/check-username', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { username } = req.query;
    if (!username) return res.status(400).json({ error: 'Username is required' });

    const existing = await db.collection('users').findOne({ username: username.toLowerCase() });

    res.json({ available: !existing });
  } catch (err) {
    res.status(500).json({ error: 'Failed to check username' });
  }
});

app.post('/api/user/set-username', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { username } = req.body;
    const uid = req.user.uid;

    if (!username || username.length < 3) {
      return res.status(400).json({ error: 'Invalid username (min 3 chars)' });
    }

    const existing = await db.collection('users').findOne({ username: username.toLowerCase() });

    if (existing && existing._id !== uid) {
      return res.status(400).json({ error: 'Username already taken' });
    }

    await db.collection('users').updateOne(
      { _id: uid },
      {
        $set: {
          username: username.toLowerCase(),
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Set username error:', err);
    res.status(500).json({ error: 'Failed to set username' });
  }
});

// ─── REST: Set Avatar ───────────────────────────────────────────
app.post('/api/user/set-avatar', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { avatarUrl } = req.body;
    const uid = req.user.uid;

    await db.collection('users').updateOne(
      { _id: uid },
      {
        $set: {
          avatarUrl: avatarUrl || '',
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ success: true, avatarUrl: avatarUrl });
  } catch (err) {
    console.error('Set avatar error:', err);
    res.status(500).json({ error: 'Failed to set avatar' });
  }
});

// ─── REST: Store FCM Token ──────────────────────────────────────
app.post('/api/user/fcm-token', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const rawToken = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const uid = req.user.uid;

    if (!rawToken) {
      return res.status(400).json({ error: 'FCM token is required' });
    }
    if (rawToken.length < 32) {
      return res.status(400).json({ error: 'Invalid FCM token' });
    }

    await db.collection('users').updateOne(
      { _id: uid },
      {
        $set: {
          // Keep legacy single-token field for backward compatibility.
          fcmToken: rawToken,
          fcmTokenUpdatedAt: new Date()
        },
        // Multi-device reliability: do not overwrite existing active device tokens.
        $addToSet: {
          fcmTokens: rawToken
        },
      },
      { upsert: true }
    );

    res.json({ success: true, multiDevice: true });
  } catch (err) {
    console.error('Save FCM token error:', err);
    res.status(500).json({ error: 'Failed to save FCM token' });
  }
});

// ─── REST: Reminder Settings ────────────────────────────────────
app.post('/api/user/reminder-settings', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { enabled, time } = req.body;
    const uid = req.user.uid;

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'Invalid enabled value' });
    }

    if (time && !/^\d{2}:\d{2}$/.test(time)) {
      return res.status(400).json({ error: 'Invalid time format' });
    }

    const reminderSettings = {
      enabled,
      time: time || '09:00'
    };

    await db.collection('users').updateOne(
      { _id: uid },
      {
        $set: {
          reminderSettings,
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );

    res.json({ success: true, reminderSettings });
  } catch (err) {
    console.error('Update reminder settings error:', err);
    res.status(500).json({ error: 'Failed to update reminder settings' });
  }
});

// ─── REST: Make Supervisor ──────────────────────────────────────
app.post('/api/user/make-supervisor', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const uid = req.user.uid;

    await db.collection('users').updateOne(
      { _id: uid },
      {
        $set: {
          isSupervisor: true,
          role: 'supervisor',
          orgRole: 'supervisor',
          email: req.user.email || ''
        }
      },
      { upsert: true }
    );

    console.log(`👑 User ${req.user.email} set as supervisor`);
    res.json({ success: true, message: 'You are now a supervisor!' });
  } catch (err) {
    console.error('Make supervisor error:', err);
    res.status(500).json({ error: 'Failed to set supervisor status' });
  }
});

// ─── REST: Get Org Members ──────────────────────────────────────
app.get('/api/org/members', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const orgId = req.query.orgId;

    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    const fallbackOrgId = userDoc?.orgId || null;
    const activeOrgId = orgId || fallbackOrgId;

    if (!activeOrgId || activeOrgId === 'null' || activeOrgId.length !== 24) {
      return res.status(400).json({ error: 'User not in any organization or invalid Org ID' });
    }

    if (fallbackOrgId && activeOrgId !== fallbackOrgId) {
      return res.status(403).json({ error: 'Not a member of this organization' });
    }

    const members = await db.collection('users').find({ orgId: activeOrgId }).toArray();
    let org = await db.collection('organizations').findOne({ _id: new ObjectId(activeOrgId) });

    // Fix codes that are not 6 digits or non-numeric
    if (org && (!org.inviteCode || !/^\d{6}$/.test(org.inviteCode))) {
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      await db.collection('organizations').updateOne(
        { _id: new ObjectId(activeOrgId) },
        { $set: { inviteCode: newCode } }
      );
      org.inviteCode = newCode;
    }

    const membersData = members.map(doc => ({
      uid: doc._id,
      email: doc.email || '',
      displayName: doc.username || doc.displayName || doc.email || '',
      username: doc.username || '',
      photoURL: doc.photoURL || '',
      avatarUrl: doc.avatarUrl || '',
      role: doc.role || 'member',
      isOnline: doc.isOnline || false,
      currentMood: doc.currentMood || '',
      currentActivity: doc.currentActivity || '',
      lastUpdated: doc.lastUpdated || null
    }));

    res.json({
      org: {
        id: activeOrgId,
        name: org?.name || '',
        inviteCode: org?.inviteCode || '',
        membersCanInvite: org?.membersCanInvite || false
      },
      members: membersData,
    });
  } catch (err) {
    console.error('Get members error:', err);
    res.status(500).json({ error: 'Failed to get members' });
  }
});

// ─── REST: Get Mood Stats ───────────────────────────────────────
app.get('/api/org/mood-stats', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const orgId = req.query.orgId;
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    const fallbackOrgId = userDoc?.orgId || null;
    const activeOrgId = orgId || fallbackOrgId;

    if (!activeOrgId) return res.status(400).json({ error: 'User not in any organization' });

    const daysAgo = parseInt(req.query.days) || 7;
    const since = new Date();
    since.setDate(since.getDate() - daysAgo);

    const logs = await db.collection('mood_logs')
      .find({
        orgId: activeOrgId,
        timestamp: { $gte: since }
      })
      .sort({ timestamp: -1 })
      .limit(500)
      .toArray();

    const logsData = logs.map(d => ({
      mood: d.mood,
      activity: d.activity,
      userId: d.userId,
      timestamp: d.timestamp,
    }));

    res.json({ logs: logsData });
  } catch (err) {
    console.error('Mood stats error:', err);
    res.status(500).json({ error: 'Failed to get mood stats' });
  }
});

// ─── REST: Get Org Settings (Admin/Supervisor only) ──────────────
app.get('/api/org/settings', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });

    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Admin/Supervisor access required' });
    }

    if (!userDoc.orgId || userDoc.orgId.length !== 24) {
      return res.status(400).json({ error: 'Not in an organization or invalid Org ID' });
    }

    let org = await db.collection('organizations').findOne({ _id: new ObjectId(userDoc.orgId) });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    // Fix codes that are not 6 digits or non-numeric
    if (!org.inviteCode || !/^\d{6}$/.test(org.inviteCode)) {
      console.log(`🔧 Fixing invalid invite code for org ${org._id}`);
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      await db.collection('organizations').updateOne(
        { _id: org._id },
        { $set: { inviteCode: newCode } }
      );
      org.inviteCode = newCode;
    }

    res.json({
      orgCode: org.inviteCode,
      orgName: org.name || '',
      membersCanInvite: org.membersCanInvite || false,
      memberInviteCode: org.memberInviteCode || org.inviteCode
    });
  } catch (err) {
    console.error('Get org settings error:', err);
    res.status(500).json({ error: 'Failed to get organization settings' });
  }
});

// ─── REST: Register with Username ───────────────────────────────
// Creates a Firebase account using username@alwan.internal as synthetic email
app.post('/api/auth/register-username', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { username, password, recaptchaToken } = req.body;

    // Verify reCAPTCHA token
    if (recaptchaToken && process.env.RECAPTCHA_SECRET_KEY) {
      try {
        const verifyRes = await fetch(
          `https://www.google.com/recaptcha/api/siteverify?secret=${process.env.RECAPTCHA_SECRET_KEY}&response=${recaptchaToken}`,
          { method: 'POST' }
        );
        const verifyData = await verifyRes.json();
        if (!verifyData.success || verifyData.score < 0.5) {
          console.warn('reCAPTCHA failed:', verifyData);
          return res.status(400).json({ error: 'Bot detected. Please try again.' });
        }
      } catch (e) {
        console.warn('reCAPTCHA verification error (non-blocking):', e);
      }
    }

    if (!username || !/^[a-z0-9_]{3,20}$/.test(username.toLowerCase())) {
      return res.status(400).json({ error: 'Invalid username. Use 3-20 letters, numbers, or underscores.' });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    }

    const uname = username.toLowerCase();
    const syntheticEmail = `${uname}@alwan.internal`;

    // Check if username already taken
    const existing = await db.collection('users').findOne({ username: uname });
    if (existing) {
      return res.status(400).json({ error: 'Username already taken.' });
    }

    // Create Firebase user
    if (!firebaseAuth) {
      return res.status(500).json({ error: 'Firebase Auth not initialized on server.' });
    }
    const userRecord = await firebaseAuth.createUser({
      email: syntheticEmail,
      password,
      displayName: uname
    });

    // Create MongoDB user record
    await db.collection('users').insertOne({
      _id: userRecord.uid,
      email: syntheticEmail,
      username: uname,
      displayName: uname,
      orgId: '',
      role: 'member',
      isOnline: false,
      lastUpdated: new Date()
    });

    res.json({ success: true, uid: userRecord.uid, email: syntheticEmail });
  } catch (err) {
    console.error('Register username error:', err);
    if (err.code === 'auth/email-already-exists') {
      return res.status(400).json({ error: 'Username already taken.' });
    }
    res.status(500).json({ error: 'Registration failed. Please try again.' });
  }
});

// ─── REST: Lookup username → get synthetic email for Firebase login ──
app.post('/api/auth/lookup-username', async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { username } = req.body;
    if (!username) return res.status(400).json({ error: 'Username required' });

    const uname = username.toLowerCase();
    const user = await db.collection('users').findOne({ username: uname });

    if (!user) {
      return res.status(404).json({ error: 'Username not found.' });
    }

    // Return synthetic email so client can sign in via Firebase
    res.json({ email: user.email || `${uname}@alwan.internal` });
  } catch (err) {
    console.error('Lookup username error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ─── REST: Update Group Name ────────────────────────────────────
app.post('/api/org/update-name', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { name } = req.body;
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ error: 'Group name must be at least 2 characters' });
    }

    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    await db.collection('organizations').updateOne(
      { _id: new ObjectId(userDoc.orgId) },
      { $set: { name: name.trim() } }
    );

    res.json({ success: true, name: name.trim() });
  } catch (err) {
    console.error('Update group name error:', err);
    res.status(500).json({ error: 'Failed to update group name' });
  }
});

// ─── REST: Update Members Can Invite Toggle ─────────────────────
app.post('/api/org/settings/members-can-invite', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { enabled } = req.body;
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Admin/Supervisor access required' });
    }

    const org = await db.collection('organizations').findOne({ _id: new ObjectId(userDoc.orgId) });
    if (!org) return res.status(404).json({ error: 'Organization not found' });

    // Ensure memberInviteCode exists if enabled
    const updateData = { membersCanInvite: enabled };
    let finalMemberInviteCode = org.memberInviteCode || org.inviteCode;

    if (enabled && !org.memberInviteCode) {
      updateData.memberInviteCode = org.inviteCode;
      finalMemberInviteCode = org.inviteCode;
    }

    await db.collection('organizations').updateOne(
      { _id: org._id },
      { $set: updateData }
    );

    res.json({
      success: true,
      membersCanInvite: enabled,
      memberInviteCode: finalMemberInviteCode
    });
  } catch (err) {
    console.error('Update invite setting error:', err);
    res.status(500).json({ error: 'Failed to update invite setting' });
  }
});

// ─── REST: Make Admin ───────────────────────────────────────────
app.post('/api/org/make-admin', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { uid } = req.body;
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });

    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Admin/Supervisor access required' });
    }

    const targetUser = await db.collection('users').findOne({ _id: uid });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.orgId !== userDoc.orgId) return res.status(403).json({ error: 'User is not in your organization' });

    await db.collection('users').updateOne(
      { _id: uid },
      { $set: { role: 'admin' } }
    );

    res.json({ success: true, message: 'User promoted to admin' });
  } catch (err) {
    console.error('Make admin error:', err);
    res.status(500).json({ error: 'Failed to promote member' });
  }
});

// ─── REST: Remove Member ────────────────────────────────────────
app.post('/api/org/remove-member', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { uid } = req.body;
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });

    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Admin/Supervisor access required' });
    }

    const targetUser = await db.collection('users').findOne({ _id: uid });
    if (!targetUser) return res.status(404).json({ error: 'User not found' });
    if (targetUser.orgId !== userDoc.orgId) return res.status(403).json({ error: 'User is not in your organization' });
    if (targetUser.role === 'admin' && userDoc.role !== 'supervisor') {
      return res.status(403).json({ error: 'Only supervisors can remove other admins' });
    }

    await db.collection('users').updateOne(
      { _id: uid },
      { $set: { orgId: null, role: 'member' } } // Clear org relationship
    );

    const updateResult = await db.collection('organizations').findOneAndUpdate(
      { _id: new ObjectId(userDoc.orgId) },
      { $pull: { members: uid } },
      { returnDocument: 'after' }
    );

    // If org is now empty, delete it and its data
    if (updateResult && (!updateResult.members || updateResult.members.length === 0)) {
      console.log(`🧹 Cleaning up empty organization: ${userDoc.orgId}`);
      await cleanupOrgData(userDoc.orgId);
    }

    // Emit event to notify the room
    const adminDisplayName = userDoc.username || userDoc.displayName || userDoc.email || 'an administrator';
    console.log(`📢 Emitting removal event - Admin: ${adminDisplayName}, Removed user: ${uid}`);

    io.to(`org_${userDoc.orgId}`).emit('member:removed', {
      uid,
      orgId: userDoc.orgId,
      adminName: adminDisplayName
    });

    // Hard Sever: Find the target user's active sockets and disconnect them
    try {
      const activeSockets = await io.fetchSockets();
      for (const s of activeSockets) {
        if (s.userId === uid) {
          console.log(`🔌 Notifying and disconnecting removed user: ${uid} by ${adminDisplayName}`);
          s.emit('you:removed', { adminName: adminDisplayName });
          // Short delay to ensure the event is sent/received before TCP close
          setTimeout(() => s.disconnect(true), 1500);
        }
      }
    } catch (sockErr) {
      console.warn('Socket severance error:', sockErr);
    }

    res.json({ success: true, message: 'Member removed from organization' });
  } catch (err) {
    console.error('Remove member error:', err);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// Helper to delete all data related to an organization
async function cleanupOrgData(orgId) {
  try {
    const orgOid = new ObjectId(orgId);
    await Promise.all([
      db.collection('organizations').deleteOne({ _id: orgOid }),
      db.collection('mood_logs').deleteMany({ orgId: orgId }),
      db.collection('team_goals').deleteMany({ orgId: orgId }),
      db.collection('debriefings').deleteMany({ orgId: orgId }),
      db.collection('sosAlerts').deleteMany({ orgId: orgId }),
      db.collection('feed_entries').deleteMany({ orgId: orgId }) // If this collection exists
    ]);
    console.log(`✅ Data for organization ${orgId} wiped.`);
  } catch (err) {
    console.error(`❌ Error cleaning up org ${orgId}:`, err);
  }
}

// ─── REST: Leave Organization ───────────────────────────────────
app.post('/api/org/leave', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const uid = req.user.uid;
    const userDoc = await db.collection('users').findOne({ _id: uid });

    if (!userDoc || !userDoc.orgId) {
      return res.status(400).json({ error: 'You are not in an organization' });
    }

    const orgId = userDoc.orgId;

    await db.collection('users').updateOne(
      { _id: uid },
      { $set: { orgId: null, role: 'member' } }
    );

    await db.collection('organizations').updateOne(
      { _id: new ObjectId(orgId) },
      { $pull: { members: uid } }
    );

    // Check remaining members from users collection (source of truth)
    const remainingMembers = await db.collection('users').countDocuments({ orgId });

    if (remainingMembers === 0) {
      console.log(`🧹 Cleaning up empty organization: ${orgId}`);
      await cleanupOrgData(orgId);
    }

    // Notify room
    io.to(`org_${orgId}`).emit('member:left', { uid, email: req.user.email });

    res.json({ success: true, message: 'You have left the organization' });
  } catch (err) {
    console.error('Leave org error:', err);
    res.status(500).json({ error: 'Failed to leave organization' });
  }
});

// ─── REST: Get Team Stats (Admin/Supervisor only) ───────────────
app.get('/api/org/team-stats', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const range = req.query.range || '7';
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });

    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Admin/Supervisor access required' });
    }

    const orgId = userDoc.orgId;
    if (!orgId) return res.status(400).json({ error: 'Not in an organization' });

    let since = new Date();
    if (range === '7') since.setDate(since.getDate() - 7);
    else if (range === '30') since.setDate(since.getDate() - 30);
    else if (range === 'all') since = new Date(0);
    else since.setDate(since.getDate() - parseInt(range));

    const logs = await db.collection('mood_logs')
      .find({ orgId: orgId, timestamp: { $gte: since } })
      .toArray();

    const members = await db.collection('users').find({ orgId }).toArray();

    // Aggregate stats
    const totalEntries = logs.length;
    const uniqueActiveMembers = new Set(logs.map(l => l.userId)).size;

    // Mood distribution
    const moodDistribution = {};
    logs.forEach(l => {
      moodDistribution[l.moodLabel] = (moodDistribution[l.moodLabel] || 0) + 1;
    });

    // Top activities
    const activityMap = {};
    logs.forEach(l => {
      if (l.activity) activityMap[l.activity] = (activityMap[l.activity] || 0) + 1;
      if (l.activities && Array.isArray(l.activities)) {
        l.activities.forEach(a => activityMap[a] = (activityMap[a] || 0) + 1);
      }
    });
    const topActivities = Object.entries(activityMap)
      .map(([activity, count]) => ({ activity, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    // Mood trend (by date)
    const moodTrend = {};
    logs.forEach(l => {
      const dateKey = l.timestamp.toISOString().split('T')[0];
      if (!moodTrend[dateKey]) moodTrend[dateKey] = { sum: 0, count: 0 };

      // Map mood to value (approximate if not explicit)
      let val = 3;
      if (l.moodColor === 'var(--mood-radiant)') val = 5;
      else if (l.moodColor === 'var(--mood-happy)') val = 4;
      else if (l.moodColor === 'var(--mood-neutral)') val = 3;
      else if (l.moodColor === 'var(--mood-moody)') val = 2;
      else if (l.moodColor === 'var(--mood-low)') val = 1;

      moodTrend[dateKey].sum += val;
      moodTrend[dateKey].count++;
    });

    const moodData = {};
    Object.entries(moodTrend).forEach(([date, data]) => {
      moodData[date] = data.sum / data.count;
    });

    // Member Breakdown
    const memberBreakdown = members.map(m => {
      const userLogs = logs.filter(l => l.userId === m._id);
      return {
        uid: m._id,
        name: m.username || m.displayName || m.email || 'User',
        email: m.email || '',
        avatarUrl: m.avatarUrl || '',
        entryCount: userLogs.length,
        streakCount: m.streak || 0,
        lastActive: userLogs.length > 0 ? userLogs[0].timestamp : null
      };
    });

    res.json({
      totalEntries,
      avgEntriesPerDay: totalEntries / (range === 'all' ? 365 : parseInt(range)),
      activeMembers: uniqueActiveMembers,
      totalMembers: members.length,
      teamStreak: members.reduce((acc, m) => acc + (m.streak || 0), 0),
      memberBreakdown,
      moodData,
      moodDistribution,
      topActivities
    });
  } catch (err) {
    console.error('Get team stats error:', err);
    res.status(500).json({ error: 'Failed to get team stats' });
  }
});

// ─── REST: Export Team Data ─────────────────────────────────────
app.get('/api/org/export', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const format = req.query.format || 'csv';
    const debriefingId = req.query.debriefingId;

    if (!debriefingId) {
      return res.status(400).json({ error: 'Please select an evaluation to export results.' });
    }

    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
      return res.status(403).json({ error: 'Admin/Supervisor access required' });
    }

    const orgId = userDoc.orgId;
    if (!orgId) return res.status(400).json({ error: 'Not in an organization' });

    // Fetch the specific debriefing
    const debriefing = await db.collection('debriefings').findOne({
      _id: new ObjectId(debriefingId),
      orgId: orgId
    });

    if (!debriefing) {
      return res.status(404).json({ error: 'Evaluation not found' });
    }

    if (!debriefing.evaluationResponses || Object.keys(debriefing.evaluationResponses).length === 0) {
      return res.status(400).json({ error: 'No responses to export yet.' });
    }

    if (format === 'csv') {
      const questions = debriefing.evaluationForm?.questions || [];
      const responses = debriefing.evaluationResponses;

      // Build Headers
      let headers = ['User', 'Date Submitted'];
      questions.forEach(q => {
        // Clean question text for header
        const cleanText = q.text.replace(/,/g, '').substring(0, 50);
        headers.push(`"${cleanText}"`);
      });
      headers.push('"Overall Reflection"');
      headers.push('"Improvements/Feedback"');

      let csv = headers.join(',') + '\n';

      // Build Rows
      Object.entries(responses).forEach(([uid, r]) => {
        const username = r.username || uid.replace(/_/g, '.').split('@')[0];
        const date = r.timestamp ? new Date(r.timestamp).toISOString().split('T')[0] : 'N/A';

        let row = [`"${username}"`, `"${date}"`];

        questions.forEach(q => {
          let val = r.responses?.[q.id] || '';
          // Escape quotes and wrap in quotes
          val = String(val).replace(/"/g, '""');
          row.push(`"${val}"`);
        });

        // Reflection
        let ref = r.reflection || '';
        ref = String(ref).replace(/"/g, '""');
        row.push(`"${ref}"`);

        // Feedback
        let feed = r.feedback || '';
        feed = String(feed).replace(/"/g, '""');
        row.push(`"${feed}"`);

        csv += row.join(',') + '\n';
      });

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=Evaluation_Results_${debriefing.date}.csv`);
      return res.send(csv);
    } else {
      res.status(400).json({ error: 'PDF format is under development. Please use CSV to download results.' });
    }
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: 'Failed to export evaluation results' });
  }
});


// ─── REST: Get Calendar Logs ────────────────────────────────────
app.get('/api/user/calendar-logs', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const logs = await db.collection('mood_logs')
      .find({ userId: req.user.uid })
      .sort({ timestamp: -1 })
      .toArray();

    const logsData = logs.map(d => ({
      id: d._id.toString(),
      mood: d.mood,
      activity: d.activity || '',
      note: d.note || '',
      timestamp: d.timestamp,
    }));

    res.json({ logs: logsData });
  } catch (err) {
    console.error('Calendar logs error:', err);
    res.status(500).json({ error: 'Failed to get calendar logs' });
  }
});

// ─── REST: Delete Mood Entry ────────────────────────────────────
app.delete('/api/mood/delete', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { entryId } = req.body;

    if (!entryId) {
      return res.status(400).json({ error: 'Entry ID is required' });
    }

    const entry = await db.collection('mood_logs').findOne({ _id: new ObjectId(entryId) });

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    if (entry.userId !== req.user.uid) {
      return res.status(403).json({ error: 'You can only delete your own entries' });
    }

    await db.collection('mood_logs').deleteOne({ _id: new ObjectId(entryId) });

    res.json({ success: true, message: 'Entry deleted successfully' });
  } catch (err) {
    console.error('Delete entry error:', err);
    res.status(500).json({ error: 'Failed to delete entry' });
  }
});

// ─── REST: Update Mood Entry ────────────────────────────────────
app.put('/api/mood/update', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { entryId, mood, moodLabel, moodEmoji, moodColor, activity, note, timestamp, activities, emotions } = req.body;

    if (!entryId) {
      return res.status(400).json({ error: 'Entry ID is required' });
    }

    const entry = await db.collection('mood_logs').findOne({ _id: new ObjectId(entryId) });

    if (!entry) {
      return res.status(404).json({ error: 'Entry not found' });
    }

    if (entry.userId !== req.user.uid) {
      return res.status(403).json({ error: 'You can only edit your own entries' });
    }

    const updateData = {
      mood: mood || entry.mood,
      moodLabel: moodLabel || entry.moodLabel,
      moodEmoji: moodEmoji || entry.moodEmoji,
      moodColor: moodColor || entry.moodColor,
      activity: activity !== undefined ? activity : entry.activity,
      note: note !== undefined ? note : entry.note,
    };

    if (activities) updateData.activities = activities;
    if (emotions) updateData.emotions = emotions;
    if (timestamp) updateData.timestamp = new Date(timestamp);

    await db.collection('mood_logs').updateOne(
      { _id: new ObjectId(entryId) },
      { $set: updateData }
    );

    res.json({ success: true, message: 'Entry updated successfully' });
  } catch (err) {
    console.error('Update entry error:', err);
    res.status(500).json({ error: 'Failed to update entry' });
  }
});

// Continue in next message due to length...

// ─── REST: Create Goal ──────────────────────────────────────────
app.post('/api/goals/create', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { title, description, type, orgId, reminderFrequency, reminderDays, reminderTime } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Goal title is required' });
    }

    const goalData = {
      title,
      description: description || '',
      type: type || 'personal',
      orgId: orgId || '',
      userId: req.user.uid,
      userName: req.user.name || req.user.email,
      reminderFrequency: reminderFrequency || null,
      reminderDays: reminderDays || [],
      reminderTime: reminderTime || null,
      userNotificationSettings: reminderFrequency ? {
        [req.user.uid]: { enabled: true }
      } : {},
      createdAt: new Date(),
    };

    const result = await db.collection('goals').insertOne(goalData);

    if (type === 'team' && orgId) {
      const roomName = `org_${orgId}`;
      io.to(roomName).emit('new_team_goal', {
        id: result.insertedId.toString(),
        ...goalData
      });
    }

    res.json({ success: true, goalId: result.insertedId.toString() });
  } catch (err) {
    console.error('Create goal error:', err);
    res.status(500).json({ error: 'Failed to create goal' });
  }
});

// ─── REST: Get Goals ────────────────────────────────────────────
app.get('/api/goals/list', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { orgId, type } = req.query;
    let goals = [];

    if (type === 'personal') {
      goals = await db.collection('goals')
        .find({ userId: req.user.uid, type: 'personal' })
        .sort({ createdAt: -1 })
        .toArray();
    } else if (type === 'team' && orgId) {
      goals = await db.collection('goals')
        .find({ orgId, type: 'team' })
        .sort({ createdAt: -1 })
        .toArray();
    } else if (orgId) {
      const [personal, team] = await Promise.all([
        db.collection('goals').find({ userId: req.user.uid, type: 'personal' }).toArray(),
        db.collection('goals').find({ orgId, type: 'team' }).toArray()
      ]);
      goals = [...personal, ...team].sort((a, b) => b.createdAt - a.createdAt);
    }

    const goalsData = goals.map(g => ({
      id: g._id.toString(),
      ...g,
      _id: undefined
    }));

    res.json({ goals: goalsData });
  } catch (err) {
    console.error('Get goals error:', err);
    res.status(500).json({ error: 'Failed to get goals' });
  }
});

// ─── REST: Delete Goal ──────────────────────────────────────────
app.delete('/api/goals/delete', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { goalId } = req.body;

    if (!goalId) {
      return res.status(400).json({ error: 'Goal ID is required' });
    }

    const goal = await db.collection('goals').findOne({ _id: new ObjectId(goalId) });

    if (!goal) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    if (goal.userId !== req.user.uid) {
      return res.status(403).json({ error: 'You can only delete your own goals' });
    }

    await db.collection('goals').deleteOne({ _id: new ObjectId(goalId) });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete goal error:', err);
    res.status(500).json({ error: 'Failed to delete goal' });
  }
});

// ─── REST: Create Important Day ─────────────────────────────────
app.post('/api/important-days/create', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { title, date, time, notes, orgId, type, emoji, color, reminderBefore } = req.body;

    if (!title || !date) {
      return res.status(400).json({ error: 'Title and date are required' });
    }

    const dayData = {
      title: String(title),
      date: String(date),
      time: time || null,
      type: type || 'personal',
      emoji: emoji || '🎉',
      color: color || '#ec4899',
      notes: notes || '',
      orgId: orgId || '',
      userId: req.user.uid,
      userName: req.user.name || req.user.email || 'Unknown',
      reminderBefore: reminderBefore || null,
      createdAt: new Date(),
    };

    const result = await db.collection('importantDays').insertOne(dayData);

    res.json({ success: true, dayId: result.insertedId.toString() });
  } catch (err) {
    console.error('Create important day error:', err);
    res.status(500).json({ error: 'Failed to create important day' });
  }
});

// ─── REST: Get Important Days ───────────────────────────────────
app.get('/api/important-days/list', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const orgId = req.query.orgId || '';
    const type = req.query.type || 'personal';
    const uid = req.user.uid;

    let days = [];

    if (type === 'team' && orgId) {
      days = await db.collection('importantDays')
        .find({ orgId, type: 'team' })
        .toArray();
    } else {
      days = await db.collection('importantDays')
        .find({ userId: uid, type: 'personal' })
        .toArray();
    }

    days.sort((a, b) => new Date(a.date) - new Date(b.date));

    const daysData = days.map(d => ({
      id: d._id.toString(),
      title: d.title || '',
      date: d.date || '',
      time: d.time || null,
      notes: d.notes || '',
      type: d.type || 'personal',
      emoji: d.emoji || '🎉',
      color: d.color || '#ec4899',
      userName: d.userName || '',
      userId: d.userId || '',
      orgId: d.orgId || '',
      reminderBefore: d.reminderBefore || null,
    }));

    res.json({ days: daysData });
  } catch (err) {
    console.error('Get important days error:', err);
    res.status(500).json({ error: 'Failed to get important days' });
  }
});

// ─── REST: Delete Important Day ─────────────────────────────────
app.post('/api/important-days/delete', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { dayId } = req.body;
    if (!dayId) return res.status(400).json({ error: 'Day ID is required' });

    const day = await db.collection('importantDays').findOne({ _id: new ObjectId(dayId) });
    if (!day) return res.status(404).json({ error: 'Event not found' });

    if (day.userId !== req.user.uid) {
      return res.status(403).json({ error: 'You can only delete your own events' });
    }

    await db.collection('importantDays').deleteOne({ _id: new ObjectId(dayId) });

    res.json({ success: true });
  } catch (err) {
    console.error('Delete important day error:', err);
    res.status(500).json({ error: 'Failed to delete important day' });
  }
});

// ─── REST: Create Debriefing ────────────────────────────────────
app.post('/api/debriefings/create', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { title, date, time, description, meetingLink, orgId, visibility, members, sourceRequestId } = req.body;

    if (!title || !date || !time || !orgId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const debriefingData = {
      title,
      date,
      time,
      description: description || '',
      meetingLink: meetingLink || '',
      orgId,
      visibility: visibility || 'all',
      members: visibility === 'specific' ? (members || []) : [],
      rsvpResponses: {},
      createdBy: req.user.uid,
      createdAt: new Date()
    };

    const result = await db.collection('debriefings').insertOne(debriefingData);
    const createdDebriefingId = result.insertedId.toString();

    try {
      const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
      const userName = userDoc?.username || userDoc?.displayName || req.user.email || 'Someone';

      const sessionDate = new Date(`${date}T${time}`);
      const dateStr = sessionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      const timeStr = sessionDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

      const isSpecificVisibility = visibility === 'specific' && Array.isArray(members);
      const notifyUserIds = isSpecificVisibility
        ? [...new Set((members || []).filter(m => typeof m === 'string' && m.trim() && m !== req.user.uid))]
        : [];

      if (isSpecificVisibility) {
        for (const targetUserId of notifyUserIds) {
          io.to(`org_${orgId}`).emit('debriefing:scheduled', {
            id: createdDebriefingId,
            title,
            date,
            time,
            dateStr,
            timeStr,
            description: description || '',
            meetingLink: meetingLink || '',
            scheduledBy: userName,
            targetUserId,
            timestamp: Date.now()
          });
        }
      } else {
        io.to(`org_${orgId}`).emit('debriefing:scheduled', {
          id: createdDebriefingId,
          title,
          date,
          time,
          dateStr,
          timeStr,
          description: description || '',
          meetingLink: meetingLink || '',
          scheduledBy: userName,
          timestamp: Date.now()
        });
      }

      // Create persistent notification for the log
      if (isSpecificVisibility) {
        if (notifyUserIds.length > 0) {
          const notifDocs = notifyUserIds.map((targetUserId) => ({
            orgId: orgId,
            userId: targetUserId,
            targetUserId,
            userName: userName,
            title: 'New Debriefing Scheduled',
            body: `A new session "${title}" is scheduled for ${dateStr} at ${timeStr}.`,
            type: 'debriefing',
            category: 'event',
            audience: 'targeted_member',
            linkId: result.insertedId.toString(),
            timestamp: new Date()
          }));
          const notifInsert = await db.collection('notifications').insertMany(notifDocs);
          const insertedIds = Object.values(notifInsert.insertedIds || {});
          notifDocs.forEach((doc, idx) => {
            io.to(`org_${orgId}`).emit('new_group_notification', {
              id: insertedIds[idx] ? insertedIds[idx].toString() : `${doc.targetUserId}_${Date.now()}_${idx}`,
              ...doc
            });
          });
        }
      } else {
        const notifData = {
          orgId: orgId,
          userId: req.user.uid,
          userName: userName,
          title: 'New Debriefing Scheduled',
          body: `A new session "${title}" is scheduled for ${dateStr} at ${timeStr}.`,
          type: 'debriefing',
          category: 'event',
          linkId: result.insertedId.toString(),
          timestamp: new Date()
        };
        const notifResult = await db.collection('notifications').insertOne(notifData);
        io.to(`org_${orgId}`).emit('new_group_notification', {
          id: notifResult.insertedId.toString(),
          ...notifData
        });
      }

      // Firebase Cloud Messaging (Push Notifications)
      if (firebaseAuth && orgId && typeof admin !== 'undefined') {
        try {
          const pushQuery = isSpecificVisibility
            ? { orgId: orgId, _id: { $in: notifyUserIds } }
            : { orgId: orgId };
          await sendPushToUsers({
            query: pushQuery,
            excludeUserId: req.user.uid,
            notification: {
              title: 'New Debriefing Scheduled',
              body: `A new session "${title}" is scheduled for ${dateStr} at ${timeStr}.`
            },
            data: {
              type: 'debriefing',
              linkId: result.insertedId.toString(),
              userName: userName || ''
            },
            logLabel: 'Sent FCM Session push notifications'
          });
        } catch (fcmErr) {
          console.error('FCM Session Push Notification error:', fcmErr);
        }
      }

    } catch (err) {
      console.error('Failed to emit socket event:', err);
    }


    // If this session is created from a member request, auto-approve that request.
    if (sourceRequestId) {
      try {
        const requestOid = new ObjectId(sourceRequestId);
        const reviewAt = new Date();
        const reviewResult = await db.collection('debriefing_requests').findOneAndUpdate(
          { _id: requestOid, orgId, status: 'pending' },
          {
            $set: {
              status: 'approved',
              reviewedBy: req.user.uid,
              reviewedAt: reviewAt,
              linkedDebriefingId: createdDebriefingId,
              updatedAt: reviewAt
            }
          },
          { returnDocument: 'after' }
        );

        if (reviewResult?.value) {
          const requestData = {
            ...reviewResult.value,
            id: reviewResult.value._id.toString(),
            _id: undefined
          };
          io.to(`org_${orgId}`).emit('debriefing_request_updated', {
            action: 'approved',
            request: requestData
          });

          // Reminder notification for requester when auto-approved through scheduling flow
          try {
            const reviewerDoc = await db.collection('users').findOne({ _id: req.user.uid });
            const reviewerName = reviewerDoc?.username || reviewerDoc?.displayName || req.user.email || 'Supervisor';
            const sessionDate = new Date(`${date}T${time}`);
            const sessionDateStr = sessionDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const sessionTimeStr = sessionDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
            const requesterNotif = {
              orgId,
              userId: requestData.requesterUid || '',
              targetUserId: requestData.requesterUid || '',
              userName: reviewerName,
              title: 'Session request approved',
              body: `${reviewerName} approved your request and scheduled "${title}" on ${sessionDateStr} at ${sessionTimeStr}.`,
              type: 'debriefing_request',
              category: 'event',
              audience: 'requester',
              action: 'approved',
              linkId: createdDebriefingId,
              timestamp: reviewAt
            };
            const requesterNotifRes = await db.collection('notifications').insertOne(requesterNotif);
            io.to(`org_${orgId}`).emit('new_group_notification', {
              id: requesterNotifRes.insertedId.toString(),
              ...requesterNotif
            });
          } catch (notifErr) {
            console.error('Failed to create requester notification for auto-approved request:', notifErr);
          }
        }
      } catch (requestErr) {
        console.error('Failed to approve debriefing request after session create:', requestErr);
      }
    }

    res.json({ success: true, id: createdDebriefingId });
  } catch (err) {
    console.error('Create debriefing error:', err);
    res.status(500).json({ error: 'Failed to create debriefing' });
  }
});

// ─── REST: Update Debriefing ────────────────────────────────────

// --- REST: Create Debriefing Request (Member) -------------------------
app.post('/api/debriefings/request', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { orgId, description, preferredDate, preferredTime, anytime } = req.body;
    const uid = req.user.uid;

    if (!orgId) return res.status(400).json({ error: 'Missing orgId' });
    if (!description || !description.trim()) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const userDoc = await db.collection('users').findOne({ _id: uid });
    if (!userDoc || userDoc.orgId !== orgId) {
      return res.status(403).json({ error: 'Not authorized for this organization' });
    }

    const role = String(userDoc.role || '').toLowerCase();
    const isManager = role === 'admin' || role === 'owner';
    if (isManager) {
      return res.status(400).json({ error: 'Admins/owners should create sessions directly' });
    }

    const isAnytime = !!anytime;
    if (!isAnytime && (!preferredDate || !preferredTime)) {
      return res.status(400).json({ error: 'Preferred date and time are required unless set to Anytime' });
    }

    const now = new Date();
    const requestDoc = {
      orgId,
      requesterUid: uid,
      requesterName: userDoc.username || userDoc.displayName || req.user.email || 'Member',
      requesterAvatar: userDoc.avatarUrl || userDoc.photoURL || '',
      description: description.trim(),
      preferredDate: isAnytime ? '' : String(preferredDate),
      preferredTime: isAnytime ? '' : String(preferredTime),
      anytime: isAnytime,
      status: 'pending',
      createdAt: now,
      updatedAt: now
    };

    const result = await db.collection('debriefing_requests').insertOne(requestDoc);
    const createdRequest = { ...requestDoc, id: result.insertedId.toString() };

    io.to(`org_${orgId}`).emit('debriefing_request_updated', {
      action: 'created',
      request: createdRequest
    });

    // Reminder notification for supervisors/admins: "username requested a session"
    try {
      const preferredText = createdRequest.anytime
        ? 'Anytime'
        : `${createdRequest.preferredDate || '-'} ${createdRequest.preferredTime || ''}`.trim();
      const managerNotif = {
        orgId,
        userId: uid,
        userName: createdRequest.requesterName || 'Member',
        title: `${createdRequest.requesterName || 'Member'} requested a session`,
        body: `${createdRequest.description || 'No details provided.'} Preferred: ${preferredText}.`,
        type: 'debriefing_request',
        category: 'team',
        audience: 'manager',
        linkId: result.insertedId.toString(),
        timestamp: now
      };
      const managerNotifRes = await db.collection('notifications').insertOne(managerNotif);
      io.to(`org_${orgId}`).emit('new_group_notification', {
        id: managerNotifRes.insertedId.toString(),
        ...managerNotif
      });
    } catch (notifErr) {
      console.error('Failed to create manager debriefing-request notification:', notifErr);
    }

    res.json({ success: true, request: createdRequest });
  } catch (err) {
    console.error('Create debriefing request error:', err);
    res.status(500).json({ error: 'Failed to submit debriefing request' });
  }
});

// --- REST: List Debriefing Requests -----------------------------------
app.get('/api/debriefings/requests', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { orgId, status } = req.query;
    const uid = req.user.uid;
    if (!orgId) return res.status(400).json({ error: 'Missing orgId' });

    const userDoc = await db.collection('users').findOne({ _id: uid });
    if (!userDoc || userDoc.orgId !== orgId) {
      return res.status(403).json({ error: 'Not authorized for this organization' });
    }

    const role = String(userDoc.role || '').toLowerCase();
    const isManager = role === 'admin' || role === 'owner';

    const query = { orgId };
    if (status) query.status = status;
    else if (isManager) query.status = 'pending';

    if (!isManager) {
      query.requesterUid = uid;
    }

    const items = await db.collection('debriefing_requests')
      .find(query)
      .sort({ createdAt: -1 })
      .toArray();

    const requests = items.map(r => ({
      ...r,
      id: r._id.toString(),
      _id: undefined
    }));

    res.json({ success: true, requests });
  } catch (err) {
    console.error('List debriefing requests error:', err);
    res.status(500).json({ error: 'Failed to load debriefing requests' });
  }
});

// --- REST: Review Debriefing Request (Admin/Owner) --------------------
app.post('/api/debriefings/requests/review', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { requestId, orgId, action, linkedDebriefingId } = req.body;
    const uid = req.user.uid;
    if (!requestId || !orgId || !action) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    if (!['approved', 'rejected'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const userDoc = await db.collection('users').findOne({ _id: uid });
    const role = String(userDoc?.role || '').toLowerCase();
    const isManager = role === 'admin' || role === 'owner';
    if (!isManager || userDoc?.orgId !== orgId) {
      return res.status(403).json({ error: 'Only admins/owners can review requests' });
    }

    const requestOid = new ObjectId(requestId);
    const now = new Date();
    const updatePayload = {
      status: action,
      reviewedBy: uid,
      reviewedAt: now,
      updatedAt: now
    };
    if (linkedDebriefingId) {
      updatePayload.linkedDebriefingId = linkedDebriefingId;
    }

    const result = await db.collection('debriefing_requests').findOneAndUpdate(
      { _id: requestOid, orgId, status: 'pending' },
      { $set: updatePayload },
      { returnDocument: 'after' }
    );

    if (!result?.value) {
      return res.status(404).json({ error: 'Request not found or already reviewed' });
    }

    const requestData = {
      ...result.value,
      id: result.value._id.toString(),
      _id: undefined
    };
    io.to(`org_${orgId}`).emit('debriefing_request_updated', {
      action,
      request: requestData
    });

    // Reminder notification for requester: approved/rejected with details
    try {
      const reviewerDoc = await db.collection('users').findOne({ _id: uid });
      const reviewerName = reviewerDoc?.username || reviewerDoc?.displayName || req.user.email || 'Supervisor';
      const preferredText = requestData.anytime
        ? 'Anytime'
        : `${requestData.preferredDate || '-'} ${requestData.preferredTime || ''}`.trim();
      const isApproved = action === 'approved';
      const requesterNotif = {
        orgId,
        userId: requestData.requesterUid || '',
        targetUserId: requestData.requesterUid || '',
        userName: reviewerName,
        title: isApproved ? 'Session request approved' : 'Session request rejected',
        body: isApproved
          ? `${reviewerName} approved your session request. Preferred: ${preferredText}.`
          : `${reviewerName} rejected your session request. Preferred: ${preferredText}.`,
        type: 'debriefing_request',
        category: 'event',
        audience: 'requester',
        action,
        linkId: requestData.id || requestId,
        timestamp: now
      };
      const requesterNotifRes = await db.collection('notifications').insertOne(requesterNotif);
      io.to(`org_${orgId}`).emit('new_group_notification', {
        id: requesterNotifRes.insertedId.toString(),
        ...requesterNotif
      });
    } catch (notifErr) {
      console.error('Failed to create requester debriefing-review notification:', notifErr);
    }

    res.json({ success: true, request: requestData });
  } catch (err) {
    console.error('Review debriefing request error:', err);
    res.status(500).json({ error: 'Failed to review debriefing request' });
  }
});
app.post('/api/debriefings/update', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { debriefingId, title, date, time, description, meetingLink, orgId, visibility, members } = req.body;

    if (!debriefingId || !title || !date || !time || !orgId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existing = await db.collection('debriefings').findOne({ _id: new ObjectId(debriefingId) });
    if (!existing) return res.status(404).json({ error: 'Debriefing not found' });

    await db.collection('debriefings').updateOne(
      { _id: new ObjectId(debriefingId) },
      {
        $set: {
          title,
          date,
          time,
          description: description || '',
          meetingLink: meetingLink || '',
          visibility: visibility || 'all',
          members: visibility === 'specific' ? (members || []) : [],
          updatedAt: new Date()
        }
      }
    );

    io.to(`org_${orgId}`).emit('debriefing_updated', { action: 'updated', orgId });

    res.json({ success: true });
  } catch (err) {
    console.error('Update debriefing error:', err);
    res.status(500).json({ error: 'Failed to update debriefing' });
  }
});

// ─── REST: Get Debriefings ──────────────────────────────────────
app.post('/api/debriefings/rsvp', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { debriefingId, orgId, status } = req.body;
    const uid = req.user.uid;

    if (!debriefingId || !orgId || !status) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (!['yes', 'no'].includes(String(status))) {
      return res.status(400).json({ error: 'Invalid RSVP status' });
    }

    const userDoc = await db.collection('users').findOne({ _id: uid });
    if (!userDoc || userDoc.orgId !== orgId) {
      return res.status(403).json({ error: 'Not authorized for this organization' });
    }

    const role = String(userDoc.role || '').toLowerCase();
    if (role === 'admin' || role === 'owner') {
      return res.status(400).json({ error: 'Supervisors do not RSVP to sessions' });
    }

    const debriefing = await db.collection('debriefings').findOne({ _id: new ObjectId(debriefingId), orgId });
    if (!debriefing) {
      return res.status(404).json({ error: 'Debriefing not found' });
    }

    const canAccess = debriefing.visibility === 'all'
      || !debriefing.visibility
      || (debriefing.visibility === 'specific' && Array.isArray(debriefing.members) && debriefing.members.includes(uid))
      || debriefing.createdBy === uid;

    if (!canAccess) {
      return res.status(403).json({ error: 'You cannot RSVP to this session' });
    }

    const sessionDate = new Date(`${debriefing.date}T${debriefing.time}`);
    if (Number.isNaN(sessionDate.getTime()) || sessionDate < new Date()) {
      return res.status(400).json({ error: 'RSVP is only available before the session starts' });
    }

    const responseData = {
      userId: uid,
      username: userDoc.username || userDoc.displayName || req.user.email || 'Member',
      status: String(status),
      updatedAt: new Date()
    };

    await db.collection('debriefings').updateOne(
      { _id: new ObjectId(debriefingId), orgId },
      {
        $set: {
          [`rsvpResponses.${uid}`]: responseData,
          updatedAt: new Date()
        }
      }
    );

    io.to(`org_${orgId}`).emit('debriefing_updated', {
      action: 'rsvp_updated',
      orgId,
      debriefingId,
      userId: uid,
      status: String(status)
    });

    res.json({ success: true, rsvp: responseData });
  } catch (err) {
    console.error('RSVP debriefing error:', err);
    res.status(500).json({ error: 'Failed to update RSVP' });
  }
});

app.get('/api/debriefings/list', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { orgId } = req.query;
    const requestingUid = req.user.uid;

    if (!orgId) {
      return res.status(400).json({ error: 'Missing orgId' });
    }

    // Check if requesting user is admin/owner (they see all sessions)
    const requestingUser = await db.collection('users').findOne({ _id: requestingUid });
    const role = String(requestingUser?.role || '').toLowerCase();
    const isSupervisor = role === 'admin' || role === 'owner';

    // Build visibility filter: supervisors see all, members only see their sessions
    const visibilityFilter = isSupervisor
      ? { orgId }
      : {
        orgId,
        $or: [
          { visibility: 'all' },
          { visibility: { $exists: false } }, // legacy records without visibility field
          { visibility: 'specific', members: requestingUid },
          { createdBy: requestingUid }
        ]
      };

    const debriefings = await db.collection('debriefings')
      .find(visibilityFilter)
      .sort({ date: 1 })
      .toArray();

    // Collect all unique emails/uids from evaluation responses to look up usernames
    const emailSet = new Set();
    const uidSet = new Set();
    debriefings.forEach(d => {
      if (d.evaluationResponses) {
        Object.keys(d.evaluationResponses).forEach(emailKey => {
          const decoded = emailKey.replace(/_/g, '.');
          // If it looks like an email (has @), treat as email; otherwise treat as UID
          if (decoded.includes('@')) {
            emailSet.add(decoded);
          } else {
            uidSet.add(emailKey); // original key is the UID
          }
        });
      }
    });

    // Build lookup map (email or uid -> username)
    const usernameMap = {};
    if (emailSet.size > 0) {
      const users = await db.collection('users').find({ email: { $in: [...emailSet] } }).toArray();
      users.forEach(u => {
        usernameMap[u.email.replace(/\./g, '_')] = u.username || u.displayName || u.email.split('@')[0];
      });
    }
    if (uidSet.size > 0) {
      const users = await db.collection('users').find({ _id: { $in: [...uidSet] } }).toArray();
      users.forEach(u => {
        usernameMap[u._id] = u.username || u.displayName || u.email?.split('@')[0] || u._id;
      });
    }

    const debriefingsData = debriefings.map(d => {
      // Inject username into each evaluation response
      if (d.evaluationResponses) {
        Object.keys(d.evaluationResponses).forEach(emailKey => {
          if (!d.evaluationResponses[emailKey].username) {
            d.evaluationResponses[emailKey].username = usernameMap[emailKey] || emailKey.replace(/_/g, '.').split('@')[0];
          }
        });
      }
      return {
        id: d._id.toString(),
        ...d,
        _id: undefined
      };
    });

    res.json(debriefingsData);
  } catch (err) {
    console.error('Get debriefings error:', err);
    res.status(500).json({ error: 'Failed to get debriefings' });
  }
});

// ─── REST: Post Evaluation Form ─────────────────────────────────
app.post('/api/debriefings/post-evaluation', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { debriefingId, orgId, questions, evaluationDuration, reflectionLabel, feedbackLabel } = req.body;

    console.log('🔵 /api/debriefings/post-evaluation endpoint hit');
    console.log('🔵 Request body:', JSON.stringify(req.body, null, 2));
    console.log('🔵 User:', req.user.email);

    if (!debriefingId || !orgId || !questions || !Array.isArray(questions)) {
      console.log('❌ Missing required fields');
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (questions.length === 0) {
      console.log('❌ No questions provided');
      return res.status(400).json({ error: 'At least one question is required' });
    }

    // Validate questions structure
    for (const q of questions) {
      if (!q.text || !q.text.trim()) {
        console.log('❌ Empty question text');
        return res.status(400).json({ error: 'All questions must have text' });
      }
    }

    // Verify debriefing exists
    const debriefing = await db.collection('debriefings').findOne({ _id: new ObjectId(debriefingId) });

    if (!debriefing) {
      console.log('❌ Debriefing not found with ID:', debriefingId);
      return res.status(404).json({ error: 'Debriefing not found' });
    }

    console.log('✅ Found debriefing:', debriefing.title, '| Current status:', debriefing.status);

    const result = await db.collection('debriefings').updateOne(
      { _id: new ObjectId(debriefingId) },
      {
        $set: {
          hasEvaluationForm: true,
          evaluationDuration: evaluationDuration || 24,
          evaluationForm: {
            questions,
            reflectionLabel: reflectionLabel || 'Reflection',
            feedbackLabel: feedbackLabel || 'Additional Feedback',
            createdAt: new Date(),
            createdBy: req.user.uid
          }
        }
      }
    );

    console.log('✅ Update result:', JSON.stringify(result));

    io.to(`org_${orgId}`).emit('debriefing_updated', {
      action: 'evaluation_posted',
      debriefingId
    });

    console.log(`✅ Evaluation form posted for debriefing: ${debriefing.title}`);
    res.json({ success: true });
  } catch (err) {
    console.error('❌ Post evaluation form error:', err);
    res.status(500).json({ error: 'Failed to post evaluation form' });
  }
});

// ─── REST: Submit Evaluation Response ───────────────────────────
app.post('/api/debriefings/submit-evaluation', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { debriefingId, orgId, responses, username } = req.body;

    if (!debriefingId || !orgId || !responses) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const debriefing = await db.collection('debriefings').findOne({ _id: new ObjectId(debriefingId) });

    if (!debriefing) {
      return res.status(404).json({ error: 'Debriefing not found' });
    }

    // Check if evaluation is still open
    const baseDateVal = debriefing.evaluationForm && debriefing.evaluationForm.createdAt ? new Date(debriefing.evaluationForm.createdAt) : (debriefing.completedAt ? new Date(debriefing.completedAt) : new Date(`${debriefing.date}T${debriefing.time}`));
    const evaluationDuration = debriefing.evaluationDuration || 24;
    const evaluationDeadline = new Date(baseDateVal.getTime() + (evaluationDuration * 60 * 60 * 1000));
    const now = new Date();

    if (now > evaluationDeadline) {
      return res.status(403).json({
        error: 'Evaluation period has expired',
        deadline: evaluationDeadline.toISOString()
      });
    }

    const userEmail = req.user.email;
    const emailKey = userEmail.replace(/\./g, '_');

    await db.collection('debriefings').updateOne(
      { _id: new ObjectId(debriefingId) },
      {
        $set: {
          [`evaluationResponses.${emailKey}`]: {
            responses,
            submittedAt: new Date(),
            submittedBy: req.user.uid,
            username: username || req.user.email.split('@')[0]
          }
        }
      }
    );

    io.to(`org_${orgId}`).emit('debriefing_updated', {
      action: 'evaluation_submitted',
      debriefingId
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Submit evaluation response error:', err);
    res.status(500).json({ error: 'Failed to submit evaluation response' });
  }
});

// ─── REST: Journals (Reflection Feedback) ───────────────────────
app.get('/api/journals', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const journals = await db.collection('journals')
      .find({ uid: req.user.uid })
      .sort({ createdAt: -1 })
      .toArray();

    res.json(journals.map(j => ({ ...j, id: j._id.toString(), _id: undefined })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get journal entries' });
  }
});

app.post('/api/journals', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { id, title, content, isPrivate } = req.body;
    const journalData = {
      uid: req.user.uid,
      title: title || 'Untitled Entry',
      content: content || '',
      isPrivate: isPrivate !== undefined ? isPrivate : true,
      updatedAt: new Date(),
      createdAt: new Date()
    };

    if (id) {
      // Check ownership before update
      const existing = await db.collection('journals').findOne({ _id: new ObjectId(id), uid: req.user.uid });
      if (!existing) return res.status(403).json({ error: 'Forbidden' });

      delete journalData.createdAt;
      await db.collection('journals').updateOne({ _id: new ObjectId(id) }, { $set: journalData });
      res.json({ success: true, id });
    } else {
      const result = await db.collection('journals').insertOne(journalData);
      res.json({ success: true, id: result.insertedId.toString() });
    }
  } catch (err) {
    res.status(500).json({ error: 'Failed to save journal entry' });
  }
});

app.delete('/api/journals/:id', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const result = await db.collection('journals').deleteOne({
      _id: new ObjectId(req.params.id),
      uid: req.user.uid
    });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete journal entry' });
  }
});

// ─── REST: Archived Quotes ────────────────────────────────────
app.get('/api/archives/quotes', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const archives = await db.collection('archived_quotes')
      .find({ uid: req.user.uid })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(archives.map(a => ({ ...a, id: a._id.toString(), _id: undefined })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to get archives' });
  }
});

app.post('/api/archives/quotes', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { quote, author } = req.body;
    const archiveData = {
      uid: req.user.uid,
      quote,
      author,
      createdAt: new Date()
    };
    const result = await db.collection('archived_quotes').insertOne(archiveData);
    res.json({ success: true, id: result.insertedId.toString() });
  } catch (err) {
    res.status(500).json({ error: 'Failed to archive quote' });
  }
});

app.delete('/api/archives/quotes/:id', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    await db.collection('archived_quotes').deleteOne({
      _id: new ObjectId(req.params.id),
      uid: req.user.uid
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to remove from archive' });
  }
});

// ─── REST: End Evaluation Post ──────────────────────────────────
app.post('/api/debriefings/end-evaluation', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { debriefingId, orgId } = req.body;

    if (!debriefingId || !orgId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await db.collection('debriefings').updateOne(
      { _id: new ObjectId(debriefingId) },
      {
        $set: {
          evaluationDuration: 0,
          endedManually: true,
          endedAt: new Date(),
          endedBy: req.user.uid
        }
      }
    );

    io.to(`org_${orgId}`).emit('debriefing_updated', {
      action: 'evaluation_ended',
      debriefingId
    });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to end evaluation post' });
  }
});

app.post('/api/debriefings/delete', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { debriefingId } = req.body;
    if (!debriefingId) {
      return res.status(400).json({ error: 'Missing debriefingId' });
    }

    // Find it first to get the orgId for the socket room
    const debriefing = await db.collection('debriefings').findOne({ _id: new ObjectId(debriefingId) });
    if (!debriefing) {
      return res.status(404).json({ error: 'Debriefing not found' });
    }

    const orgId = debriefing.orgId;

    const result = await db.collection('debriefings').deleteOne({ _id: new ObjectId(debriefingId) });

    if (result.deletedCount === 1) {
      // Notify all clients in the org
      io.to(`org_${orgId}`).emit('debriefing_updated', {
        action: 'deleted',
        debriefingId
      });
      res.json({ success: true });
    } else {
      res.status(500).json({ error: 'Failed to delete debriefing' });
    }
  } catch (err) {
    console.error('Delete debriefing error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── REST: Get Org Feed ─────────────────────────────────────────
app.get('/api/org/feed', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { orgId, before, month, year } = req.query;
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    const fallbackOrgId = userDoc?.orgId || null;
    const activeOrgId = orgId || fallbackOrgId;

    if (!activeOrgId) return res.status(400).json({ error: 'User not in any organization' });

    const limit = 30;
    let query = { orgId: activeOrgId };

    // Filter by month/year if provided
    if (month && year) {
      const startTime = new Date(parseInt(year), parseInt(month), 1);
      const endTime = new Date(parseInt(year), parseInt(month) + 1, 0, 23, 59, 59, 999);
      query.timestamp = { $gte: startTime, $lte: endTime };
    }

    // Pagination
    if (before && before !== 'undefined') {
      query.timestamp = { ...query.timestamp, $lt: new Date(parseInt(before)) };
    }

    const logs = await db.collection('mood_logs')
      .find(query)
      .sort({ timestamp: -1 })
      .limit(limit)
      .toArray();

    const logsData = logs.map(d => ({
      id: d._id.toString(),
      uid: d.userId,
      name: d.userName || 'Unknown User',
      mood: d.mood,
      activity: d.activity || '',
      note: d.note || '',
      timestamp: d.timestamp,
    }));

    const hasMore = logs.length === limit;

    res.json({ logs: logsData, hasMore });
  } catch (err) {
    console.error('Org feed error:', err);
    res.status(500).json({ error: 'Failed to fetch org feed' });
  }
});

// ─── REST: Get Contact Info ─────────────────────────────────────
app.get('/api/user/contact', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });
    if (!userDoc) return res.status(404).json({ error: 'User not found' });

    res.json({
      contactPhone: userDoc.contactPhone || '',
      contactMessenger: userDoc.contactMessenger || '',
      emergencyContactName: userDoc.emergencyContactName || ''
    });
  } catch (err) {
    console.error('Error getting contact info:', err);
    res.status(500).json({ error: 'Failed to get contact info' });
  }
});

app.post('/api/user/contact', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { contactPhone, contactMessenger, emergencyContactName } = req.body;

    await db.collection('users').updateOne(
      { _id: req.user.uid },
      {
        $set: {
          contactPhone: contactPhone || '',
          contactMessenger: contactMessenger || '',
          emergencyContactName: emergencyContactName || ''
        }
      }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Error saving contact info:', err);
    res.status(500).json({ error: 'Failed to save contact info' });
  }
});

// ─── REST: Mark Debriefing as Done ──────────────────────────────
app.post('/api/debriefings/mark-done', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { debriefingId, orgId } = req.body;

    if (!debriefingId || !orgId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const debriefing = await db.collection('debriefings').findOne({ _id: new ObjectId(debriefingId) });

    if (!debriefing) {
      return res.status(404).json({ error: 'Debriefing not found' });
    }

    await db.collection('debriefings').updateOne(
      { _id: new ObjectId(debriefingId) },
      {
        $set: {
          status: 'completed',
          completedAt: new Date(),
          completedBy: req.user.uid
        }
      }
    );

    // Emit socket event to refresh ongoing sessions
    io.to(`org_${orgId}`).emit('debriefing_updated', {
      action: 'completed',
      debriefingId
    });

    console.log(`✅ Debriefing ${debriefingId} marked as done by ${req.user.email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Mark debriefing as done error:', err);
    res.status(500).json({ error: 'Failed to mark debriefing as done' });
  }
});

// ─── REST: Get SOS Alerts (Admin/Owner only) ─────────────────────
app.get('/api/sos/alerts', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });

    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'owner')) {
      return res.status(403).json({ error: 'Admin/Owner access required' });
    }

    const orgId = userDoc.orgId;
    if (!orgId) return res.status(400).json({ error: 'Not in an organization' });

    const alertsDocs = await db.collection('sosAlerts')
      .find({ orgId })
      .sort({ timestamp: -1 })
      .limit(50)
      .toArray();

    const alerts = alertsDocs.map(d => ({
      id: d._id.toString(),
      userId: d.userId,
      userName: d.userName || 'Unknown',
      avatarUrl: d.avatarUrl || '',
      userPhoto: d.userPhoto || '',
      userEmail: d.userEmail || '',
      contactPhone: d.contactPhone || '',
      contactMessenger: d.contactMessenger || '',
      emergencyContactName: d.emergencyContactName || '',
      status: d.status || 'active',
      message: d.message || '',
      timestamp: d.timestamp || Date.now(),
      resolvedBy: d.resolvedBy || null,
      resolvedAt: d.resolvedAt || null,
      resolvedNote: d.resolvedNote || ''
    }));

    res.json({ success: true, alerts });
  } catch (err) {
    console.error('Get SOS alerts error:', err);
    res.status(500).json({ error: 'Failed to get SOS alerts' });
  }
});

// ─── REST: Resolve SOS Alert (Admin/Owner only) ──────────────────
app.post('/api/sos/resolve', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { alertId, note } = req.body;

    if (!alertId) return res.status(400).json({ error: 'Alert ID is required' });

    const userDoc = await db.collection('users').findOne({ _id: req.user.uid });

    if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'owner')) {
      return res.status(403).json({ error: 'Admin/Owner access required' });
    }

    const alert = await db.collection('sosAlerts').findOne({ _id: new ObjectId(alertId) });

    if (!alert) {
      return res.status(404).json({ error: 'Alert not found' });
    }

    await db.collection('sosAlerts').updateOne(
      { _id: new ObjectId(alertId) },
      {
        $set: {
          status: 'resolved',
          resolvedBy: userDoc.username || userDoc.displayName || req.user.email || 'Admin',
          resolvedAt: new Date(),
          resolvedNote: note || ''
        }
      }
    );

    // Broadcast resolution to the org room
    const roomName = `org_${alert.orgId}`;
    io.to(roomName).emit('sos:alert_resolved', {
      alertId,
      resolvedBy: userDoc.username || userDoc.displayName || 'Admin',
      timestamp: Date.now()
    });

    console.log(`✅ SOS Alert ${alertId} resolved by ${req.user.email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Resolve SOS alert error:', err);
    res.status(500).json({ error: 'Failed to resolve SOS alert' });
  }
});

// ─── Socket.io Auth Middleware ──────────────────────────────────
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  const decoded = await verifyToken(token);
  if (!decoded) {
    return next(new Error('Invalid token'));
  }
  socket.userId = decoded.uid;
  socket.userEmail = decoded.email;
  next();
});

// ─── Socket.io Connection Handler ──────────────────────────────
io.on('connection', async (socket) => {
  console.log(`🟢 User connected: ${socket.userEmail}`);

  try {
    const userDoc = await db.collection('users').findOne({ _id: socket.userId });

    if (!userDoc) {
      console.log(`⚠️ User ${socket.userEmail} not found`);
      socket.emit('error_msg', { message: 'User not found' });
      return;
    }

    const fallbackOrgId = userDoc.orgId || null;

    if (!fallbackOrgId) {
      console.log(`⚠️ User ${socket.userEmail} has no valid org`);
      socket.emit('error_msg', { message: 'You are not in any organization' });
      return;
    }

    const passedOrgId = socket.handshake.auth.orgId;
    const orgId = passedOrgId || fallbackOrgId;

    if (fallbackOrgId !== orgId) {
      console.log(`⚠️ User ${socket.userEmail} has wrong orgId`);
      socket.emit('error_msg', { message: 'You are not in this organization' });
      return;
    }

    const roomName = `org_${orgId}`;

    socket.join(roomName);
    socket.orgRoom = roomName;
    socket.orgId = orgId;

    // Mark user online
    await db.collection('users').updateOne(
      { _id: socket.userId },
      {
        $set: {
          isOnline: true,
          lastUpdated: new Date()
        }
      }
    );

    // Broadcast user online
    io.to(roomName).emit('user_online', {
      uid: socket.userId,
      email: socket.userEmail,
      displayName: userDoc.username || userDoc.displayName || socket.userEmail,
      avatarUrl: userDoc.avatarUrl || '',
      currentMood: userDoc.currentMood || '',
      currentActivity: userDoc.currentActivity || '',
    });

    // Send current org members
    const members = await db.collection('users').find({ orgId }).toArray();
    const membersData = members.map(doc => ({
      uid: doc._id,
      email: doc.email || '',
      displayName: doc.username || doc.displayName || doc.email || '',
      avatarUrl: doc.avatarUrl || '',
      role: doc.role || 'member',
      isOnline: doc.isOnline || false,
      currentMood: doc.currentMood || '',
      currentActivity: doc.currentActivity || '',
      lastUpdated: doc.lastUpdated || null
    }));

    socket.emit('initial_state', { members: membersData });

    // ─── Handle mood update ─────────────────────────────────────
    socket.on('mood_update', async (data) => {
      const { mood, moodLabel, moodEmoji, moodColor, activity, activities, emotions, note } = data;

      let entryTimestamp = new Date();
      let isBackdated = false;

      if (data.timestamp) {
        entryTimestamp = new Date(data.timestamp);
        const today = new Date();
        const entryDate = new Date(data.timestamp);
        const isActuallyToday =
          today.getFullYear() === entryDate.getFullYear() &&
          today.getMonth() === entryDate.getMonth() &&
          today.getDate() === entryDate.getDate();

        if (!isActuallyToday) {
          isBackdated = true;
        }
      }

      try {
        const freshUserDoc = await db.collection('users').findOne({ _id: socket.userId });

        const logData = {
          userId: socket.userId,
          userName: freshUserDoc?.username || freshUserDoc?.displayName || socket.userEmail || 'Anonymous User',
          userPhoto: freshUserDoc?.photoURL || '',
          orgId: orgId || '',
          mood: mood || '',
          moodLabel: moodLabel || '',
          moodEmoji: moodEmoji || '',
          moodColor: moodColor || '',
          activity: activity || '',
          activities: activities || [],
          emotions: emotions || [],
          note: note || '',
          timestamp: entryTimestamp,
        };

        const result = await db.collection('mood_logs').insertOne(logData);

        // Broadcast to room
        io.to(roomName).emit('new_feed_entry', {
          id: result.insertedId.toString(),
          uid: socket.userId,
          name: logData.userName,
          mood: mood || '',
          moodLabel: moodLabel || '',
          moodEmoji: moodEmoji || '',
          moodColor: moodColor || '',
          activity: activity || '',
          activities: activities || [],
          emotions: emotions || [],
          note: note || '',
          timestamp: data.timestamp || Date.now(),
        });

        // Update current status if not backdated
        if (!isBackdated) {
          await db.collection('users').updateOne(
            { _id: socket.userId },
            {
              $set: {
                currentMood: mood || '',
                currentActivity: activity || '',
                lastUpdated: new Date()
              }
            }
          );

          io.to(roomName).emit('status_update', {
            uid: socket.userId,
            mood: mood || '',
            activity: activity || '',
            timestamp: Date.now(),
          });
        }

        console.log(`🎭 ${socket.userEmail} → ${mood} ${isBackdated ? '(Backdated)' : ''}`);
      } catch (err) {
        console.error('Mood update error:', err);
        socket.emit('error_msg', { message: 'Failed to update mood: ' + err.message });
      }
    });

    // ─── Handle createNotification ──────────────────────────────
    socket.on('createNotification', async (data) => {
      const { title, body, type, category, linkId } = data;

      try {
        const freshUserDoc = await db.collection('users').findOne({ _id: socket.userId });

        const notifData = {
          orgId: orgId || '',
          userId: socket.userId,
          userName: freshUserDoc?.username || freshUserDoc?.displayName || socket.userEmail || 'Anonymous',
          userPhoto: freshUserDoc?.photoURL || '',
          title: title || '',
          body: body || '',
          type: type || 'general',
          category: category || 'general',
          linkId: linkId || '',
          timestamp: new Date()
        };

        const result = await db.collection('notifications').insertOne(notifData);

        io.to(roomName).emit('new_group_notification', {
          id: result.insertedId.toString(),
          ...notifData
        });
      } catch (err) {
        console.error('Notification creation error:', err);
      }
    });

    // ─── Handle SOS Alert ───────────────────────────────────────
    socket.on('sos:alert', async (data) => {
      try {
        const freshUserDoc = await db.collection('users').findOne({ _id: socket.userId });

        const alertData = {
          userId: socket.userId,
          userName: freshUserDoc?.username || freshUserDoc?.displayName || socket.userEmail || 'Anonymous',
          avatarUrl: freshUserDoc?.avatarUrl || '',
          userPhoto: freshUserDoc?.photoURL || '',
          userEmail: socket.userEmail || '',
          contactPhone: freshUserDoc?.contactPhone || '',
          contactMessenger: freshUserDoc?.contactMessenger || '',
          emergencyContactName: freshUserDoc?.emergencyContactName || '',
          orgId: orgId || '',
          status: 'active',
          message: data.message || '',
          timestamp: new Date(),
          resolvedBy: null,
          resolvedAt: null,
          resolvedNote: ''
        };

        const result = await db.collection('sosAlerts').insertOne(alertData);

        io.to(roomName).emit('sos:new_alert', {
          id: result.insertedId.toString(),
          ...alertData
        });

        console.log(`🆘 SOS ALERT from ${alertData.userName} in org ${orgId}`);

        // Create notification (only for supervisors/admins)
        const notifData = {
          orgId: orgId || '',
          userId: socket.userId,
          userName: alertData.userName,
          userPhoto: alertData.userPhoto,
          title: 'SOS Alert',
          body: data.message ? `${alertData.userName}: "${data.message}"` : `${alertData.userName} needs immediate support!`,
          type: 'sos',
          category: 'urgent',
          linkId: result.insertedId.toString(),
          timestamp: new Date()
        };

        const notifResult = await db.collection('notifications').insertOne(notifData);

        // Send SOS notification only to supervisors/admins in the org
        const supervisors = await db.collection('users').find({
          orgId: orgId,
          $or: [
            { role: 'admin' },
            { role: 'owner' }
          ]
        }).toArray();

        // Emit to each supervisor's socket
        supervisors.forEach(supervisor => {
          const supervisorSockets = Array.from(io.sockets.sockets.values())
            .filter(s => s.userId === supervisor._id);

          supervisorSockets.forEach(s => {
            s.emit('new_group_notification', {
              id: notifResult.insertedId.toString(),
              ...notifData
            });
          });
        });

        // ─── Firebase Cloud Messaging (Push Notifications) ──────────
        if (firebaseAuth && orgId && typeof admin !== 'undefined') {
          try {
            await sendPushToUsers({
              query: {
                orgId: orgId,
                $or: [
                  { role: 'admin' },
                  { role: 'owner' }
                ]
              },
              excludeUserId: socket.userId,
              notification: {
                title: notifData.title,
                body: notifData.body
              },
              data: {
                type: 'sos',
                linkId: notifData.linkId || '',
                userName: notifData.userName || ''
              },
              logLabel: 'Sent FCM SOS push notifications to supervisors'
            });
          } catch (fcmErr) {
            console.error('FCM Push Notification error:', fcmErr);
          }
        }

      } catch (err) {
        console.error('SOS alert error:', err);
        socket.emit('error_msg', { message: 'Failed to send SOS alert: ' + err.message });
      }
    });

    // ─── Handle org settings update ────────────────────────────
    socket.on('org:settings-updated', async (data) => {
      try {
        const userDoc = await db.collection('users').findOne({ _id: socket.userId });
        if (!userDoc || (userDoc.role !== 'admin' && userDoc.role !== 'supervisor')) {
          return socket.emit('error_msg', { message: 'Only admins can update group settings' });
        }

        const roomName = `org_${userDoc.orgId}`;
        socket.to(roomName).emit('org:settings-updated', data);
        console.log(`⚙️ Org ${userDoc.orgId} settings broadcasted by ${socket.userEmail}`);
      } catch (err) {
        console.error('Socket settings update error:', err);
      }
    });

    // ─── Handle disconnect ──────────────────────────────────────
    socket.on('disconnect', async () => {
      console.log(`🔴 User disconnected: ${socket.userEmail}`);
      try {
        await db.collection('users').updateOne(
          { _id: socket.userId },
          {
            $set: {
              isOnline: false,
              lastUpdated: new Date()
            }
          }
        );
        io.to(roomName).emit('user_offline', { uid: socket.userId });
      } catch (err) {
        console.error('Disconnect update error:', err);
      }
    });

  } catch (err) {
    console.error('Connection handler error:', err);
    socket.emit('error_msg', { message: 'Server error during connection' });
  }
});

// ─── REST: Get Self-Care Progress ───────────────────────────────
app.get('/api/self-care/progress', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const uid = req.user.uid;

    const progressDoc = await db.collection('self_care_progress').findOne({ userId: uid });

    res.json({
      success: true,
      progress: progressDoc?.activities || {}
    });
  } catch (err) {
    console.error('Get self-care progress error:', err);
    res.status(500).json({ error: 'Failed to get self-care progress' });
  }
});

// ─── REST: Complete Self-Care Activity ──────────────────────────
app.post('/api/self-care/complete', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { activityId } = req.body;
    const uid = req.user.uid;

    if (!activityId) {
      return res.status(400).json({ error: 'Activity ID is required' });
    }

    // Heart coin rewards per activity
    const COIN_REWARDS = {
      'breathing-exercise': 25,
      'gratitude-journal': 30,
      'morning-stretch': 25,
      'hydration-check': 80, // 8 glasses × 10 coins
      'mindful-walk': 35,
      'digital-detox': 40,
      'meditation': 30,
      'healthy-meal': 35,
      'creative-time': 30,
      'social-connection': 25,
      'evening-reflection': 30,
      'power-nap': 25,
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Get current progress
    let progressDoc = await db.collection('self_care_progress').findOne({ userId: uid });

    if (!progressDoc) {
      progressDoc = {
        userId: uid,
        activities: {},
        createdAt: new Date()
      };
    }

    const activityProgress = progressDoc.activities[activityId] || {
      completed: 0,
      streak: 0,
      lastCompleted: null
    };

    // Check if already completed today
    const lastCompleted = activityProgress.lastCompleted ? new Date(activityProgress.lastCompleted) : null;
    const lastCompletedDate = lastCompleted ? new Date(lastCompleted.getFullYear(), lastCompleted.getMonth(), lastCompleted.getDate()) : null;

    if (lastCompletedDate && lastCompletedDate.getTime() === today.getTime()) {
      return res.status(400).json({ error: 'Activity already completed today' });
    }

    // Calculate new streak
    let newStreak = activityProgress.streak;
    if (lastCompletedDate) {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);

      if (lastCompletedDate.getTime() === yesterday.getTime()) {
        // Consecutive day
        newStreak += 1;
      } else {
        // Streak broken, reset to 1
        newStreak = 1;
      }
    } else {
      // First completion
      newStreak = 1;
    }

    // Update progress
    const updatedProgress = {
      completed: activityProgress.completed + 1,
      streak: newStreak,
      lastCompleted: new Date()
    };

    progressDoc.activities[activityId] = updatedProgress;

    await db.collection('self_care_progress').updateOne(
      { userId: uid },
      {
        $set: {
          activities: progressDoc.activities,
          lastUpdated: new Date()
        }
      },
      { upsert: true }
    );

    // Log the completion
    await db.collection('self_care_logs').insertOne({
      userId: uid,
      activityId,
      completedAt: new Date(),
      streak: newStreak
    });

    // Award heart coins
    const coinsEarned = COIN_REWARDS[activityId] || 20;
    await db.collection('users').updateOne(
      { uid },
      { $inc: { heartCoins: coinsEarned } },
      { upsert: false }
    );
    const userDoc = await db.collection('users').findOne({ uid }, { projection: { heartCoins: 1 } });
    const newCoinBalance = userDoc?.heartCoins ?? coinsEarned;

    res.json({
      success: true,
      progress: updatedProgress,
      coinsEarned,
      heartCoins: newCoinBalance
    });
  } catch (err) {
    console.error('Complete self-care activity error:', err);
    res.status(500).json({ error: 'Failed to complete activity' });
  }
});

// ─── REST: Get Heart Coins Balance ──────────────────────────────
app.get('/api/heart-coins', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const uid = req.user.uid;
    const userDoc = await db.collection('users').findOne({ uid }, { projection: { heartCoins: 1 } });
    res.json({ heartCoins: userDoc?.heartCoins ?? 0 });
  } catch (err) {
    console.error('Get heart coins error:', err);
    res.status(500).json({ error: 'Failed to get heart coins' });
  }
});

// ─── REST: Get Self-Care History ────────────────────────────────
app.get('/api/self-care/history', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const uid = req.user.uid;
    const days = parseInt(req.query.days) || 30;

    const since = new Date();
    since.setDate(since.getDate() - days);

    const logs = await db.collection('self_care_logs')
      .find({
        userId: uid,
        completedAt: { $gte: since }
      })
      .sort({ completedAt: -1 })
      .toArray();

    const logsData = logs.map(log => ({
      id: log._id.toString(),
      activityId: log.activityId,
      completedAt: log.completedAt,
      streak: log.streak
    }));

    res.json({
      success: true,
      logs: logsData
    });
  } catch (err) {
    console.error('Get self-care history error:', err);
    res.status(500).json({ error: 'Failed to get self-care history' });
  }
});

// ════════════════════════════════════════════════════════════════
// SUPER ADMIN ROUTES
// ════════════════════════════════════════════════════════════════

// ─── Middleware: Super Admin Only ────────────────────────────────
async function superAdminMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split('Bearer ')[1];
  const decoded = await verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });

  // Check custom claim
  if (decoded.role !== 'super_admin') {
    return res.status(403).json({ error: 'Super Admin access required' });
  }
  req.user = decoded;
  next();
}

// ─── Middleware: Institution Admin Only ──────────────────────────
async function institutionAdminMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  const token = authHeader.split('Bearer ')[1];
  const decoded = await verifyToken(token);
  if (!decoded) return res.status(401).json({ error: 'Invalid token' });

  if (decoded.role !== 'institution_admin') {
    return res.status(403).json({ error: 'Institution Admin access required' });
  }
  req.user = decoded;
  next();
}

// ─── SA: Overview ────────────────────────────────────────────────
app.get('/api/superadmin/overview', superAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const institutions = await db.collection('institutions').find().toArray();

    // Count ALL groups and users in the entire DB (not just tagged ones)
    const totalGroups = await db.collection('organizations').countDocuments();
    const totalUsers = await db.collection('users').countDocuments();

    // Also fetch all groups for the "All Groups" section — no member count to keep it fast
    const allGroups = await db.collection('organizations').find({}, { projection: { name: 1, institutionId: 1 } }).toArray();
    const allGroupsData = allGroups.map(g => ({
      name: g.name,
      institutionId: g.institutionId || null
    }));
    const enriched = await Promise.all(institutions.map(async (inst) => {
      const instId = inst._id.toString();
      const supervisorCount = await db.collection('approved_supervisors')
        .countDocuments({ institutionId: instId, isActive: true });
      const groups = await db.collection('organizations')
        .find({ institutionId: instId })
        .toArray();
      const groupCount = groups.length;
      const memberCount = await db.collection('users')
        .countDocuments({ institutionId: instId });

      const groupsData = await Promise.all(groups.map(async (g) => {
        const mc = await db.collection('users').countDocuments({ orgId: g._id.toString() });
        return { name: g.name, memberCount: mc };
      }));

      return {
        ...inst,
        _id: instId,
        supervisorCount,
        groupCount,
        memberCount,
        groups: groupsData
      };
    }));

    res.json({
      institutionCount: institutions.length,
      totalGroups,
      totalUsers,
      institutions: enriched
    });
  } catch (err) {
    console.error('SA overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// ─── REST: Check if user is approved supervisor ──────────────────
app.get('/api/user/check-supervisor', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const email = req.user.email?.toLowerCase();
    if (!email) return res.json({ isSupervisor: false });

    const record = await db.collection('approved_supervisors').findOne({
      email,
      isActive: true
    });

    if (!record) return res.json({ isSupervisor: false });

    res.json({
      isSupervisor: true,
      institutionId: record.institutionId,
      institutionSlug: record.institutionSlug || ''
    });
  } catch (err) {
    console.error('Check supervisor error:', err);
    res.status(500).json({ error: 'Failed to check supervisor status' });
  }
});

// ─── SA: Cleanup Empty Groups ────────────────────────────────────
app.post('/api/superadmin/cleanup-empty-groups', superAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const groups = await db.collection('organizations').find().toArray();
    let deleted = 0;
    const deletedNames = [];

    for (const g of groups) {
      const gId = g._id.toString();
      const memberCount = await db.collection('users').countDocuments({ orgId: gId });
      if (memberCount === 0) {
        await Promise.all([
          db.collection('organizations').deleteOne({ _id: g._id }),
          db.collection('mood_logs').deleteMany({ orgId: gId }),
          db.collection('notifications').deleteMany({ orgId: gId }),
          db.collection('self_care_logs').deleteMany({ orgId: gId })
        ]);
        deletedNames.push(g.name);
        deleted++;
      }
    }

    console.log(`🗑️ Cleaned up ${deleted} empty groups`);
    res.json({ success: true, deleted, deletedNames });
  } catch (err) {
    console.error('Cleanup error:', err);
    res.status(500).json({ error: 'Cleanup failed' });
  }
});

// ─── SA: All Groups List ─────────────────────────────────────────
app.get('/api/superadmin/all-groups', superAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const groups = await db.collection('organizations')
      .find({}, { projection: { name: 1, inviteCode: 1, institutionId: 1, adminId: 1 } })
      .sort({ createdAt: -1 })
      .toArray();

    const groupsData = await Promise.all(groups.map(async (g) => {
      const gId = g._id.toString();
      const memberCount = await db.collection('users').countDocuments({ orgId: gId });
      console.log(`Group "${g.name}" id=${gId} members=${memberCount}`);
      return {
        id: gId,
        name: g.name,
        inviteCode: g.inviteCode || '',
        memberCount,
        institutionId: g.institutionId || null
      };
    }));

    res.json({ groups: groupsData, total: groupsData.length });
  } catch (err) {
    console.error('All groups error:', err);
    res.status(500).json({ error: 'Failed to fetch groups' });
  }
});

// ─── SA: List Institutions ───────────────────────────────────────
app.get('/api/superadmin/institutions', superAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const institutions = await db.collection('institutions').find().toArray();
    const enriched = await Promise.all(institutions.map(async (inst) => {
      const instId = inst._id.toString();
      const supervisorCount = await db.collection('approved_supervisors')
        .countDocuments({ institutionId: instId, isActive: true });
      const groupCount = await db.collection('organizations')
        .countDocuments({ institutionId: instId });
      const memberCount = await db.collection('users')
        .countDocuments({ institutionId: instId });
      return { ...inst, _id: instId, supervisorCount, groupCount, memberCount };
    }));
    res.json({ institutions: enriched });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list institutions' });
  }
});

// ─── SA: Create Institution + Admin Account ──────────────────────
app.post('/api/superadmin/institutions/create', superAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { name, slug, adminEmail, adminPassword } = req.body;
    if (!name || !slug || !adminEmail || !adminPassword) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (adminPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Check slug uniqueness
    const existing = await db.collection('institutions').findOne({ slug });
    if (existing) return res.status(400).json({ error: 'Slug already exists' });

    // Create institution in MongoDB
    const instResult = await db.collection('institutions').insertOne({
      name,
      slug,
      adminEmail: adminEmail.toLowerCase(),
      createdAt: new Date()
    });
    const institutionId = instResult.insertedId.toString();

    // Create Firebase Auth account for admin
    let firebaseUser;
    try {
      firebaseUser = await firebaseAuth.createUser({
        email: adminEmail,
        password: adminPassword,
        displayName: `${name} Admin`,
        emailVerified: true
      });
    } catch (fbErr) {
      // Rollback institution if Firebase fails
      await db.collection('institutions').deleteOne({ _id: instResult.insertedId });
      return res.status(400).json({ error: fbErr.message });
    }

    // Set custom claims
    await firebaseAuth.setCustomUserClaims(firebaseUser.uid, {
      role: 'institution_admin',
      institutionId,
      institutionSlug: slug
    });

    // Save admin record in MongoDB
    await db.collection('institution_admins').insertOne({
      uid: firebaseUser.uid,
      email: adminEmail.toLowerCase(),
      institutionId,
      institutionSlug: slug,
      role: 'institution_admin',
      createdAt: new Date()
    });

    console.log(`✅ Institution created: ${name} | Admin: ${adminEmail}`);
    res.json({ success: true, institutionId, name, slug });
  } catch (err) {
    console.error('Create institution error:', err);
    res.status(500).json({ error: 'Failed to create institution' });
  }
});

// ─── SA: List Pending Admin Registrations ───────────────────────
app.get('/api/superadmin/pending-admins', superAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const pending = await db.collection('pending_admins')
      .find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .toArray();
    res.json({ pending: pending.map(p => ({ ...p, _id: p._id.toString() })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load pending admins' });
  }
});

// ─── SA: Approve Admin ───────────────────────────────────────────
app.post('/api/superadmin/approve-admin', superAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { pendingId } = req.body;
    const pending = await db.collection('pending_admins')
      .findOne({ _id: new ObjectId(pendingId) });
    if (!pending) return res.status(404).json({ error: 'Pending record not found' });

    const institution = await db.collection('institutions')
      .findOne({ slug: pending.institutionSlug });
    if (!institution) return res.status(404).json({ error: 'Institution not found' });

    const institutionId = institution._id.toString();

    // Set custom claims on Firebase user
    await firebaseAuth.setCustomUserClaims(pending.uid, {
      role: 'institution_admin',
      institutionId,
      institutionSlug: pending.institutionSlug
    });

    // Save to institution_admins
    await db.collection('institution_admins').updateOne(
      { uid: pending.uid },
      { $set: { uid: pending.uid, email: pending.email, institutionId, institutionSlug: pending.institutionSlug, role: 'institution_admin', approvedAt: new Date() } },
      { upsert: true }
    );

    // Mark as approved
    await db.collection('pending_admins').updateOne(
      { _id: new ObjectId(pendingId) },
      { $set: { status: 'approved', approvedAt: new Date() } }
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Approve admin error:', err);
    res.status(500).json({ error: 'Failed to approve admin' });
  }
});

// ─── SA: Reject Admin ────────────────────────────────────────────
app.post('/api/superadmin/reject-admin', superAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { pendingId } = req.body;
    const pending = await db.collection('pending_admins')
      .findOne({ _id: new ObjectId(pendingId) });
    if (!pending) return res.status(404).json({ error: 'Not found' });

    // Delete Firebase account
    try { await firebaseAuth.deleteUser(pending.uid); } catch (_) { }

    // Remove pending record
    await db.collection('pending_admins').deleteOne({ _id: new ObjectId(pendingId) });

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to reject admin' });
  }
});

// ─── SA: Delete Institution ──────────────────────────────────────
app.delete('/api/superadmin/institutions/:slug', superAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { slug } = req.params;
    const institution = await db.collection('institutions').findOne({ slug });
    if (!institution) return res.status(404).json({ error: 'Institution not found' });

    const instId = institution._id.toString();

    // Delete Firebase admin account
    const adminDoc = await db.collection('institution_admins').findOne({ institutionSlug: slug });
    if (adminDoc?.uid) {
      try { await firebaseAuth.deleteUser(adminDoc.uid); } catch (_) { }
    }

    // Delete all related data
    await Promise.all([
      db.collection('institutions').deleteOne({ slug }),
      db.collection('institution_admins').deleteMany({ institutionSlug: slug }),
      db.collection('approved_supervisors').deleteMany({ institutionId: instId }),
      db.collection('pending_admins').deleteMany({ institutionSlug: slug })
    ]);

    console.log(`🗑️ Institution deleted: ${slug}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Delete institution error:', err);
    res.status(500).json({ error: 'Failed to delete institution' });
  }
});

// ════════════════════════════════════════════════════════════════
// INSTITUTION ADMIN ROUTES
// ════════════════════════════════════════════════════════════════

// ─── IA: Register (pending approval) ────────────────────────────
app.post('/api/institution-admin/register', authMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { email, institutionSlug } = req.body;
    const uid = req.user.uid;

    if (!email || !institutionSlug) {
      return res.status(400).json({ error: 'Email and institution are required' });
    }

    const institution = await db.collection('institutions').findOne({ slug: institutionSlug });
    if (!institution) return res.status(404).json({ error: 'Institution not found' });

    // Check if already registered
    const existing = await db.collection('pending_admins').findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ error: 'This email is already registered' });

    await db.collection('pending_admins').insertOne({
      uid,
      email: email.toLowerCase(),
      institutionSlug,
      status: 'pending',
      createdAt: new Date()
    });

    res.json({ success: true, message: 'Registration submitted for approval' });
  } catch (err) {
    console.error('IA register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// ─── IA: Overview ────────────────────────────────────────────────
app.get('/api/institution-admin/overview', institutionAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const institutionId = req.user.institutionId;

    const supervisorCount = await db.collection('approved_supervisors')
      .countDocuments({ institutionId, isActive: true });

    const groups = await db.collection('organizations')
      .find({ institutionId })
      .toArray();

    let memberCount = 0;
    const groupsData = await Promise.all(groups.map(async (g) => {
      const count = await db.collection('users').countDocuments({ orgId: g._id.toString() });
      memberCount += count;

      // Get supervisor name
      const supDoc = g.adminId
        ? await db.collection('users').findOne({ _id: g.adminId })
        : null;

      return {
        id: g._id.toString(),
        name: g.name,
        memberCount: count,
        supervisorName: supDoc?.username || supDoc?.displayName || 'Unknown'
      };
    }));

    res.json({ supervisorCount, groupCount: groups.length, memberCount, groups: groupsData });
  } catch (err) {
    console.error('IA overview error:', err);
    res.status(500).json({ error: 'Failed to load overview' });
  }
});

// ─── IA: List Supervisors ────────────────────────────────────────
app.get('/api/institution-admin/supervisors', institutionAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const institutionId = req.user.institutionId;
    const supervisors = await db.collection('approved_supervisors')
      .find({ institutionId })
      .sort({ approvedAt: -1 })
      .toArray();
    res.json({ supervisors: supervisors.map(s => ({ ...s, _id: s._id.toString() })) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list supervisors' });
  }
});

// ─── IA: Add Supervisor ──────────────────────────────────────────
app.post('/api/institution-admin/supervisors/add', institutionAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { name, email, institutionId } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    // Only Gmail accounts allowed
    if (!email.toLowerCase().endsWith('@gmail.com')) {
      return res.status(400).json({ error: 'Only Gmail accounts (@gmail.com) are allowed' });
    }

    // Verify the Gmail exists in Firebase (user must have logged in to Alwan at least once)
    try {
      await firebaseAuth.getUserByEmail(email.toLowerCase());
    } catch (fbErr) {
      return res.status(400).json({
        error: 'This Gmail account has not signed in to Alwan yet. Ask the supervisor to open the app and log in with their Google account first.'
      });
    }

    // Verify institutionId matches the admin's institution
    if (institutionId !== req.user.institutionId) {
      return res.status(403).json({ error: 'Not authorized for this institution' });
    }

    const existing = await db.collection('approved_supervisors')
      .findOne({ email: email.toLowerCase(), institutionId });
    if (existing) return res.status(400).json({ error: 'This email is already registered as a supervisor' });

    await db.collection('approved_supervisors').insertOne({
      name: name || '',
      email: email.toLowerCase(),
      institutionId,
      approvedBy: req.user.uid,
      approvedAt: new Date(),
      isActive: true
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Add supervisor error:', err);
    res.status(500).json({ error: 'Failed to add supervisor' });
  }
});

// ─── IA: Revoke Supervisor ───────────────────────────────────────
app.post('/api/institution-admin/supervisors/revoke', institutionAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { supervisorId } = req.body;
    await db.collection('approved_supervisors').updateOne(
      { _id: new ObjectId(supervisorId), institutionId: req.user.institutionId },
      { $set: { isActive: false, revokedAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to revoke supervisor' });
  }
});

// ─── IA: Delete Supervisor ───────────────────────────────────────
app.delete('/api/institution-admin/supervisors/:id', institutionAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { id } = req.params;
    await db.collection('approved_supervisors').deleteOne({
      _id: new ObjectId(id),
      institutionId: req.user.institutionId
    });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete supervisor' });
  }
});

// ─── IA: Restore Supervisor ──────────────────────────────────────
app.post('/api/institution-admin/supervisors/restore', institutionAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const { supervisorId } = req.body;
    await db.collection('approved_supervisors').updateOne(
      { _id: new ObjectId(supervisorId), institutionId: req.user.institutionId },
      { $set: { isActive: true, restoredAt: new Date() } }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to restore supervisor' });
  }
});

// ─── IA: List Groups ─────────────────────────────────────────────
app.get('/api/institution-admin/groups', institutionAdminMiddleware, async (req, res) => {
  if (!dbReady) return res.status(503).json({ error: 'Database not ready' });
  try {
    const institutionId = req.user.institutionId;
    const groups = await db.collection('organizations')
      .find({ institutionId })
      .toArray();

    const groupsData = await Promise.all(groups.map(async (g) => {
      const memberCount = await db.collection('users').countDocuments({
        $or: [{ orgId: g._id.toString() }, { orgIds: g._id.toString() }]
      });
      const supDoc = g.adminId
        ? await db.collection('users').findOne({ _id: g.adminId })
        : null;
      return {
        id: g._id.toString(),
        name: g.name,
        memberCount,
        inviteCode: g.inviteCode || '',
        supervisorName: supDoc?.username || supDoc?.displayName || 'Unknown'
      };
    }));

    res.json({ groups: groupsData });
  } catch (err) {
    res.status(500).json({ error: 'Failed to list groups' });
  }
});

// ─── Start Server (Strict Startup) ──────────────────────────────
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    // 1. First ensure MongoDB is connected
    await connectMongoDB();

    // 2. Only then start the server
    server.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
      console.log(`📦 Database: MongoDB Connected`);
      console.log(`🔐 Auth: Firebase`);
    });
  } catch (err) {
    console.error('💥 Failed to start server:', err);
    process.exit(1);
  }
}

start();

