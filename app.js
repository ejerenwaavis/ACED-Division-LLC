require('dotenv').config();
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcrypt');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { MongoClient, ObjectId } = require('mongodb');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');

const {
  listProjects,
  getFeaturedProjects,
  findProjectBySlug,
  saveNewProject,
  updateProject,
  deleteProject,
} = require('./lib/portfolioStore');

const app = express();
const PORT = parseInt(process.env.PORT, 10) || 3050;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aceddivision2026';
const DISABLE_2FA = process.env.DISABLE_2FA === 'true'; // set in .env to bypass 2FA flow

// ── Cloudinary / local storage ────────────────────────────────────────────────
const useCloudinary = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

let storage;
if (useCloudinary) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  storage = new CloudinaryStorage({
    cloudinary,
    params: {
      folder: 'aced-portfolio',
      allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    },
  });
  console.log('Upload storage: Cloudinary');
} else {
  const uploadDir = path.join(__dirname, 'public', 'uploads', 'portfolio');
  storage = multer.diskStorage({
    destination: (req, file, callback) => {
      fs.mkdirSync(uploadDir, { recursive: true });
      callback(null, uploadDir);
    },
    filename: (req, file, callback) => {
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]+/g, '-');
      callback(null, `${Date.now()}-${safeName}`);
    },
  });
  console.log('Upload storage: local disk (public/uploads/portfolio)');
}

const upload = multer({ storage });

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 8 * 60 * 60 * 1000 },
}));

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// ── Arm / subdomain detection ─────────────────────────────────────────────────
const ARMS = ['pixels', 'devops', 'trades'];
const ARM_TITLES = {
  pixels: 'ACED Pixels – Creative & Visual',
  devops: 'ACED Devops – Software & Engineering',
  trades: 'ACED Trades – Financial Markets',
};

function detectArm(hostname) {
  const sub = (hostname || '').split('.')[0].toLowerCase();
  return ARMS.includes(sub) ? sub : 'master';
}

app.use((req, res, next) => {
  req.site = detectArm(req.hostname);
  res.locals.site = req.site;
  next();
});

// ── MongoDB & user account helpers ─────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB_NAME || 'aceddivision';
let mongoClient;
let db;

async function initMongo() {
  if (!MONGO_URI) {
    console.warn('MONGO_URI not set; starting in-memory mode');
    return;
  }
  mongoClient = new MongoClient(MONGO_URI);
  await mongoClient.connect();
  db = mongoClient.db(MONGO_DB);
  console.log(`Connected to MongoDB: ${MONGO_DB}`);

  // Seed default admin if none exists
  const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@aceddivision.com';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin1234!';
  const existingAdmin = await findUserByEmail(adminEmail);

  if (!existingAdmin) {
    const adminUser = await createUser(adminEmail, adminPassword, { twoFactorEnabled: false });
    await setAdminFlag(adminUser._id, true);
    console.log('==============================================================');
    console.log('ADMIN SEED' );
    console.log(`email: ${adminEmail}`);
    console.log(`password: ${adminPassword}`);
    console.log('2FA requires setup on first login via /auth/setup');
    console.log('==============================================================');
  } else {
    console.log(`Admin account exists: ${adminEmail}`);
  }
}

function getUserCollection() {
  if (!db) throw new Error('MongoDB is not initialized. Set MONGO_URI in .env');
  return db.collection('users');
}

async function findUserByEmail(email) {
  return getUserCollection().findOne({ email: email.toLowerCase() });
}

async function findUserById(id) {
  try {
    return getUserCollection().findOne({ _id: new ObjectId(id) });
  } catch (error) {
    return null;
  }
}

async function createUser(email, password, options = {}) {
  const passwordHash = await bcrypt.hash(password, 12);
  const secret = speakeasy.generateSecret({ name: `ACED Division (${email})`, length: 20 });
  const user = {
    email: email.toLowerCase(),
    passwordHash,
    isAdmin: false,
    twoFactorEnabled: options.twoFactorEnabled || false,
    twoFactorSecret: secret.base32,
    createdAt: new Date(),
  };
  const { insertedId } = await getUserCollection().insertOne(user);
  return { ...user, _id: insertedId };
}

async function setAdminFlag(userId, value) {
  return getUserCollection().updateOne({ _id: new ObjectId(userId) }, { $set: { isAdmin: value } });
}

async function getTwoFactorSecretForUser(userId) {
  const user = await findUserById(userId);
  return user?.twoFactorSecret;
}

