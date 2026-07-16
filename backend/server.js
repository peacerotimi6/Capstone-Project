import express from "express";
import cors from "cors";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
// import "./lib/appinsights.js";
import logger from "./lib/logger.js";
import { prisma } from "./lib/prisma.js";
import { readRuntimeValue } from "./lib/runtime-values.js";
import {
  getMetricsResponse,
  recordErrorMetric,
  recordRequestMetrics,
  taskCreatedCounter,
} from "./lib/metrics.js";

const PORT = Number(process.env.PORT || readRuntimeValue("PORT", "5000"));
const SESSION_COOKIE = "session";
const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 7;
const MAX_NAME_LENGTH = 50;
const MAX_USERNAME_LENGTH = 32;
const MAX_EMAIL_LENGTH = 254;
const MAX_WORKSPACE_NAME_LENGTH = 80;
const MAX_TASK_TEXT_LENGTH = 180;
const MAX_TASK_CATEGORY_LENGTH = 40;
const MAX_TASK_DUE_LENGTH = 40;
const ALLOWED_BUCKETS = new Set(["inbox", "today", "upcoming", "done"]);

const app = express();

app.disable("x-powered-by");

/*
  CORS configuration
  Allows frontend running from Minikube NodePort / local browser
*/
app.use(
  cors({
    origin: [
      "http://127.0.0.1:62798",
      "http://localhost:62798",
    ],
    credentials: true,
    methods: [
      "GET",
      "POST",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ],
    allowedHeaders: [
      "Content-Type",
    ],
  })
);

app.use(express.json({ limit: "16kb" }));

const parseCookies = (header = "") =>
  Object.fromEntries(
    header
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf("=");
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      }),
  );

const sendJson = (res, statusCode, body, headers = {}) => {
  res.status(statusCode).set({ "Content-Type": "application/json", ...headers }).send(JSON.stringify(body));
};

const mapSettings = (user) => ({
  workspaceName: user.workspaceName,
  ownerName: user.ownerName,
  defaultCategory: user.defaultCategory,
  defaultBucket: user.defaultBucket,
  defaultDue: user.defaultDue,
  projects: Array.isArray(user.projects) ? user.projects : [],
});

const MAX_PROJECTS = 50;
const MAX_PROJECT_NAME_LENGTH = 40;

// Normalize an incoming projects array: sanitize each entry, drop blanks and
// duplicates, cap length. Returns null when the input isn't an array so callers
// can treat "not provided" and "invalid" the same way and keep the existing list.
const sanitizeProjects = (value) => {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  const cleaned = [];
  for (const entry of value) {
    const name = sanitizeTaskField(entry, MAX_PROJECT_NAME_LENGTH);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(name);
    if (cleaned.length >= MAX_PROJECTS) break;
  }
  return cleaned;
};

const mapTask = (task) => ({
  id: task.id,
  text: task.text,
  category: task.category,
  due: task.due,
  bucket: task.bucket,
  flagged: task.flagged,
  done: task.done,
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});

const createTaskHistory = (taskId, action, summary, previousStatus = null, newStatus = null) =>
  prisma.taskHistory.create({
    data: { taskId, action, summary, previousStatus, newStatus },
  });

const fetchActiveTasks = (userId) =>
  prisma.task.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

const createSessionHeaders = (token) => ({
  "Set-Cookie": `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=None; Secure=false; Path=/; Max-Age=${Math.floor(
    SESSION_MAX_AGE_MS / 1000,
  )}`,
  
});

const normalizeEmail = (value) => String(value || "").trim().toLowerCase();
const removeControlChars = (value) => String(value || "").replace(/[\u0000-\u001F\u007F]/g, "");
const collapseWhitespace = (value) => removeControlChars(value).replace(/\s+/g, " ").trim();
const stripAngleBrackets = (value) => value.replace(/[<>]/g, "");
const sanitizeText = (value, maxLength) => stripAngleBrackets(collapseWhitespace(value)).slice(0, maxLength);
const titleCaseWord = (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
const toTitleCase = (value, maxLength) =>
  sanitizeText(value, maxLength)
    .split(" ")
    .filter(Boolean)
    .map((word) => word.split("-").map(titleCaseWord).join("-"))
    .join(" ");
const normalizeUsername = (value) => sanitizeText(value, MAX_USERNAME_LENGTH).toLowerCase();
const sanitizeTaskField = (value, maxLength) => sanitizeText(value, maxLength);
const sanitizeBucket = (value, fallback) => {
  const normalized = sanitizeTaskField(value, 20).toLowerCase();
  return ALLOWED_BUCKETS.has(normalized) ? normalized : fallback;
};

const extractSignupInput = (body = {}) => {
  const firstName = toTitleCase(body.firstName, MAX_NAME_LENGTH);
  const lastName = toTitleCase(body.lastName, MAX_NAME_LENGTH);
  const username = normalizeUsername(body.username);
  const email = normalizeEmail(body.email).slice(0, MAX_EMAIL_LENGTH);
  const password = String(body.password || "");
  const workspaceName = sanitizeText(
    body.workspaceName || readRuntimeValue("APP_TITLE", "Taskline"),
    MAX_WORKSPACE_NAME_LENGTH,
  ) || "Taskline";
  const ownerName = `${firstName} ${lastName}`.trim();

  return {
    firstName,
    lastName,
    username,
    email,
    password,
    workspaceName,
    ownerName,
  };
};

const validateSignupInput = ({ firstName, lastName, username, email, password }) => {
  if (!firstName) return "First name is required";
  if (!lastName) return "Last name is required";
  if (!username) return "Username is required";
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return "Username must be 3-32 characters and use only letters, numbers, dot, dash, or underscore";
  if (!email) return "Email is required";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address";
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password.length > 128) return "Password is too long";
  return null;
};

