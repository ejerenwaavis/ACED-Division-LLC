const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const dataFile = path.join(__dirname, '..', 'data', 'portfolio.json');

function readProjects() {
  try {
    const raw = fs.readFileSync(dataFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function writeProjects(projects) {
  fs.writeFileSync(dataFile, JSON.stringify(projects, null, 2));
}

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function createId(title) {
  const slug = slugify(title);
  return slug || randomUUID();
}

function listProjects() {
  return readProjects().sort((left, right) => {
    return new Date(right.updatedAt || 0) - new Date(left.updatedAt || 0);
  });
}

function getFeaturedProjects(limit = 4, arm = null) {
  return listProjects()
    .filter((project) => project.featured && (!arm || project.arm === arm))
    .slice(0, limit);
}

function findProjectBySlug(slug) {
  return listProjects().find((project) => project.slug === slug || project.id === slug);
}

function saveNewProject(project) {
  const projects = readProjects();
  const id = createId(project.title);
  const now = new Date().toISOString();
  const nextProject = {
    ...project,
    id,
    slug: slugify(project.title) || id,
    createdAt: now,
    updatedAt: now,
  };
  projects.unshift(nextProject);
  writeProjects(projects);
  return nextProject;
}

function updateProject(slug, updates) {
  const projects = readProjects();
  const index = projects.findIndex((project) => project.slug === slug || project.id === slug);
  if (index === -1) {
    return null;
  }

  const current = projects[index];
  const title = updates.title || current.title;
  const next = {
    ...current,
    ...updates,
    title,
    slug: slugify(title) || current.slug,
    updatedAt: new Date().toISOString(),
  };

  projects[index] = next;
  writeProjects(projects);
  return next;
}

function deleteProject(slug) {
  const projects = readProjects();
  const filtered = projects.filter((project) => project.slug !== slug && project.id !== slug);
  writeProjects(filtered);
}

module.exports = {
  listProjects,
  getFeaturedProjects,
  findProjectBySlug,
  saveNewProject,
  updateProject,
  deleteProject,
  slugify,
};