function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId || !req.session.isAdmin) {
    return res.redirect('/');
  }

  if (!DISABLE_2FA && !req.session.twoFactorVerified) {
    return res.redirect('/auth/login');
  }

  return next();
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/');
  }

  if (!DISABLE_2FA && !req.session.twoFactorVerified) {
    return res.redirect('/auth/login');
  }

  return next();
}

async function getCurrentUser(req) {
  if (!req.session || !req.session.userId) return null;
  return findUserById(req.session.userId);
}

// ── Helper utilities ──────────────────────────────────────────────────────────
function toArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function toPublicUploadPath(file) {
  if (useCloudinary) return file.path;
  return `/uploads/portfolio/${file.filename}`;
}

function toEmbedUrl(url) {
  if (!url) return '';
  const watchMatch = url.match(/youtube\.com\/watch\?v=([^&]+)/i);
  if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}`;
  const shortMatch = url.match(/youtu\.be\/([^?&]+)/i);
  if (shortMatch) return `https://www.youtube.com/embed/${shortMatch[1]}`;
  return '';
}

function parseMilestones(body, files) {
  const count = Number(body.milestoneCount || 0);
  const fileMap = new Map(files.map((f) => [f.fieldname, toPublicUploadPath(f)]));
  const milestones = [];
  for (let i = 0; i < count; i++) {
    const title = (body[`milestoneTitle_${i}`] || '').trim();
    const description = (body[`milestoneDescription_${i}`] || '').trim();
    const order = Number(body[`milestoneOrder_${i}`] ?? i);
    const existingImage = body[`milestoneExistingImage_${i}`] || '';
    const removeImage = body[`milestoneRemoveImage_${i}`] === 'on';
    const image = fileMap.get(`milestoneImage_${i}`) || (removeImage ? '' : existingImage);
    if (!title && !description && !image) continue;
    milestones.push({ title, description, order, image });
  }
  return milestones;
}

function parseObstacles(body, files) {
  const count = Number(body.obstacleCount || 0);
  const fileMap = new Map(files.map((f) => [f.fieldname, toPublicUploadPath(f)]));
  const obstacles = [];
  for (let i = 0; i < count; i++) {
    const challenge = (body[`obstacleChallenge_${i}`] || '').trim();
    const solution = (body[`obstacleSolution_${i}`] || '').trim();
    const existingImage = body[`obstacleExistingImage_${i}`] || '';
    const removeImage = body[`obstacleRemoveImage_${i}`] === 'on';
    const image = fileMap.get(`obstacleImage_${i}`) || (removeImage ? '' : existingImage);
    if (!challenge && !solution && !image) continue;
    obstacles.push({ challenge, solution, image });
  }
  return obstacles;
}

function buildProjectPayload(req, existingProject) {
  const files = Array.isArray(req.files) ? req.files : [];
  const existingImages = toArray(req.body.existingImages);
  const removeImages = new Set(toArray(req.body.removeImages));
  const retainedImages = existingImages.filter((p) => p && !removeImages.has(p));
  const uploadedProjectImages = files
    .filter((f) => f.fieldname === 'projectImages')
    .map((f) => toPublicUploadPath(f));
  const images = [...retainedImages, ...uploadedProjectImages];

  return {
    title: (req.body.title || '').trim(),
    arm: (req.body.arm || '').trim(),
    category: (req.body.category || '').trim(),
    client: (req.body.client || '').trim(),
    description: (req.body.description || '').trim(),
    tags: (req.body.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    featured: req.body.featured === 'on',
    videoUrl: (req.body.videoUrl || '').trim(),
    images: images.length > 0 ? images : (existingProject?.images || []),
    milestones: parseMilestones(req.body, files),
    obstacles: parseObstacles(req.body, files),
  };
}

function validateProject(project) {
  return Boolean(project.title && project.category && project.images.length > 0);
}

const categories = [
  'software-solutions',
  'automation',
  'mapping-intelligence',
  'web-design',
  'client-platform',
  'graphics-design',
  'trading-systems',
];

// ── Public routes ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  if (req.site !== 'master') {
    return res.render(req.site, {
      title: ARM_TITLES[req.site],
      featuredProjects: getFeaturedProjects(4, req.site),
    });
  }
  res.render('index', {
    title: 'ACED Division – Creative Solutions',
    featuredProjects: getFeaturedProjects(6),
  });
});