const createUserSession = async (userId) => {
  const token = randomUUID();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);

  await prisma.session.create({
    data: {
      token,
      userId,
      expiresAt,
    },
  });

  return token;
};

app.use((req, res, next) => {
  const started = Date.now();
  res.on("finish", () => {
    const durationMs = Date.now() - started;
    recordRequestMetrics({
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      durationMs,
    });
    if (res.statusCode >= 500) {
      recordErrorMetric({ method: req.method, path: req.path, type: "http_5xx" });
    }
    logger.info(
      {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: durationMs,
      },
      "request completed",
    );
  });
  next();
});

app.use(async (req, _res, next) => {
  const cookies = parseCookies(req.headers.cookie);
  req.sessionToken = cookies[SESSION_COOKIE];
  req.user = null;
  if (!req.sessionToken) return next();

  const session = await prisma.session.findUnique({
    where: { token: req.sessionToken },
    include: { user: true },
  });

  if (!session || session.expiresAt <= new Date()) {
    if (session) await prisma.session.delete({ where: { token: req.sessionToken } }).catch(() => {});
    return next();
  }

  req.user = session.user;
  await prisma.session.update({
    where: { token: session.token },
    data: { lastSeenAt: new Date() },
  });
  next();
});

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return sendJson(res, 401, { ok: false, error: "Authentication required" });
  }
  return next();
};

app.get("/healthz", async (_req, res, next) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    sendJson(res, 200, { ok: true });
  } catch (error) {
    next(error);
  }
});

app.get("/metrics", async (_req, res, next) => {
  try {
    const { body, contentType } = await getMetricsResponse();
    res.status(200).set("Content-Type", contentType).send(body);
  } catch (error) {
    next(error);
  }
});

