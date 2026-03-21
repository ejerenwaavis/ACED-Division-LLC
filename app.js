require('dotenv').config();
const express = require('express');
const fs = require('fs');
const multer = require('multer');
const path = require('path');
const session = require('express-session');
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
const PORT = process.env.PORT || 3050;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'aceddivision2026';

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

// ── Admin auth middleware ─────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) {
    return next();
  }
  return res.redirect('/admin/login');
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

// ── Admin auth ────────────────────────────────────────────────────────────────
app.get('/admin/login', (req, res) => {
  if (req.session.isAdmin) return res.redirect('/admin/portfolio');
  res.render('admin-login', { title: 'Admin Login', error: null });
});

app.post('/admin/login', (req, res) => {
  const password = (req.body.password || '').trim();
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    return res.redirect('/admin/portfolio');
  }
  res.render('admin-login', {
    title: 'Admin Login',
    error: 'Incorrect password. Please try again.',
  });
});

app.get('/admin/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/admin/login');
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

startServer(PORT);