app.get('/portfolio', (req, res) => {
  const activeCategory = (req.query.category || '').trim();
  const activeArm = req.site !== 'master' ? req.site : (req.query.arm || '').trim();
  const projects = listProjects().filter((p) => {
    const matchArm = !activeArm || p.arm === activeArm;
    const matchCat = !activeCategory || p.category === activeCategory;
    return matchArm && matchCat;
  });

  res.render('gallery', {
    title: req.site !== 'master'
      ? `${ARM_TITLES[req.site]} — Portfolio`
      : 'ACED Division – Portfolio',
    projects,
    categories,
    activeCategory,
    activeArm,
    site: req.site,
  });
});

app.get('/portfolio/:slug', (req, res) => {
  const project = findProjectBySlug(req.params.slug);
  if (!project) return res.status(404).render('privacy', { title: 'Not Found' });
  res.render('portfolio-detail', {
    title: `${project.title} – ACED Division Portfolio`,
    project,
    embedUrl: toEmbedUrl(project.videoUrl),
  });
});

// ── Arm sub-pages (path-based fallback for local dev) ─────────────────────────
app.get('/pixels', (req, res) => {
  res.render('pixels', {
    title: ARM_TITLES.pixels,
    featuredProjects: getFeaturedProjects(4, 'pixels'),
  });
});

app.get('/devops', (req, res) => {
  res.render('devops', {
    title: ARM_TITLES.devops,
    featuredProjects: getFeaturedProjects(4, 'devops'),
  });
});

app.get('/trades', (req, res) => {
  res.render('trades', {
    title: ARM_TITLES.trades,
    featuredProjects: getFeaturedProjects(4, 'trades'),
  });
});

// ── Authentication / user accounts ───────────────────────────────────────────
app.get('/auth/register', (req, res) => {
  res.render('auth-register', { title: 'Register', error: null });
});

app.post('/auth/register', async (req, res) => {
  const email = (req.body.email || '').trim();
  const password = (req.body.password || '').trim();
  if (!email || !password || password.length < 8) {
    return res.status(400).render('auth-register', { title: 'Register', error: 'Email + password (8+ chars) required.' });
  }

  const existing = await findUserByEmail(email);
  if (existing) {
    return res.status(400).render('auth-register', { title: 'Register', error: 'Email already registered.' });
  }

  const user = await createUser(email, password, { twoFactorEnabled: false });
  req.session.userId = user._id.toString();
  req.session.isAdmin = user.isAdmin;
  req.session.twoFactorVerified = false;
  req.session.pendingTwoFactor = false;
  req.session.authState = 'register';

  // New users must explicitly enable 2FA first
  return res.redirect('/auth/setup');
});

app.get('/auth/login', (req, res) => {
  res.render('auth-login', { title: 'Login', error: null });
});

app.post('/auth/login', async (req, res) => {
  const email = (req.body.email || '').trim();
  const password = (req.body.password || '').trim();

  const user = await findUserByEmail(email);
  if (!user) {
    return res.status(400).render('auth-login', { title: 'Login', error: 'Invalid credentials.' });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(400).render('auth-login', { title: 'Login', error: 'Invalid credentials.' });
  }

  req.session.userId = user._id.toString();
  req.session.isAdmin = user.isAdmin;

  if (DISABLE_2FA) {
    req.session.twoFactorVerified = true;
    req.session.pendingTwoFactor = false;
    return res.redirect(user.isAdmin ? '/admin/portfolio' : '/');
  }

  req.session.twoFactorVerified = false;
  if (!user.twoFactorEnabled) {
    req.session.pendingTwoFactor = false;
    return res.redirect('/auth/setup');
  }

  req.session.pendingTwoFactor = true;
  return res.redirect('/auth/2fa');
});

app.get('/auth/2fa', async (req, res) => {
  if (DISABLE_2FA) {
    return res.redirect('/');
  }

  if (!req.session.userId || !req.session.pendingTwoFactor) {
    return res.redirect('/auth/login');
  }

  const user = await findUserById(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.redirect('/auth/login');
  }

  if (!user.twoFactorEnabled) {
    return res.redirect('/auth/setup');
  }

  res.render('auth-2fa', { title: 'Two-Factor Authentication', error: null });
});