app.get("/api/signup/status", async (_req, res, next) => {
  try {
    const userCount = await prisma.user.count();
    return sendJson(res, 200, { ok: true, needsInitialSignup: userCount === 0 });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/signup", async (req, res, next) => {
  try {
    const signup = extractSignupInput(req.body);
    const validationError = validateSignupInput(signup);
    if (validationError) return sendJson(res, 400, { ok: false, error: validationError });

    const existing = await prisma.user.findFirst({
      where: {
        OR: [{ username: signup.username }, { email: signup.email }],
      },
      select: { username: true, email: true },
    });

    if (existing?.username === signup.username) {
      return sendJson(res, 409, { ok: false, error: "Username is already in use" });
    }
    if (existing?.email === signup.email) {
      return sendJson(res, 409, { ok: false, error: "Email is already in use" });
    }

    const passwordHash = await bcrypt.hash(signup.password, 10);
    const userCount = await prisma.user.count();
    const user = await prisma.user.create({
      data: {
        firstName: signup.firstName,
        lastName: signup.lastName,
        username: signup.username,
        email: signup.email,
        passwordHash,
        workspaceName: userCount === 0 ? signup.workspaceName : readRuntimeValue("APP_TITLE", "Taskline"),
        ownerName: signup.ownerName,
        defaultCategory: "General",
        defaultBucket: "today",
        defaultDue: "Today",
      },
    });

    const token = await createUserSession(user.id);

    logger.info({ username: user.username, email: user.email, status: 201 }, "signup success");
    return sendJson(res, 201, { ok: true, username: user.username }, createSessionHeaders(token));
  } catch (error) {
    if (error.code === "P2002") {
      return sendJson(res, 409, { ok: false, error: "Username or email is already in use" });
    }
    return next(error);
  }
});

app.post("/api/login", async (req, res, next) => {
  try {
    // Accept either a username or an email in the `username` field —
    // treat any value containing "@" as an email lookup.
    const rawIdentifier = String(req.body?.username || "").trim();
    const password = String(req.body?.password || "");
    const isEmail = rawIdentifier.includes("@");
    const identifier = isEmail ? rawIdentifier.toLowerCase() : normalizeUsername(rawIdentifier);
    const user = isEmail
      ? await prisma.user.findUnique({ where: { email: identifier } })
      : await prisma.user.findUnique({ where: { username: identifier } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      logger.warn({ identifier, status: 401 }, "login failed");
      return sendJson(res, 401, { ok: false, error: "Invalid credentials" });
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_MS);
    await prisma.session.create({
      data: {
        token,
        userId: user.id,
        expiresAt,
      },
    });

    logger.info({ username: user.username, status: 200 }, "login success");
    return sendJson(
      res,
      200,
      { ok: true, username: user.username },
      createSessionHeaders(token),
    );
  } catch (error) {
    return next(error);
  }
});

app.post("/logout", async (req, res, next) => {
  try {
    if (req.sessionToken) {
      await prisma.session.deleteMany({ where: { token: req.sessionToken } });
    }
    logger.info({ username: req.user?.username, status: 200 }, "logout success");
    return sendJson(
      res,
      200,
      { ok: true },
      { "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0` },
    );
  } catch (error) {
    return next(error);
  }
});

app.get("/api/me", (req, res) => {
  if (!req.user) return sendJson(res, 401, { ok: false });
  return sendJson(res, 200, { ok: true, username: req.user.username });
});

app.get("/api/bootstrap", requireAuth, async (req, res, next) => {
  try {
    const tasks = await fetchActiveTasks(req.user.id);
    const history = await prisma.taskHistory.findMany({
      where: { task: { userId: req.user.id } },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return sendJson(res, 200, {
      ok: true,
      user: { username: req.user.username },
      settings: mapSettings(req.user),
      tasks: tasks.map(mapTask),
      activity: history.map((item) => ({
        id: item.id,
        action: item.action,
        summary: item.summary,
        createdAt: item.createdAt,
      })),
    });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/settings", requireAuth, async (req, res, next) => {
  try {
    const { defaultBucket } = req.body || {};
    const workspaceName = sanitizeText(req.body?.workspaceName, MAX_WORKSPACE_NAME_LENGTH);
    const ownerName = toTitleCase(req.body?.ownerName, MAX_NAME_LENGTH * 2);
    const defaultCategory = sanitizeTaskField(req.body?.defaultCategory, MAX_TASK_CATEGORY_LENGTH);
    const defaultDue = sanitizeTaskField(req.body?.defaultDue, MAX_TASK_DUE_LENGTH);
    const projects = sanitizeProjects(req.body?.projects);
    const data = {
      workspaceName: workspaceName || req.user.workspaceName,
      ownerName: ownerName || req.user.ownerName,
      defaultCategory: defaultCategory || req.user.defaultCategory,
      defaultBucket: sanitizeBucket(defaultBucket, req.user.defaultBucket),
      defaultDue: defaultDue || req.user.defaultDue,
    };
    // `sanitizeProjects` returns null when the caller didn't include a projects
    // array; in that case we leave the stored list untouched.
    if (projects !== null) data.projects = projects;
    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data,
    });
    return sendJson(res, 200, { ok: true, settings: mapSettings(updated) });
  } catch (error) {
    return next(error);
  }
});

app.get("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    const tasks = await fetchActiveTasks(req.user.id);
    return sendJson(res, 200, { ok: true, tasks: tasks.map(mapTask) });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/tasks", requireAuth, async (req, res, next) => {
  try {
    const trimmedText = sanitizeTaskField(req.body?.text, MAX_TASK_TEXT_LENGTH);
    const category = sanitizeTaskField(req.body?.category, MAX_TASK_CATEGORY_LENGTH) || req.user.defaultCategory;
    const due = sanitizeTaskField(req.body?.due, MAX_TASK_DUE_LENGTH);
    const bucket = sanitizeBucket(req.body?.bucket, req.user.defaultBucket);
    const flagged = Boolean(req.body?.flagged);
    if (!trimmedText) return sendJson(res, 400, { error: "Task text is required" });

    const created = await prisma.task.create({
      data: {
        text: trimmedText,
        category,
        due,
        bucket,
        flagged,
        done: bucket === "done",
        userId: req.user.id,
      },
    });

    await createTaskHistory(
      created.id,
      "created",
      `Created "${created.text}"`,
      null,
      created.done ? "done" : "open",
    );
    taskCreatedCounter.inc();
    logger.info({ task_id: created.id, title: created.text }, "task created");
    return sendJson(res, 201, { ok: true, task: mapTask(created) });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/tasks/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.id, deletedAt: null },
    });
    if (!existing) return sendJson(res, 404, { error: "task not found" });

    const data = {
      text: sanitizeTaskField(req.body?.text, MAX_TASK_TEXT_LENGTH) || existing.text,
      category: sanitizeTaskField(req.body?.category, MAX_TASK_CATEGORY_LENGTH) || existing.category,
      due: req.body?.due === undefined ? existing.due : sanitizeTaskField(req.body?.due, MAX_TASK_DUE_LENGTH),
      bucket: sanitizeBucket(req.body?.bucket, existing.bucket),
      flagged: typeof req.body.flagged === "boolean" ? req.body.flagged : existing.flagged,
    };
    const updated = await prisma.task.update({
      where: { id: existing.id },
      data: {
        ...data,
        done: data.bucket === "done" ? true : existing.done,
      },
    });

    await createTaskHistory(updated.id, "updated", `Updated "${updated.text}"`);
    return sendJson(res, 200, { ok: true, task: mapTask(updated) });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/tasks/:id/status", requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.id, deletedAt: null },
    });
    if (!existing) return sendJson(res, 404, { error: "task not found" });

    const nextDone = typeof req.body.done === "boolean" ? req.body.done : req.body.status === "done";
    const fallbackBucket =
      req.body.bucket || (existing.bucket === "done" ? req.user.defaultBucket : existing.bucket || req.user.defaultBucket);
    const updated = await prisma.task.update({
      where: { id: existing.id },
      data: {
        done: nextDone,
        bucket: nextDone ? "done" : fallbackBucket,
      },
    });

    await createTaskHistory(
      updated.id,
      "status_changed",
      `"${updated.text}" moved to ${updated.done ? "done" : "open"}`,
      existing.done ? "done" : "open",
      updated.done ? "done" : "open",
    );
    logger.info(
      {
        task_id: updated.id,
        previous_status: existing.done ? "done" : "open",
        new_status: updated.done ? "done" : "open",
      },
      "task status changed",
    );
    return sendJson(res, 200, { ok: true, task: mapTask(updated) });
  } catch (error) {
    return next(error);
  }
});

app.patch("/api/tasks/:id/flag", requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.id, deletedAt: null },
    });
    if (!existing) return sendJson(res, 404, { error: "task not found" });

    const updated = await prisma.task.update({
      where: { id: existing.id },
      data: { flagged: Boolean(req.body.flagged) },
    });
    await createTaskHistory(
      updated.id,
      updated.flagged ? "flagged" : "unflagged",
      `"${updated.text}" ${updated.flagged ? "flagged" : "unflagged"}`,
    );
    return sendJson(res, 200, { ok: true, task: mapTask(updated) });
  } catch (error) {
    return next(error);
  }
});

app.delete("/api/tasks/:id", requireAuth, async (req, res, next) => {
  try {
    const existing = await prisma.task.findFirst({
      where: { id: req.params.id, userId: req.user.id, deletedAt: null },
    });
    if (!existing) return sendJson(res, 404, { error: "task not found" });

    const updated = await prisma.task.update({
      where: { id: existing.id },
      data: { deletedAt: new Date() },
    });
    await createTaskHistory(updated.id, "deleted", `Deleted "${updated.text}"`);
    return sendJson(res, 200, { ok: true });
  } catch (error) {
    return next(error);
  }
});

app.post("/api/tasks/clear-completed", requireAuth, async (req, res, next) => {
  try {
    const completed = await prisma.task.findMany({
      where: { userId: req.user.id, done: true, deletedAt: null },
    });
    for (const task of completed) {
      await prisma.task.update({ where: { id: task.id }, data: { deletedAt: new Date() } });
      await createTaskHistory(task.id, "cleared_completed", `Cleared completed task "${task.text}"`);
    }
    return sendJson(res, 200, {
      ok: true,
      count: completed.length,
      tasks: (await fetchActiveTasks(req.user.id)).map(mapTask),
    });
  } catch (error) {
    return next(error);
  }
});

app.use((error, req, res, _next) => {
  recordErrorMetric({ method: req.method, path: req.path, type: "unhandled_exception" });
  logger.error(
    {
      err: { message: error.message, stack: error.stack },
      method: req.method,
      path: req.path,
    },
    "unhandled error",
  );
  sendJson(res, 500, { error: "Internal server error" });
});

app.listen(PORT, "0.0.0.0", () => {
  logger.info({ port: PORT }, "Taskline backend started");
});