app.post('/auth/2fa', async (req, res) => {
  if (!req.session.userId || !req.session.pendingTwoFactor) {
    return res.redirect('/auth/login');
  }

  const user = await findUserById(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.redirect('/auth/login');
  }

  const token = (req.body.token || '').trim();
  const secret = user.twoFactorSecret;
  const verified = speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 });

  if (!verified) {
    return res.status(401).render('auth-2fa', { title: 'Two-Factor Authentication', error: 'Invalid code. Please try again.' });
  }

  req.session.pendingTwoFactor = false;
  req.session.twoFactorVerified = true;
  req.session.userId = user._id.toString();
  req.session.isAdmin = user.isAdmin;
  return res.redirect(user.isAdmin ? '/admin/portfolio' : '/');
});

app.get('/auth/setup', requireAuth, async (req, res) => {
  if (DISABLE_2FA) {
    return res.redirect('/');
  }

  const user = await findUserById(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.redirect('/auth/login');
  }

  if (user.twoFactorEnabled) {
    return res.redirect('/auth/2fa');
  }

  const otpAuthUrl = `otpauth://totp/ACED%20Division:${user.email}?secret=${user.twoFactorSecret}&issuer=ACED%20Division`;
  const qrCodeDataURL = await QRCode.toDataURL(otpAuthUrl);

  res.render('auth-setup', {
    title: 'Set up Two-Factor Authentication',
    qrCodeDataURL,
    secret: user.twoFactorSecret,
    error: null,
  });
});

app.post('/auth/setup', requireAuth, async (req, res) => {
  const user = await findUserById(req.session.userId);
  if (!user) {
    req.session.destroy();
    return res.redirect('/auth/login');
  }

  const token = (req.body.token || '').trim();
  const verified = speakeasy.totp.verify({ secret: user.twoFactorSecret, encoding: 'base32', token, window: 1 });

  if (!verified) {
    const otpAuthUrl = `otpauth://totp/ACED%20Division:${user.email}?secret=${user.twoFactorSecret}&issuer=ACED%20Division`;
    const qrCodeDataURL = await QRCode.toDataURL(otpAuthUrl);
    return res.status(400).render('auth-setup', {
      title: 'Set up Two-Factor Authentication',
      qrCodeDataURL,
      secret: user.twoFactorSecret,
      error: 'Invalid code. Please try again.',
    });
  }

  await getUserCollection().updateOne({ _id: user._id }, { $set: { twoFactorEnabled: true } });
  req.session.twoFactorVerified = true;
  req.session.pendingTwoFactor = false;
  return res.redirect(user.isAdmin ? '/admin/portfolio' : '/');
});

app.get('/auth/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

// backward compatibility routes
app.get('/admin/login', (req, res) => res.redirect('/auth/login'));
app.get('/admin/logout', (req, res) => res.redirect('/auth/logout'));

// ── Admin user management ─────────────────────────────────────────────────────
app.get('/admin/users', requireAdmin, async (req, res) => {
  const users = await getUserCollection().find({}, { projection: { passwordHash: 0, twoFactorSecret: 0 } }).toArray();
  res.render('admin-users', { title: 'User Management', users });
});

app.post('/admin/users/:id/promote', requireAdmin, async (req, res) => {
  const userId = req.params.id;
  const userToPromote = await findUserById(userId);

  if (!userToPromote) {
    const users = await getUserCollection().find({}, { projection: { passwordHash: 0, twoFactorSecret: 0 } }).toArray();
    return res.render('admin-users', { title: 'User Management', users, message: null, error: 'User not found.' });
  }

  if (!userToPromote.twoFactorEnabled) {
    const users = await getUserCollection().find({}, { projection: { passwordHash: 0, twoFactorSecret: 0 } }).toArray();
    return res.render('admin-users', { title: 'User Management', users, message: null, error: 'User must have 2FA enabled before promotion.' });
  }

  await setAdminFlag(userId, true);
  const users = await getUserCollection().find({}, { projection: { passwordHash: 0, twoFactorSecret: 0 } }).toArray();
  return res.render('admin-users', { title: 'User Management', users, message: 'User promoted to admin.', error: null });
});

app.get('/admin/account', requireAdmin, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/');

  res.render('admin-account', { title: 'Account Settings', user, message: null, error: null });
});

app.post('/admin/account/password', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/auth/login');

  const oldPassword = (req.body.oldPassword || '').trim();
  const newPassword = (req.body.newPassword || '').trim();
  const confirmPassword = (req.body.confirmPassword || '').trim();

  if (!oldPassword || !newPassword || newPassword.length < 8 || newPassword !== confirmPassword) {
    return res.render('admin-account', { title: 'Account Settings', user, message: null, error: 'Passwords must match and be 8+ chars.' });
  }

  const validOld = await bcrypt.compare(oldPassword, user.passwordHash);
  if (!validOld) {
    return res.render('admin-account', { title: 'Account Settings', user, message: null, error: 'Old password does not match.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  await getUserCollection().updateOne({ _id: user._id }, { $set: { passwordHash } });
  return res.render('admin-account', { title: 'Account Settings', user, message: 'Password updated successfully.', error: null });
});

app.post('/admin/account/2fa-toggle', requireAuth, async (req, res) => {
  const user = await getCurrentUser(req);
  if (!user) return res.redirect('/auth/login');

  const enable = req.body.enable === 'true';
  await getUserCollection().updateOne({ _id: user._id }, { $set: { twoFactorEnabled: enable } });

  if (enable) {
    return res.render('admin-account', { title: 'Account Settings', user: { ...user, twoFactorEnabled: true }, message: '2FA has been enabled.', error: null });
  }
  return res.render('admin-account', { title: 'Account Settings', user: { ...user, twoFactorEnabled: false }, message: '2FA has been disabled.', error: null });
});

// ── Admin portfolio ───────────────────────────────────────────────────────────
app.get('/admin/portfolio', requireAdmin, (req, res) => {
  res.render('admin-portfolio', {
    title: 'Portfolio Management',
    projects: listProjects(),
  });
});

app.get('/admin/portfolio/new', requireAdmin, (req, res) => {
  res.render('admin-portfolio-form', {
    title: 'Add Project',
    pageTitle: 'Add New Project',
    submitLabel: 'Create Project',
    actionUrl: '/admin/portfolio',
    project: null,
    categories,
    arms: ARMS,
  });
});

app.get('/admin/portfolio/:slug/edit', requireAdmin, (req, res) => {
  const project = findProjectBySlug(req.params.slug);
  if (!project) return res.redirect('/admin/portfolio');
  res.render('admin-portfolio-form', {
    title: `Edit ${project.title}`,
    pageTitle: 'Edit Project',
    submitLabel: 'Save Changes',
    actionUrl: `/admin/portfolio/${project.slug}`,
    project,
    categories,
    arms: ARMS,
  });
});

app.post('/admin/portfolio', requireAdmin, upload.any(), (req, res) => {
  const payload = buildProjectPayload(req);
  if (!validateProject(payload)) {
    return res.status(400).render('admin-portfolio-form', {
      title: 'Add Project',
      pageTitle: 'Add New Project',
      submitLabel: 'Create Project',
      actionUrl: '/admin/portfolio',
      project: payload,
      categories,
      arms: ARMS,
      errorMessage: 'Title, category, and at least one project image are required.',
    });
  }
  saveNewProject(payload);
  return res.redirect('/admin/portfolio');
});

app.post('/admin/portfolio/:slug', requireAdmin, upload.any(), (req, res) => {
  const existingProject = findProjectBySlug(req.params.slug);
  if (!existingProject) return res.redirect('/admin/portfolio');
  const payload = buildProjectPayload(req, existingProject);
  if (!validateProject(payload)) {
    return res.status(400).render('admin-portfolio-form', {
      title: `Edit ${existingProject.title}`,
      pageTitle: 'Edit Project',
      submitLabel: 'Save Changes',
      actionUrl: `/admin/portfolio/${existingProject.slug}`,
      project: { ...existingProject, ...payload },
      categories,
      arms: ARMS,
      errorMessage: 'Title, category, and at least one project image are required.',
    });
  }
  updateProject(req.params.slug, payload);
  return res.redirect('/admin/portfolio');
});

app.post('/admin/portfolio/:slug/delete', requireAdmin, (req, res) => {
  deleteProject(req.params.slug);
  res.redirect('/admin/portfolio');
});

// ── Other pages ───────────────────────────────────────────────────────────────
app.get('/privacy-policy', (req, res) => {
  res.render('privacy', { title: 'Privacy Policy' });
});

// ── Server ────────────────────────────────────────────────────────────────────
//-server health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString(), appName: 'ACED Portfolio Server' });
});


//-server start with dynamic port handling
const startServer = (port) => {
  const server = app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.log(`Port ${port} in use, trying ${port + 1}...`);
      startServer(port + 1);
      return;
    }
    throw error;
  });
};

initMongo().then(() => {
  startServer(PORT);
}).catch((error) => {
  console.error('Failed to initialize MongoDB:', error);
  process.exit(1);
});
